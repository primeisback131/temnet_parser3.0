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
    @ValueSource(strings = {"не ок", "спасибо, не надо", "Добрый день, не могу зайти в 1С", "нужен доступ к папке",
            "Спасибо! Можно еще папку приемное отделение установить",
            "Да. Вопрос, почему когда открываю документы, они не сохраняются"})
    void anythingElseIsANewRequest(String txt) {
        assertThat(ReopenSignals.isAck(txt)).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"спсаибо", "Cпасибо", "спасибки", "Благодарствую", "Всё работает", "cgfcb,j", "👍", "+",
            "Спасибо большое за помощь!"})
    void thanksStaysThanksHoweverLate(String txt) {
        assertThat(ReopenSignals.isPureAck(txt)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"test", ".", "1", "Спасибо, а как настроить почту?", "не работает"})
    void pingsAndQuestionsAreNoPureThanks(String txt) {
        assertThat(ReopenSignals.isPureAck(txt)).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"Установите, пожалуйста, 1С на второй компьютер",
            "Добрый день! Нужен доступ к папке бухгалтерии"})
    void aRequestOrAGreetingWithATopicStartsANewRequest(String txt) {
        assertThat(ReopenSignals.startsNewRequest(txt)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"как закрыта?", "а бесперебойник не сделан", "Ничего не изменилось",
            "192.168.1.102 ip адрес телефона у Натальи Денисовой"})
    void aFollowUpContinuesTheClosedTicket(String txt) {
        assertThat(ReopenSignals.startsNewRequest(txt)).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"Можем занять ваш ПК на полчаса?", "Отправьте, пожалуйста, номер энидеска"})
    void anOperatorQuestionOrInstructionIsSubstantive(String txt) {
        assertThat(ReopenSignals.isSubstantiveOperatorMessage(txt)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"ЗАКРЫТА ЗАЯВКА", "Пожалуйста", "Заявка в работе", "Добрый день, обращайтесь"})
    void closuresAndCourtesyAreNot(String txt) {
        assertThat(ReopenSignals.isSubstantiveOperatorMessage(txt)).isFalse();
    }
}
