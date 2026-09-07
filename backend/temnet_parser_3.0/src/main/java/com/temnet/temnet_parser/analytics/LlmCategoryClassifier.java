package com.temnet.temnet_parser.analytics;

import com.temnet.temnet_parser.support.CategoryRules;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * Assigns problem categories with an LLM where the keyword dictionary
 * ({@link CategoryRules}) could not — tickets that landed in «Другое» — or,
 * in {@code all} mode, to every ticket, with the model's answer overriding
 * the dictionary. The mode is a runtime setting ({@link LlmSettings}).
 * <p>
 * Only tickets that will not change any more are classified: closed,
 * rejected, expired, or open but past their expiry time. An open ticket's
 * category is still being refined by the ingest as messages arrive, and the
 * ingest would overwrite the model's answer on the next message.
 * <p>
 * Answers are cached in {@code llm_category} by the ticket's natural
 * identity (client + opened_at) and re-applied in bulk on every run, so a
 * full rebuild — which recomputes categories from the dictionary — never
 * asks the model twice about the same ticket.
 */
@Service
public class LlmCategoryClassifier {

    private static final Logger log = LoggerFactory.getLogger(LlmCategoryClassifier.class);

    /** Which tickets the model looks at. */
    public enum Mode {
        /** Never. */
        OFF,
        /** Only tickets the dictionary left in «Другое». */
        OTHER,
        /** Every ticket; the model overrides the dictionary. */
        ALL
    }

    /** How a run went: fresh classifications and the provider calls they cost. */
    public record Result(int decided, int calls) {
        static final Result NONE = new Result(0, 0);
    }

    /** One line per category: the name the model must answer with, and what it covers. */
    private static final List<String> CATEGORY_HINTS = List.of(
            "1С — программы 1С, ЗУП, бухгалтерия, обмены и обновления 1С",
            "ЭЦП/Подпись — электронная подпись, сертификаты, КриптоПро, КЭП, токены",
            "Касса/ККТ — кассы, ККТ, Атол, Эвотор, фискальные накопители, чеки",
            "Спец-ПО — КонсультантПлюс, Гарант, ФОМС, СКЗИ, Госуслуги и другое специализированное ПО",
            "Печать — принтеры, МФУ, сканеры, картриджи, печать документов",
            "Телефония — телефоны, АТС, SIP, звонки, гарнитуры",
            "Почта — электронная почта, Outlook, почтовые ящики, письма не приходят или не уходят",
            "Удалёнка — VPN, RDP, удалённый доступ, удалённый рабочий стол, подключение из дома",
            "Сеть — интернет, Wi-Fi, роутеры, сетевые подключения, нет сети",
            "Программы/ПО — офисные программы, браузеры, мессенджеры и прочее прикладное ПО",
            "Доступ — пароли, логины, учётные записи, блокировки, права доступа",
            "Файлы/Диск — файлы, папки, диски, архивы, восстановление данных, место на диске",
            "Оборудование — компьютеры, ноутбуки, мониторы, клавиатуры, мыши, не включается, сломалось",
            "Другое — ничего из перечисленного или по тексту нельзя понять");

    static final String SYSTEM_PROMPT = """
            Ты — классификатор обращений в службу технической поддержки.
            Тебе дают текст обращения клиента. Определи, к какой одной категории оно относится.
            Категории перечислены в порядке приоритета. Проходи по списку сверху вниз и выбери
            ПЕРВУЮ категорию, которая подходит к обращению, даже если ниже есть более точная.
            %s
            Ответь строго названием одной категории из списка, без пояснений."""
            .formatted(String.join("\n", CATEGORY_HINTS));

    /** SQL restricting a ticket query to tickets the ingest will not touch again. */
    static final String FINISHED = "(t.status <> 'open' OR t.stale_at < NOW())";

    private final JdbcTemplate analytics;
    private final LlmChat chat;
    private final LlmSettingsService settings;
    private final LlmRunStats stats;
    private final int concurrency;

    public LlmCategoryClassifier(
            @Qualifier("analyticsJdbcTemplate") JdbcTemplate analytics,
            LlmChat chat,
            LlmSettingsService settings,
            LlmRunStats stats,
            @Value("${app.llm.concurrency:4}") int concurrency) {
        this.analytics = analytics;
        this.chat = chat;
        this.settings = settings;
        this.stats = stats;
        this.concurrency = concurrency;
    }

    static Mode parseMode(String value) {
        String v = value == null ? "" : value.strip().toLowerCase(Locale.ROOT);
        return switch (v) {
            case "", "other" -> Mode.OTHER;
            case "all" -> Mode.ALL;
            case "off", "false", "no" -> Mode.OFF;
            default -> throw new IllegalArgumentException(
                    "Unknown app.llm.categories '" + value + "': use other, all or off");
        };
    }

