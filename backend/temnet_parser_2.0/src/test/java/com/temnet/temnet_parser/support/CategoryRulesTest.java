package com.temnet.temnet_parser.support;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CategoryRulesTest {

    @Test
    void matchesKeywordAnywhereInText() {
        int rank = CategoryRules.rankOf("не работает принтер на втором этаже");
        assertThat(CategoryRules.nameOf(rank)).isEqualTo("Печать");
    }

    @Test
    void matchingIsCaseInsensitive() {
        int rank = CategoryRules.rankOf("Не могу зайти в Outlook");
        assertThat(CategoryRules.nameOf(rank)).isEqualTo("Почта");
    }

    @Test
    void higherPriorityCategoryWinsOnMultipleMatches() {
        // "1с" (первая категория) должна победить "принтер" (Печать)
        int rank = CategoryRules.rankOf("в 1с не печатает принтер");
        assertThat(CategoryRules.nameOf(rank)).isEqualTo("1С");
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
}
