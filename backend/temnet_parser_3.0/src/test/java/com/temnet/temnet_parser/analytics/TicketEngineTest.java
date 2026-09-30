package com.temnet.temnet_parser.analytics;

import com.temnet.temnet_parser.analytics.AnalyticsSyncService.Msg;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * How one client's correspondence is cut into tickets. The cases come from
 * the 2026-09-30 audits, where about one ticket in eight turned out to be
 * the previous one continued.
 */
class TicketEngineTest {

    private static final String CLIENT = "u1.clinic";
    private static final String DESK = "help";
    private static final LocalDate MONDAY = LocalDate.of(2026, 3, 2);

    private final List<Msg> script = new ArrayList<>();

    @Test
    void aReplyRightAfterTheClosureResumesTheTicket() {
        in(MONDAY, "10:00", "Не печатает принтер в регистратуре");
        out(MONDAY, "10:05", "Перезагрузите принтер");
        out(MONDAY, "10:06", "ЗАКРЫТА ЗАЯВКА");
        in(MONDAY, "10:07", "как закрыта?");
        out(MONDAY, "10:20", "Подключились, поправили драйвер");
        out(MONDAY, "10:21", "ЗАКРЫТА ЗАЯВКА");

        assertThat(replay()).singleElement().satisfies(t -> {
            assertThat(t.status).isEqualTo("closed");
            assertThat(t.closedAt).isEqualTo(MONDAY.atTime(10, 21));
            assertThat(t.messagesIn).isEqualTo(2);
            assertThat(t.resumes).isEqualTo(1);
        });
    }

    @Test
    void aNewRequestRightAfterTheClosureOpensATicket() {
        in(MONDAY, "10:00", "Не печатает принтер в регистратуре");
        out(MONDAY, "10:06", "ЗАКРЫТА ЗАЯВКА");
        in(MONDAY, "10:08", "Установите, пожалуйста, 1С на второй компьютер");

        List<Ticket> tickets = replay();
        assertThat(tickets).hasSize(2);
        assertThat(tickets.get(1).reopenedFrom).isEqualTo(tickets.get(0).id);
    }

    @Test
    void thanksWithARequestOpensATicket() {
        in(MONDAY, "10:00", "Не печатает принтер в регистратуре");
        out(MONDAY, "10:06", "ЗАКРЫТА ЗАЯВКА");
        in(MONDAY, "12:00", "Спасибо! Можно еще папку сканов подключить");

        assertThat(replay()).hasSize(2);
    }

    @Test
    void lateThanksOpensNothingButCreditsNoClosure() {
        in(MONDAY, "10:00", "Не печатает принтер в регистратуре");
        out(MONDAY, "10:06", "ЗАКРЫТА ЗАЯВКА");
        in(MONDAY.plusWeeks(1), "09:00", "Спсибо, все работает");

        assertThat(replay()).singleElement().satisfies(t -> assertThat(t.thanked).isFalse());
    }

    @Test
    void yesToAnOperatorsQuestionIsAConversationNotThanks() {
        in(MONDAY, "10:00", "Не печатает принтер в регистратуре");
        out(MONDAY, "10:06", "ЗАКРЫТА ЗАЯВКА");
        out(MONDAY, "11:00", "Можем занять ваш ПК на полчаса?");
        in(MONDAY, "11:02", "да");

        List<Ticket> tickets = replay();
        assertThat(tickets).hasSize(2);
        assertThat(tickets.get(0).thanked).isFalse();
    }

    @Test
    void aReturnSoonAfterExpiryIsAReopenCandidate() {
        in(MONDAY, "10:00", "Не печатает принтер в регистратуре");
        out(MONDAY, "10:05", "Проверим и отпишемся");
        // Stale after 20 working hours: Wednesday 10:05.
        in(MONDAY.plusDays(2), "12:00", "Что там по моему вопросу?");

        List<Ticket> tickets = replay();
        assertThat(tickets).extracting(t -> t.status).containsExactly("expired", "open");
        assertThat(tickets.get(1).reopenedFrom).isEqualTo(tickets.get(0).id);
        assertThat(tickets.get(1).reopenLlm).isEqualTo("pending");
    }