    /** SQL narrowing to the tickets a mode looks at (empty for ALL). */
    static String modeFilter(Mode mode) {
        return mode == Mode.OTHER ? "AND t.category_rank = " + CategoryRules.otherRank() : "";
    }

    public boolean enabled() {
        return chat.enabled() && parseMode(settings.current().categories()) != Mode.OFF;
    }

    private record Candidate(long id, String client, LocalDateTime openedAt, LocalDateTime until, String category) {
    }

    /**
     * Re-applies cached answers, then classifies up to {@code budget}
     * unclassified finished tickets with the provider.
     */
    public Result classifyPending(int budget) {
        if (!chat.enabled()) {
            return Result.NONE;
        }
        Mode mode = parseMode(settings.current().categories());
        if (mode == Mode.OFF) {
            return Result.NONE;
        }
        int restored = applyCached(mode);
        if (restored > 0) {
            log.info("LLM categories restored from cache: {}", restored);
        }
        if (budget <= 0) {
            return Result.NONE;
        }

        List<Candidate> pending = analytics.query("""
                        SELECT t.id, t.client, t.opened_at, COALESCE(t.closed_at, t.last_activity) AS until, t.category
                        FROM ticket t
                        LEFT JOIN llm_category c ON c.client = t.client AND c.opened_at = t.opened_at
                        WHERE c.client IS NULL
                          AND %s
                          %s
                        ORDER BY t.id DESC
                        LIMIT ?
                        """.formatted(FINISHED, modeFilter(mode)),
                (rs, i) -> new Candidate(
                        rs.getLong("id"),
                        rs.getString("client"),
                        rs.getTimestamp("opened_at").toLocalDateTime(),
                        rs.getTimestamp("until").toLocalDateTime(),
                        rs.getString("category")),
                budget);
        if (pending.isEmpty()) {
            return Result.NONE;
        }

        ParallelCalls.Result run = ParallelCalls.run("category classification", pending, concurrency, candidate -> {
            String texts = TicketTexts.inbound(analytics, candidate.client(), candidate.openedAt(), candidate.until());
            long startedAt = System.currentTimeMillis();
            String category = parseCategory(chat.complete(SYSTEM_PROMPT, "Текст обращения:\n" + texts));
            stats.recordCall(System.currentTimeMillis() - startedAt);
            analytics.update(
                    "INSERT IGNORE INTO llm_category (client, opened_at, category) VALUES (?, ?, ?)",
                    candidate.client(), Timestamp.valueOf(candidate.openedAt()), category);
            if (!category.equals(candidate.category())) {
                analytics.update("UPDATE ticket SET category = ?, category_rank = ? WHERE id = ?",
                        category, CategoryRules.rankOfName(category), candidate.id());
            }
        });
        int decided = run.decided();
        if (decided > 0) {
            log.info("LLM category classification: {} decided ({} still pending)", decided, pending.size() - decided);
        }
        stats.recordCategories(decided, decided, run.paused(), run.error());
        return new Result(decided, decided);
    }

    /**
     * Writes cached answers onto tickets whose category differs (after a
     * rebuild every ticket carries the dictionary's category again).
     */
    private int applyCached(Mode mode) {
        List<Object[]> updates = new ArrayList<>();
        analytics.query("""
                        SELECT t.id, c.category
                        FROM ticket t
                        JOIN llm_category c ON c.client = t.client AND c.opened_at = t.opened_at
                        WHERE t.category <> c.category
                          %s
                        """.formatted(modeFilter(mode)),
                rs -> {
                    String category = rs.getString("category");
                    updates.add(new Object[]{category, CategoryRules.rankOfName(category), rs.getLong("id")});
                });
        if (updates.isEmpty()) {
            return 0;
        }
        analytics.batchUpdate("UPDATE ticket SET category = ?, category_rank = ? WHERE id = ?", updates);
        return updates.size();
    }

    /**
     * The category the model named, or «Другое». Exact name first (case,
     * quotes and a trailing full stop forgiven), then the longest name the
     * answer contains — models like to answer «Категория: Печать».
     */
    static String parseCategory(String answer) {
        if (answer == null) {
            return CategoryRules.OTHER;
        }
        String cleaned = answer.strip()
                .replaceAll("^[\"'«»`*\\s]+|[\"'«»`*.\\s]+$", "")
                .toLowerCase(Locale.ROOT);
        List<String> names = CategoryRules.names();
        for (String name : names) {
            if (name.toLowerCase(Locale.ROOT).equals(cleaned)) {
                return name;
            }
        }
        return names.stream()
                .filter(name -> cleaned.contains(name.toLowerCase(Locale.ROOT)))
                .max(Comparator.comparingInt(String::length))
                .orElse(CategoryRules.OTHER);
    }
}
