package com.temnet.temnet_parser.analytics;

import com.temnet.temnet_parser.analytics.AnalyticsSyncService.Msg;
import com.temnet.temnet_parser.support.BusinessTime;
import com.temnet.temnet_parser.support.CategoryRules;
import com.temnet.temnet_parser.support.ClosurePhrase;
import com.temnet.temnet_parser.support.ReopenSignals;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * Per-client ticket state machine. State survives across batches within a
 * run; across runs it is reloaded through the {@link Store} (the open ticket,
 * the one that ended last and the client's previous message are all the state
 * there is), so an incremental sync and a full rebuild cut the same tickets.
 * <p>
 * A client message with no open ticket, after a closure:
 * <ol>
 *   <li>is thanks and opens nothing when it is an acknowledgement within
 *       {@link #ACK_WINDOW_SECONDS} or a pure one at any distance - unless it
 *       answers an operator's question asked with no ticket open («Можем
 *       занять ПК?» - «да») and does not thank;</li>
 *   <li>puts the closed ticket back to work when it comes within
 *       {@link #RESUME_WINDOW} of the closure phrase and does not start a new
 *       request: operators often close before the client has had their say
 *       («как закрыта?», «а бесперебойник не сделан»);</li>
 *   <li>otherwise opens a new ticket, a reopen candidate when it comes soon
 *       after the previous ticket closed or went stale.</li>
 * </ol>
 * The three rules and their windows were fitted and hand-checked on the 2026
 * dump (audits of 2026-09-30); see docs/METRICS.md.
 */
class TicketEngine {

    // Windows in WORKING seconds (08:00-18:00 Mon-Fri, see BusinessTime).
    static final long ACK_WINDOW_SECONDS = 4 * 3600;       // any acknowledgement after a closure
    static final long THANKED_WINDOW_SECONDS = 40 * 3600;  // late thanks still credit the closure
    static final long REOPEN_WINDOW_SECONDS = 10 * 3600;   // one working day
    static final long STALE_OPEN_SECONDS = 20 * 3600;      // silence that expires an open ticket

    /** Wall-clock time after a closure phrase in which the conversation may resume. */
    static final Duration RESUME_WINDOW = Duration.ofMinutes(15);

    /** Where the machine reads a client's state from and writes its tickets to. */
    interface Store {

        /** The client's open ticket, or null. */
        Ticket open(String client);

        /** The client's most recently opened ticket that is not open, or null. */
        Ticket lastEnded(String client);

        /** The client's message right before {@code m}, or null. */
        Msg previous(Msg m);

        /** Stores a new ticket and sets its id. */
        void insert(Ticket t);

        void update(Ticket t);
    }

    private final Store store;
    private final Map<String, ClientState> states = new HashMap<>();
    private final Set<Ticket> dirty = new LinkedHashSet<>();

    TicketEngine(Store store) {
        this.store = store;
    }

    private static class ClientState {
        Ticket open;
        /** The ticket that ended last: closed, rejected or expired. */
        Ticket lastEnded;
        /** The client's previous message asked or told them something with no ticket open. */
        boolean operatorSpokeLast;
    }

    void apply(Msg m) {
        ClientState st = states.computeIfAbsent(m.client(), client -> load(m));
        if (m.inbound()) {
            applyInbound(st, m);
        } else {
            applyOutbound(st, m);
        }
    }

    void flushDirty() {
        dirty.forEach(store::update);
        dirty.clear();
    }

    /**
     * When this ticket's silence crosses the expiry threshold - derived from
     * lastActivity on every write, so the column can never drift from the
     * value {@link #applyInbound} compares against.
     */
    static LocalDateTime staleAt(Ticket t) {
        return BusinessTime.plusBusinessSeconds(t.lastActivity, STALE_OPEN_SECONDS);
    }

    private void applyInbound(ClientState st, Msg m) {
        if (st.open != null
                && BusinessTime.secondsBetween(st.open.lastActivity, m.createdAt()) > STALE_OPEN_SECONDS) {
            st.open.status = "expired";
            dirty.add(st.open);
            st.lastEnded = st.open;
            st.open = null;
        }
        boolean answersOperator = st.operatorSpokeLast;
        st.operatorSpokeLast = false;
        if (st.open != null) {
            join(st.open, m);
            return;
        }

        Ticket last = st.lastEnded;
        boolean afterClosure = last != null && last.closedAt != null;
        if (afterClosure) {
            long sinceClosure = BusinessTime.secondsBetween(last.closedAt, m.createdAt());
            // "спасибо" after a closure is not a new ticket - but "не помогло"
            // is, however short: ReopenSignals checks the markers first.
            boolean ack = ReopenSignals.isAck(m.txt()) && sinceClosure <= ACK_WINDOW_SECONDS
                    || ReopenSignals.isPureAck(m.txt());
            if (ack && !(answersOperator && !ReopenSignals.hasThanksWord(m.txt()))) {
                if (sinceClosure <= THANKED_WINDOW_SECONDS) {
                    last.thanked = true;
                    dirty.add(last);
                }
                return;
            }
            if (Duration.between(last.closedAt, m.createdAt()).compareTo(RESUME_WINDOW) <= 0
                    && !ReopenSignals.startsNewRequest(m.txt())) {
                resume(st, last, m);
                return;
            }
        }

        Ticket ticket = new Ticket(m.client(), m.createdAt());
        // The desk this ticket belongs to: whoever the client addressed.
        ticket.account = m.recipient();
        ticket.categoryRank = CategoryRules.rankOf(m.txt());
        ticket.messagesIn = 1;
        boolean soonAfterClosure = afterClosure
                && BusinessTime.secondsBetween(last.closedAt, m.createdAt()) <= REOPEN_WINDOW_SECONDS;
        // An expired ticket is an unfinished conversation too: without this a
        // return after a long silence was invisible to the reopen metric.
        boolean soonAfterExpiry = last != null && "expired".equals(last.status)
                && BusinessTime.secondsBetween(staleAt(last), m.createdAt()) <= REOPEN_WINDOW_SECONDS;
        if (soonAfterClosure || soonAfterExpiry) {
            int score = 0;
            if (ReopenSignals.isReopenMarker(m.txt())) {
                score += 2;
            }
            if (ticket.categoryRank == last.categoryRank && ticket.categoryRank != CategoryRules.otherRank()) {
                score += 1;
            }
            ticket.reopenedFrom = last.id;
            ticket.reopenScore = score;
            if (score < 2) {
                // No marker words: a bare category match is a weak signal,
                // so the LLM gets the final say (2026-09-10: score-1
                // tickets used to stay "probable" forever).
                ticket.reopenLlm = "pending";
            }
        }
        store.insert(ticket);
        st.open = ticket;
    }

    /** A client message joins the open ticket. */
    private void join(Ticket t, Msg m) {
        t.messagesIn++;
        t.lastActivity = m.createdAt();
        if (t.awaitingSince == null) {
            t.awaitingSince = m.createdAt();
        }
        int rank = CategoryRules.rankOf(m.txt());
        if (rank < t.categoryRank) {
            t.categoryRank = rank;
        }
        dirty.add(t);
    }

    /** The closure was premature: the client is still on the same conversation. */
    private void resume(ClientState st, Ticket t, Msg m) {
        t.status = "open";
        t.closedAt = null;
        t.closedBy = null;
        t.resolutionSeconds = null;
        t.resumes++;
        st.open = t;
        join(t, m);
    }

    private void applyOutbound(ClientState st, Msg m) {
        if (st.open == null) {
            // A greeting or an operator-only closure opens nothing; a question
            // makes the client's «да» that follows an answer, not thanks.
            st.operatorSpokeLast = ReopenSignals.isSubstantiveOperatorMessage(m.txt());
            return;
        }
        st.operatorSpokeLast = false;
        String lower = m.txt().toLowerCase();
        st.open.messagesOut++;
        st.open.lastActivity = m.createdAt();
        if (st.open.firstResponseAt == null) {
            st.open.firstResponseAt = m.createdAt();
            st.open.firstResponder = m.author();
            st.open.frtSeconds = BusinessTime.secondsBetween(st.open.openedAt, m.createdAt());
        } else if (st.open.awaitingSince != null) {
            // A reply to a waiting client: the wait counts once, from their
            // oldest unanswered message, not once per message.
            st.open.replies++;
            st.open.replySeconds += BusinessTime.secondsBetween(st.open.awaitingSince, m.createdAt());
        }
        st.open.awaitingSince = null;
        if (st.open.inProgressAt == null
                && (lower.contains("заявка в работе") || lower.contains("в работе заявка"))) {
            st.open.inProgressAt = m.createdAt();
            st.open.pickupSeconds = BusinessTime.secondsBetween(st.open.openedAt, m.createdAt());
        }
        String closingStatus = ClosurePhrase.statusOf(m.txt());
        if (closingStatus != null) {
            close(st, m, closingStatus);
        } else {
            dirty.add(st.open);
        }
    }

    private void close(ClientState st, Msg m, String status) {
        st.open.status = status;
        st.open.closedAt = m.createdAt();
        st.open.closedBy = m.author();
        st.open.resolutionSeconds = BusinessTime.secondsBetween(st.open.openedAt, m.createdAt());
        dirty.add(st.open);
        st.lastEnded = st.open;
        st.open = null;
    }

    /**
     * A client first seen in this run. The operator-question flag is only
     * needed while no ticket is open; an operator message after the last
     * ticket ended was written with none open.
     */
    private ClientState load(Msg first) {
        ClientState st = new ClientState();
        st.open = store.open(first.client());
        if (st.open == null) {
            st.lastEnded = store.lastEnded(first.client());
            Msg previous = store.previous(first);
            LocalDateTime endedAt = st.lastEnded == null ? null
                    : st.lastEnded.closedAt != null ? st.lastEnded.closedAt : st.lastEnded.lastActivity;
            st.operatorSpokeLast = previous != null && !previous.inbound()
                    && (endedAt == null || previous.createdAt().isAfter(endedAt))
                    && ReopenSignals.isSubstantiveOperatorMessage(previous.txt());
        }
        return st;
    }
}
