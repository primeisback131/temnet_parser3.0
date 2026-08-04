package com.temnet.temnet_parser.support;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

class ClosurePhraseTest {

    @Test
    void canonicalPhrasesCloseTheTicket() {
        assertThat(ClosurePhrase.statusOf("закрыта заявка")).isEqualTo(ClosurePhrase.CLOSED);
        assertThat(ClosurePhrase.statusOf("ЗАЯВКА ЗАКРЫТА")).isEqualTo(ClosurePhrase.CLOSED);
        assertThat(ClosurePhrase.statusOf("отклонена заявка")).isEqualTo(ClosurePhrase.REJECTED);
        assertThat(ClosurePhrase.statusOf("заявка отклонена")).isEqualTo(ClosurePhrase.REJECTED);
    }

    /** All of these are real operator messages that the exact match missed. */
    @ParameterizedTest
    @ValueSource(strings = {
            "ЗАКРЫТА ЗАЯКА",       // the reported u16.stroybiz case
            "закрыта заявк",
            "закрыта заявкс",
            "закрыт заявка",
            "закрыта  заявка",
            "закрыта завка",
            "закрыта зявка",
            "закрыта заяввка",
            "закрыта заяака",
            "закрытаз заявка",
            "закрытазаявка",
            "закрыта щаявка",
            "закрытая заявка",
            "закрытк заявка",
            "закрыт азаявка",
            "закрыта заявк;а",
            "заявка  закрыта!!!!",
            "заявказакрыта",
            "заявк закрыта",
            "зявка закрыта",
            "заява закрыта",
            "заяввка закрыта",
            "закрыта зяавка",
            "закрыта азявка",
            "закрыта завяка",
            "заявка закрытп",
    })
    void mistypedPhrasesStillClose(String txt) {
        assertThat(ClosurePhrase.statusOf(txt)).isEqualTo(ClosurePhrase.CLOSED);
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "заявкаотклонена",
            "заяявка отклонена",
            "заяка отклонена",
    })
    void mistypedRejectionsStillReject(String txt) {
        assertThat(ClosurePhrase.statusOf(txt)).isEqualTo(ClosurePhrase.REJECTED);
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "могу закрыть заявку?",           // asking permission, not closing
            "заявку можем закрыть?",
            "можно заявку закрыть",
            "заявка не закрыта",
            "не закрыта",
            "нет, не закрыта",
            "1с нужно закрыть",
            "нужно закрыть все автокады",
            "удаленный доступ закрыт",
            "запрос на подключение отклонен",  // a remote-access prompt, not a ticket
            "пользователь отклоняет подключение",
            "вы отклонили запрос 2 раза",
            "заявка в работе",
            "подключаемся",
    })
    void nonClosingMessagesLeaveTheTicketOpen(String txt) {
        assertThat(ClosurePhrase.statusOf(txt)).isNull();
    }

    @Test
    void closureWinsOverRejectionWhenBothAppear() {
        assertThat(ClosurePhrase.statusOf("заявка закрыта, а вторая заявка отклонена"))
                .isEqualTo(ClosurePhrase.CLOSED);
    }

    @Test
    void aWordTwoEditsAwayIsNotTheTicketWord() {
        // «задача»/«заявас» are further than one typo — matching them would
        // start closing tickets on unrelated chatter.
        assertThat(ClosurePhrase.statusOf("закрыта задача")).isNull();
        assertThat(ClosurePhrase.statusOf("закрыта зая")).isNull();
    }
}
