package com.temnet.temnet_parser.analytics;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LlmCategoryClassifierTest {

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "Печать                       | Печать",
            "печать                       | Печать",
            "«Касса/ККТ»                  | Касса/ККТ",
            "\"Файлы/Диск\".               | Файлы/Диск",
            "Категория: Удалёнка          | Удалёнка",
            "Это Программы/ПО.            | Программы/ПО",
            "1С                           | 1С",
            "Другое                       | Другое",
            "не знаю                      | Другое",
            "                             | Другое",
    })
    void modelAnswersMapToKnownCategories(String answer, String expected) {
        assertEquals(expected, LlmCategoryClassifier.parseCategory(answer));
    }

    @Test
    void nullAnswerIsOther() {
        assertEquals("Другое", LlmCategoryClassifier.parseCategory(null));
    }

    @Test
    void theLongestContainedNameWins() {
        // «ЭЦП/Подпись» contains no other name, but an answer naming two categories
        // resolves to the longer one rather than the first found.
        assertEquals("Программы/ПО", LlmCategoryClassifier.parseCategory("Скорее Программы/ПО, чем Сеть"));
    }

    @Test
    void modesAreParsedLeniently() {
        assertEquals(LlmCategoryClassifier.Mode.OTHER, LlmCategoryClassifier.parseMode(""));
        assertEquals(LlmCategoryClassifier.Mode.OTHER, LlmCategoryClassifier.parseMode(" Other "));
        assertEquals(LlmCategoryClassifier.Mode.ALL, LlmCategoryClassifier.parseMode("all"));
        assertEquals(LlmCategoryClassifier.Mode.OFF, LlmCategoryClassifier.parseMode("off"));
        assertEquals(LlmCategoryClassifier.Mode.OFF, LlmCategoryClassifier.parseMode("false"));
        assertThrows(IllegalArgumentException.class, () -> LlmCategoryClassifier.parseMode("maybe"));
    }

    @Test
    void systemPromptListsEveryCategory() {
        for (String name : com.temnet.temnet_parser.support.CategoryRules.names()) {
            assertTrue(LlmCategoryClassifier.SYSTEM_PROMPT.contains(name), name);
        }
    }
}
