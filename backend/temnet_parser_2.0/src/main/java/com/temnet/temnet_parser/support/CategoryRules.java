package com.temnet.temnet_parser.support;

import java.util.List;

/**
 * Keyword dictionary that classifies a request message into a problem
 * category. Categories are ordered by priority: the first one whose keyword
 * matches wins, so broader buckets (Доступ, Оборудование) come last.
 */
public final class CategoryRules {

    public record Category(String name, List<String> keywords) {
    }

    public static final String OTHER = "Другое";

    private static final List<Category> CATEGORIES = List.of(
            new Category("1С", List.of("1с", "1c", "зуп", "бухгалт")),
            new Category("ЭЦП/Подпись", List.of("подпис", "эцп", "сертификат", "криптопро", "кэп")),
            new Category("Касса/ККТ", List.of("касса", "кассе", "атол", "ккт", "фискальн", "эвотор")),
            new Category("Спец-ПО", List.of("консультант", "гарант", "фомс", "скзи", "госуслуг")),
            new Category("Печать", List.of("принтер", "печат", "картридж", "сканер", "мфу", "kyocera")),
            new Category("Телефония", List.of("телефон", "атс", "sip", "сип", "микросип", "звон")),
            new Category("Почта", List.of("почт", "п/я", "outlook", "ящик", "письм", "mail")),
            new Category("Удалёнка", List.of("vpn", "впн", "openvpn", "rdp", "удаленк", "удалёнк", "удаленн", "удалённ")),
            new Category("Сеть", List.of("интернет", "wi-fi", "вай-фай", "роутер", "сеть")),
            new Category("Программы/ПО", List.of("эксель", "excel", "ворд", "word", "офис", "office", "браузер", "гугл", "хром", "chrome", "битрикс", "миранда", "vk teams", "vkteams")),
            new Category("Доступ", List.of("пароль", "логин", "доступ", "заблокир", "учетн", "учётн")),
            new Category("Файлы/Диск", List.of("файл", "папк", "диск", "архив")),
            new Category("Оборудование", List.of("компьютер", "ноутбук", "монитор", "не включается", "клавиатур", "мышь", "считыват"))
    );

    private CategoryRules() {
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
        String lower = text.toLowerCase();
        for (int i = 0; i < CATEGORIES.size(); i++) {
            for (String keyword : CATEGORIES.get(i).keywords()) {
                if (lower.contains(keyword)) {
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

}