    @Test
    void reloadingStateBeforeEveryMessageCutsTheSameTickets() {
        in(MONDAY, "10:00", "Не печатает принтер в регистратуре");
        out(MONDAY, "10:06", "ЗАКРЫТА ЗАЯВКА");
        in(MONDAY, "10:07", "как закрыта?");
        out(MONDAY, "10:21", "ЗАКРЫТА ЗАЯВКА");
        out(MONDAY, "11:00", "Можем занять ваш ПК на полчаса?");
        in(MONDAY, "11:02", "да");
        out(MONDAY, "11:30", "Готово. ЗАКРЫТА ЗАЯВКА");
        in(MONDAY, "13:00", "Спасибо!");
        in(MONDAY.plusDays(1), "09:00", "Нужен доступ к папке бухгалтерии");
        out(MONDAY.plusDays(1), "09:05", "Уточните у руководителя");
        in(MONDAY.plusDays(3), "16:00", "Руководитель согласовал");
        out(MONDAY.plusDays(3), "16:10", "ЗАКРЫТА ЗАЯВКА");
        in(MONDAY.plusWeeks(1), "09:00", "спасибо");

        List<String> oneRun = describe(replay());
        List<String> restarted = describe(replayRestartingBeforeEveryMessage());
        assertThat(restarted).isEqualTo(oneRun);
        assertThat(oneRun).hasSize(4);
    }

    private void in(LocalDate day, String time, String txt) {
        script.add(new Msg(script.size() + 1, CLIENT, CLIENT, DESK, true, txt, at(day, time), null));
    }

    private void out(LocalDate day, String time, String txt) {
        script.add(new Msg(script.size() + 1, CLIENT, DESK, CLIENT, false, txt, at(day, time), null));
    }

    private static LocalDateTime at(LocalDate day, String time) {
        return day.atTime(LocalTime.parse(time));
    }

    /** One run over the whole script, like a full rebuild. */
    private List<Ticket> replay() {
        MemoryStore store = new MemoryStore();
        TicketEngine engine = new TicketEngine(store);
        for (Msg m : script) {
            store.messages.add(m);
            engine.apply(m);
        }
        engine.flushDirty();
        return store.tickets;
    }

    /** A new run for every message, like incremental syncs a few minutes apart. */
    private List<Ticket> replayRestartingBeforeEveryMessage() {
        MemoryStore store = new MemoryStore();
        for (Msg m : script) {
            store.messages.add(m);
            TicketEngine engine = new TicketEngine(store);
            engine.apply(m);
            engine.flushDirty();
        }
        return store.tickets;
    }

    private static List<String> describe(List<Ticket> tickets) {
        return tickets.stream()
                .map(t -> String.join(" ", t.openedAt.toString(), t.status, String.valueOf(t.closedAt),
                        "in=" + t.messagesIn, "out=" + t.messagesOut, "thanked=" + t.thanked,
                        "resumes=" + t.resumes, "from=" + t.reopenedFrom))
                .toList();
    }

    /** The ticket table and the message table, as the engine sees them. */
    private static class MemoryStore implements TicketEngine.Store {

        final List<Ticket> tickets = new ArrayList<>();
        final List<Msg> messages = new ArrayList<>();

        @Override
        public Ticket open(String client) {
            return latest(client, true);
        }

        @Override
        public Ticket lastEnded(String client) {
            return latest(client, false);
        }

        private Ticket latest(String client, boolean open) {
            return tickets.stream()
                    .filter(t -> t.client.equals(client) && "open".equals(t.status) == open)
                    .max(Comparator.comparing((Ticket t) -> t.openedAt).thenComparing(t -> t.id))
                    .orElse(null);
        }

        @Override
        public Msg previous(Msg m) {
            Msg previous = null;
            for (Msg candidate : messages) {
                if (candidate == m) {
                    break;
                }
                if (Objects.equals(candidate.client(), m.client())) {
                    previous = candidate;
                }
            }
            return previous;
        }

        @Override
        public void insert(Ticket t) {
            t.id = (long) tickets.size() + 1;
            tickets.add(t);
        }

        @Override
        public void update(Ticket t) {
            // The engine edits the stored objects in place.
        }
    }
}
