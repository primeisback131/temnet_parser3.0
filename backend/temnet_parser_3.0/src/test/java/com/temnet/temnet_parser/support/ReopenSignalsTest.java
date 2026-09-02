package com.temnet.temnet_parser.support;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

class ReopenSignalsTest {

    @ParameterizedTest
    @ValueSource(strings = {"Спасибо!", "спасибо, всё заработало", "ок", "Окей", "+", "👍", "Понял, спс", "да"})
    void acknowledgementsOpenNothing(String txt) {
        assertThat(ReopenSignals.isAck(txt)).isTrue();
        assertThat(ReopenSignals.isReopenMarker(txt)).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"не помогло", "Опять не работает", "снова та же ошибка", "так и не заработало",
            "по-прежнему не печатает", "нет", "Нет.", "проблема не решена"})
    void complaintsAboutTheSameProblemAreReopenMarkers(String txt) {
        assertThat(ReopenSignals.isReopenMarker(txt)).isTrue();
        assertThat(ReopenSignals.isAck(txt)).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"не ок", "спасибо, не надо", "Добрый день, не могу зайти в 1С", "нужен доступ к папке"})
    void anythingElseIsANewRequest(String txt) {
        assertThat(ReopenSignals.isAck(txt)).isFalse();
    }
}
