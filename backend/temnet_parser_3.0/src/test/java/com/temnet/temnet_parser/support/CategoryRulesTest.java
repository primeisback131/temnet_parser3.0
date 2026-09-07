package com.temnet.temnet_parser.support;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class CategoryRulesTest {

    private static String categoryOf(String text) {
        return CategoryRules.nameOf(CategoryRules.rankOf(text));
    }

    @Test
    void matchesKeywordAnywhereInText() {
        assertThat(categoryOf("не работает принтер на втором этаже")).isEqualTo("Печать");
    }

    @Test
    void matchingIsCaseInsensitive() {
        assertThat(categoryOf("Не могу зайти в Outlook")).isEqualTo("Почта");
        assertThat(categoryOf("НЕ ПЕЧАТАЕТ ПРИНТЕР")).isEqualTo("Печать");
    }

    @Test
    void higherPriorityCategoryWinsOnMultipleMatches() {
        // "1с" (первая категория) должна победить "принтер" (Печать)
        assertThat(categoryOf("в 1с не печатает принтер")).isEqualTo("1С");
    }

    @Test
    void unmatchedTextFallsBackToOther() {
        int rank = CategoryRules.rankOf("добрый день, подскажите пожалуйста");
        assertThat(rank).isEqualTo(CategoryRules.otherRank());
        assertThat(CategoryRules.nameOf(rank)).isEqualTo(CategoryRules.OTHER);
    }

    @Test
    void nameOfOutOfRangeRankIsOther() {
        assertThat(CategoryRules.nameOf(0)).isEqualTo(CategoryRules.OTHER);
        assertThat(CategoryRules.nameOf(999)).isEqualTo(CategoryRules.OTHER);
    }

    @Test
    void realCategoriesRankAboveOther() {
        assertThat(CategoryRules.rankOf("нужен новый картридж"))
                .isLessThan(CategoryRules.otherRank());
    }

    /** Stems match at the start of a word only: everyday words and names must not trigger a category. */
    @ParameterizedTest
    @CsvSource({
            "'почти готово, проверьте', Другое",
            "'Анатолий не может зайти', Другое",
            "'опечатка в договоре', Другое",
            "'дискуссия по проекту', Другое",
            "'гарантия на ноутбук', Оборудование",
            "'удаленные файлы восстановить', Файлы/Диск",
    })
    void stemsDoNotMatchInsideOtherWords(String text, String expected) {
        assertThat(categoryOf(text)).isEqualTo(expected);
    }

    @ParameterizedTest
    @CsvSource({
            "'не работает удаленный доступ', Удалёнка",
            "'не подключается VPN', Удалёнка",
            "'почта не приходит', Почта",
            "'касса не пробивает чек', Касса/ККТ",
            "'сломалась мышка', Оборудование",
            "'нет сети на втором этаже', Сеть",
            "'забыл пароль от учётной записи', Доступ",
            "'поставьте Консультант Плюс', Спец-ПО",
    })
    void inflectedFormsStillMatch(String text, String expected) {
        assertThat(categoryOf(text)).isEqualTo(expected);
    }

    @Test
    void namesAndRanksRoundTrip() {
        assertThat(CategoryRules.names()).startsWith("1С").endsWith(CategoryRules.OTHER).doesNotHaveDuplicates();
        for (String name : CategoryRules.names()) {
            assertThat(CategoryRules.nameOf(CategoryRules.rankOfName(name))).isEqualTo(name);
        }
        assertThat(CategoryRules.rankOfName("Печать")).isEqualTo(CategoryRules.rankOf("не печатает принтер"));
        assertThat(CategoryRules.rankOfName("нет такой")).isEqualTo(CategoryRules.otherRank());
    }
}
