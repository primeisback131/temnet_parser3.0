package com.temnet.temnet_parser.support;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Keyword dictionary that classifies a request message into a problem
 * category. Categories are ordered by priority: the first one whose keyword
 * matches wins, so broader buckets (Доступ, Оборудование) come last.
 *
 * Keywords are code-controlled (never user input), so they are safe to inline
 * into the generated SQL CASE expression.
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
            new Category("Удалёнка", List.of("vpn", "впн", "openvpn", "anydesk", "энидеск", "teamviewer", "rdp", "удаленк", "удалёнк", "удаленн", "удалённ")),
            new Category("Сеть", List.of("интернет", "wi-fi", "вай-фай", "роутер", "сеть")),
            new Category("Программы/ПО", List.of("эксель", "excel", "ворд", "word", "офис", "office", "браузер", "гугл", "хром", "chrome", "битрикс", "миранда", "vk teams", "vkteams")),
            new Category("Доступ", List.of("пароль", "логин", "доступ", "заблокир", "учетн", "учётн")),
            new Category("Файлы/Диск", List.of("файл", "папк", "диск", "архив")),
            new Category("Оборудование", List.of("компьютер", "ноутбук", "монитор", "не включается", "клавиатур", "мышь", "считыват"))
    );

    private CategoryRules() {
    }

    /**
     * Builds a {@code CASE} that maps a text column to a priority rank
     * (1 = highest-priority category .. N, with N+1 for the "other" bucket).
     * Used to pick the best-matching category across a request's messages
     * via {@code MIN(rank)}.
     */
    public static String rankExpression(String column) {
        String lower = "LOWER(" + column + ")";
        StringBuilder sb = new StringBuilder("CASE");
        int rank = 1;
        for (Category category : CATEGORIES) {
            String condition = category.keywords().stream()
                    .map(kw -> lower + " LIKE '%" + kw + "%'")
                    .collect(Collectors.joining(" OR "));
            sb.append(" WHEN ").append(condition).append(" THEN ").append(rank);
            rank++;
        }
        sb.append(" ELSE ").append(rank).append(" END");
        return sb.toString();
    }

    /** Builds a {@code CASE} that maps a rank back to its category name. */
    public static String rankToNameExpression(String rankColumn) {
        StringBuilder sb = new StringBuilder("CASE ").append(rankColumn);
        int rank = 1;
        for (Category category : CATEGORIES) {
            sb.append(" WHEN ").append(rank).append(" THEN '").append(category.name()).append("'");
            rank++;
        }
        sb.append(" ELSE '").append(OTHER).append("' END");
        return sb.toString();
    }
}
