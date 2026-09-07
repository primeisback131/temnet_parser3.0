package com.temnet.temnet_parser.support;

import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Keyword dictionary that classifies a request message into a problem
 * category. Categories are ordered by priority: the first one whose keyword
 * matches wins, so broader buckets (Доступ, Оборудование) come last.
 * <p>
 * Every keyword is a stem anchored to the START of a word: «печат» finds
 * «печатает» and «печать» but not «опечатка», «атол» finds the cash-register
 * brand but not «Анатолий». A stem may carry a regex tail where the plain
 * stem is ambiguous («почт(?!и\b)» skips the everyday «почти»).
 */
public final class CategoryRules {

    public record Category(String name, List<Pattern> patterns) {
    }

    public static final String OTHER = "Другое";

    private static final List<Category> CATEGORIES = List.of(
            category("1С", "1с", "1c", "зуп", "бухгалт"),
            category("ЭЦП/Подпись", "подпис", "эцп", "сертификат", "криптопро", "кэп"),
            category("Касса/ККТ", "касс(а|е|у|ы|ов)", "атол", "ккт", "фискальн", "эвотор"),
            category("Спец-ПО", "консультант", "гарант(?!и)", "фомс", "скзи", "госуслуг"),
            category("Печать", "принтер", "печат", "картридж", "сканер", "мфу", "kyocera"),
            category("Телефония", "телефон", "атс", "sip", "сип\\b", "микросип", "звон"),
            category("Почта", "почт(?!и\\b)", "п/я", "outlook", "ящик", "письм", "mail"),
            category("Удалёнка", "vpn", "впн", "openvpn", "rdp", "удал[её]нк",
                    "удал[её]нн\\w*\\s+(доступ|рабоч|стол|подключ)"),
            category("Сеть", "интернет", "wi-fi", "вай-фай", "роутер", "сет[ьи]\\b", "сетев"),
            category("Программы/ПО", "эксель", "excel", "ворд", "word", "офис", "office", "браузер", "гугл",
                    "хром", "chrome", "битрикс", "миранда", "vk teams", "vkteams"),
            category("Доступ", "парол", "логин", "доступ", "заблокир", "уч[её]тн"),
            category("Файлы/Диск", "файл", "папк", "диск(?!усс)", "архив"),
            category("Оборудование", "компьютер", "ноутбук", "монитор", "не включается", "клавиатур",
                    "мыш[ьик]", "считыват")
    );

    private CategoryRules() {
    }

    private static Category category(String name, String... stems) {
        return new Category(name, Arrays.stream(stems)
                .map(stem -> Pattern.compile("\\b" + stem,
                        Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE | Pattern.UNICODE_CHARACTER_CLASS))
                .toList());
    }

    /** Rank of the fallback "other" bucket (all real categories rank lower). */
    public static int otherRank() {
        return CATEGORIES.size() + 1;
    }

    /**
     * Priority rank of the first category whose keyword occurs in the text,
     * or {@link #otherRank()}. Used by the ingest state machine.
     */
    public static int rankOf(String text) {
        for (int i = 0; i < CATEGORIES.size(); i++) {
            for (Pattern pattern : CATEGORIES.get(i).patterns()) {
                if (pattern.matcher(text).find()) {
                    return i + 1;
                }
            }
        }
        return otherRank();
    }

    /** Category name for a rank produced by {@link #rankOf}. */
    public static String nameOf(int rank) {
        return rank >= 1 && rank <= CATEGORIES.size() ? CATEGORIES.get(rank - 1).name() : OTHER;
    }

    /** Rank of a category by its name; unknown names rank as «Другое». */
    public static int rankOfName(String name) {
        for (int i = 0; i < CATEGORIES.size(); i++) {
            if (CATEGORIES.get(i).name().equals(name)) {
                return i + 1;
            }
        }
        return otherRank();
    }

    /** Every category name in priority order, «Другое» last. */
    public static List<String> names() {
        return Stream.concat(CATEGORIES.stream().map(Category::name), Stream.of(OTHER)).toList();
    }

}
