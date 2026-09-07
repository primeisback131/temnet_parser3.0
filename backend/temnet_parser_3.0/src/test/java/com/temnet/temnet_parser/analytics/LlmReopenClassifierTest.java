package com.temnet.temnet_parser.analytics;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.junit.jupiter.api.Assertions.assertEquals;

class LlmReopenClassifierTest {

    /** Only an answer that STARTS with SAME is a reopen; a mention of the word is not. */
    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "SAME                         | same",
            "same.                        | same",
            "  SAME — та же проблема      | same",
            "NEW                          | new",
            "NEW, это не SAME             | new",
            "Это не та же проблема (SAME) | new",
            "''                           | new",
    })
    void verdictIsTheFirstWord(String answer, String expected) {
        assertEquals(expected, LlmReopenClassifier.parseVerdict(answer));
    }
}
