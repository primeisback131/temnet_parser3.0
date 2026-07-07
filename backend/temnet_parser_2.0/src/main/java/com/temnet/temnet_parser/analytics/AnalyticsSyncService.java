package com.temnet.temnet_parser.analytics;

import com.temnet.temnet_parser.support.BusinessTime;
import com.temnet.temnet_parser.support.CategoryRules;
import com.temnet.temnet_parser.support.SqlLoader;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Pulls new rows from the ejabberd dump into the analytics DB.
 *
 * The dump is refreshed by re-importing the production database, so
 * {@code archive.id} keeps growing across refreshes and the sync is
 * incremental by an id watermark. If the dump is ever replaced with an older
 * or different one (max id below the watermark), everything is rebuilt from
 * scratch. Runs on a schedule and via POST /admin/sync.
 *
 * Per message: MAM double copies are collapsed (both copies hash to the same
 * dedup key once the true author is recovered), then a per-client state
 * machine maintains tickets: a client message opens a ticket (unless it is a
 * short "thanks" right after a closure), an operator closure phrase closes
 * it, long silence expires it, and a quick return after a closure is scored
 * as a probable reopen (marker words + same category).
 */
@Service
public class AnalyticsSyncService {

    private static final Logger log = LoggerFactory.getLogger(AnalyticsSyncService.class);

    private static final int BATCH_SIZE = 20_000;

    // Windows in WORKING seconds (08:00-18:00 Mon-Fri, see BusinessTime).
    private static final long ACK_WINDOW_SECONDS = 4 * 3600;     // "спасибо" after a closure
    private static final long REOPEN_WINDOW_SECONDS = 10 * 3600; // one working day
    private static final long STALE_OPEN_SECONDS = 20 * 3600;    // silence that expires an open ticket

    private static final Pattern ACK = Pattern.compile(
            "\\b(спасибо|благодарю|благодарим|ок|окей|хорошо|понял|поняла|понятно|принято|отлично|супер|ага|угу)\\b",
            Pattern.UNICODE_CHARACTER_CLASS);
    private static final Pattern REOPEN_MARKERS = Pattern.compile(
            "опять|снова|не помог|та же|тот же|всё ещё|все еще|повторн|прежнему|так и не");

    private final JdbcClient source;
    private final JdbcTemplate analytics;
    private final NamedParameterJdbcTemplate analyticsNamed;
    private final TransactionTemplate tx;
    private final CacheManager cacheManager;
    private final String operatorPrefix;

    public AnalyticsSyncService(
            JdbcClient source,
            @Qualifier("analyticsJdbcTemplate") JdbcTemplate analytics,
            JdbcTransactionManager analyticsTxManager,
            CacheManager cacheManager,
            @Value("${app.operator-prefix:help}") String operatorPrefix) {
        this.source = source;
        this.analytics = analytics;
        this.analyticsNamed = new NamedParameterJdbcTemplate(analytics);
        this.tx = new TransactionTemplate(analyticsTxManager);
        this.cacheManager = cacheManager;
        this.operatorPrefix = operatorPrefix;
    }

    public record SyncSummary(boolean fullRebuild, long scannedRows, long newMessages, long watermark,
                              long durationMs) {
    }

    /** A normalized message of a client <-> support conversation. */
    private record Msg(long sourceId, String client, String author, String recipient, boolean inbound, String txt,
                       LocalDateTime createdAt, byte[] hash) {
    }

    @PostConstruct
    void initSchema() {
        String withoutComments = SqlLoader.load("analytics/schema.sql")
                .lines()
                .filter(line -> !line.stripLeading().startsWith("--"))
                .reduce("", (a, b) -> a + b + "\n");
        for (String statement : withoutComments.split(";")) {
            String trimmed = statement.strip();
            if (!trimmed.isEmpty()) {
                analytics.execute(trimmed);
            }
        }
    }

    @Scheduled(initialDelayString = "${app.sync.initial-delay:PT30S}", fixedDelayString = "${app.sync.interval:PT5M}")
    void scheduledSync() {
        try {
            sync(false);
        } catch (Exception e) {
            log.error("Scheduled sync failed", e);
        }
    }

    public synchronized SyncSummary sync(boolean rebuild) {
        long startedAt = System.currentTimeMillis();
        long watermark = analytics.queryForObject("SELECT last_archive_id FROM sync_state WHERE id = 1", Long.class);
        Long maxId = source.sql("SELECT MAX(id) FROM archive")
                .query((rs, i) -> rs.getObject(1, Long.class))
                .list()
                .get(0);

        boolean full = rebuild || maxId == null || maxId < watermark;
        if (full) {
            log.info("Full rebuild (requested={}, source max id={}, watermark={})", rebuild, maxId, watermark);
            analytics.execute("TRUNCATE TABLE ticket");
            analytics.execute("TRUNCATE TABLE message");
            analytics.update("UPDATE sync_state SET last_archive_id = 0 WHERE id = 1");
            watermark = 0;
        }

        TicketEngine engine = new TicketEngine();
        long scanned = 0;
        long inserted = 0;

        while (true) {
            long batchStartWatermark = watermark;
            List<Msg> batch = fetchBatch(batchStartWatermark);
            if (batch.isEmpty()) {
                long lastId = lastScannedId(batchStartWatermark);
                if (lastId > watermark) { // rows existed but none were support messages
                    watermark = lastId;
                    analytics.update("UPDATE sync_state SET last_archive_id = ? WHERE id = 1", watermark);
                    continue;
                }
                break;
            }
            scanned += batch.size();
            long newWatermark = batch.get(batch.size() - 1).sourceId();

            inserted += tx.execute(status -> {
                long fresh = insertAndProcess(batch, engine);
                analytics.update("UPDATE sync_state SET last_archive_id = ? WHERE id = 1", newWatermark);
                return fresh;
            });
            watermark = newWatermark;
        }

        syncGroups();
        analytics.update(
                "UPDATE sync_state SET last_run_at = NOW(), messages_total = (SELECT COUNT(*) FROM message m) WHERE id = 1");

        if (full || inserted > 0) {
            // Metric responses are cached; new data must show up immediately.
            for (String name : cacheManager.getCacheNames()) {
                Cache cache = cacheManager.getCache(name);
                if (cache != null) {
                    cache.clear();
                }
            }
        }

        SyncSummary summary =
                new SyncSummary(full, scanned, inserted, watermark, System.currentTimeMillis() - startedAt);
        log.info("Sync done: {}", summary);
        return summary;
    }

    /** Next batch of support-conversation messages after the watermark, normalized. */
    private List<Msg> fetchBatch(long watermark) {
        return source.sql("""
                        SELECT id, username, peer, bare_peer, txt, created_at
                        FROM archive
                        WHERE id > :watermark AND txt IS NOT NULL
                        ORDER BY id
                        LIMIT %d
                        """.formatted(BATCH_SIZE))
                .param("watermark", watermark)
                .query((rs, i) -> normalize(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getTimestamp(6).toLocalDateTime()))
                .list()
                .stream()
                .filter(Objects::nonNull)
                .toList();
    }

    /**
     * Highest archive id within the next batch window, so the watermark still
     * advances through stretches of non-support rows.
     */
    private long lastScannedId(long watermark) {
        Long id = source.sql("""
                        SELECT MAX(id) FROM (
                            SELECT id FROM archive WHERE id > :watermark ORDER BY id LIMIT %d
                        ) AS window_rows
                        """.formatted(BATCH_SIZE))
                .param("watermark", watermark)
                .query((rs, i) -> rs.getObject(1, Long.class))
                .list()
                .get(0);
        return id == null ? watermark : id;
    }

    private Msg normalize(long id, String owner, String peer, String barePeer, String rawTxt,
                          LocalDateTime createdAt) {
        String txt = rawTxt.strip();
        if (txt.isEmpty()) {
            return null; // MAM service row (receipt / chat marker)
        }
        String peerLocal = local(barePeer);
        boolean ownerIsOp = owner.startsWith(operatorPrefix);
        boolean peerIsOp = peerLocal.startsWith(operatorPrefix);
        if (ownerIsOp == peerIsOp) {
            return null; // operator<->operator or client<->client — not a support conversation
        }
        // The recipient's copy carries the sender's full jid with a /resource;
        // the sender's copy has a bare peer.
        String author = peer.contains("/") ? local(peer) : owner;
        String recipient = author.equals(owner) ? peerLocal : owner;
        String client = ownerIsOp ? peerLocal : owner;
        boolean inbound = !author.startsWith(operatorPrefix);
        return new Msg(id, client, author, recipient, inbound, txt, createdAt,
                dedupHash(client, author, txt, createdAt));
    }

    /**
     * Inserts the batch (dupes silently skipped via the unique dedup key) and
     * feeds ONLY the actually-new messages to the ticket state machine, in
     * chronological order. Runs inside one transaction with the watermark
     * update, so a crash never double-processes a message.
     */
    private long insertAndProcess(List<Msg> batch, TicketEngine engine) {
        analytics.batchUpdate("""
                        INSERT IGNORE INTO message (source_id, client, author, recipient, direction, txt, created_at, dedup_hash)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                batch,
                batch.size(),
                (ps, m) -> {
                    ps.setLong(1, m.sourceId());
                    ps.setString(2, m.client());
                    ps.setString(3, m.author());
                    ps.setString(4, m.recipient());
                    ps.setString(5, m.inbound() ? "in" : "out");
                    ps.setString(6, m.txt());
                    ps.setTimestamp(7, Timestamp.valueOf(m.createdAt()));
                    ps.setBytes(8, m.hash());
                });

        // Which of our source ids won the dedup race (driver batch results are
        // unreliable with bulk statements, so ask the table).
        List<Long> ids = batch.stream().map(Msg::sourceId).toList();
        Set<Long> freshIds = new HashSet<>(analyticsNamed.queryForList(
                "SELECT source_id FROM message WHERE source_id IN (:ids)", Map.of("ids", ids), Long.class));

        List<Msg> fresh = batch.stream()
                .filter(m -> freshIds.contains(m.sourceId()))
                .sorted(Comparator.comparing(Msg::createdAt).thenComparing(Msg::sourceId))
                .toList();
        fresh.forEach(engine::apply);
        engine.flushDirty();
        return fresh.size();
    }

    /** Full refresh of group membership (small table). */
    private void syncGroups() {
        List<Object[]> rows = source.sql("SELECT DISTINCT SUBSTRING_INDEX(jid, '@', 1), grp FROM sr_user")
                .query((rs, i) -> new Object[]{rs.getString(1), rs.getString(2)})
                .list();
        tx.executeWithoutResult(status -> {
            analytics.update("DELETE FROM client_group");
            analytics.batchUpdate("INSERT INTO client_group (client, grp) VALUES (?, ?)", rows);
        });
    }

    private static String local(String jid) {
        int at = jid.indexOf('@');
        return at < 0 ? jid : jid.substring(0, at);
    }

    private static byte[] dedupHash(String client, String author, String txt, LocalDateTime createdAt) {
        try {
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            sha1.update(client.getBytes(StandardCharsets.UTF_8));
            sha1.update((byte) 0);
            sha1.update(author.getBytes(StandardCharsets.UTF_8));
            sha1.update((byte) 0);
            sha1.update(createdAt.toString().getBytes(StandardCharsets.UTF_8));
            sha1.update((byte) 0);
            sha1.update(txt.getBytes(StandardCharsets.UTF_8));
            return sha1.digest();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * Per-client ticket state machine. State survives across batches within a
     * run; across runs it is reloaded from the ticket table itself (the open
     * ticket and the most recently closed one are all the state there is).
     */
    private class TicketEngine {

        private final Map<String, ClientState> states = new HashMap<>();
        private final Set<Ticket> dirty = new LinkedHashSet<>();

        private class ClientState {
            Ticket open;
            Ticket lastClosed;
        }

        void apply(Msg m) {
            ClientState st = states.computeIfAbsent(m.client(), this::load);
            if (m.inbound()) {
                applyInbound(st, m);
            } else {
                applyOutbound(st, m);
            }
        }

        private void applyInbound(ClientState st, Msg m) {
            if (st.open != null
                    && BusinessTime.secondsBetween(st.open.lastActivity, m.createdAt()) > STALE_OPEN_SECONDS) {
                st.open.status = "expired";
                dirty.add(st.open);
                st.open = null;
            }
            if (st.open != null) {
                st.open.messagesIn++;
                st.open.lastActivity = m.createdAt();
                int rank = CategoryRules.rankOf(m.txt());
                if (rank < st.open.categoryRank) {
                    st.open.categoryRank = rank;
                }
                dirty.add(st.open);
                return;
            }

            String lower = m.txt().toLowerCase();
            if (st.lastClosed != null
                    && isAck(lower, m.txt())
                    && BusinessTime.secondsBetween(st.lastClosed.closedAt, m.createdAt()) <= ACK_WINDOW_SECONDS) {
                return; // "спасибо" after a closure is not a new ticket
            }

            Ticket ticket = new Ticket(m.client(), m.createdAt());
            ticket.categoryRank = CategoryRules.rankOf(m.txt());
            ticket.messagesIn = 1;
            if (st.lastClosed != null
                    && BusinessTime.secondsBetween(st.lastClosed.closedAt, m.createdAt()) <= REOPEN_WINDOW_SECONDS) {
                int score = 0;
                if (REOPEN_MARKERS.matcher(lower).find()) {
                    score += 2;
                }
                if (ticket.categoryRank == st.lastClosed.categoryRank
                        && ticket.categoryRank != CategoryRules.otherRank()) {
                    score += 1;
                }
                if (score > 0) {
                    ticket.reopenedFrom = st.lastClosed.id;
                    ticket.reopenScore = score;
                }
            }
            insert(ticket);
            st.open = ticket;
        }

        private void applyOutbound(ClientState st, Msg m) {
            if (st.open == null) {
                return; // greeting or operator-only closure without an open ticket
            }
            String lower = m.txt().toLowerCase();
            st.open.messagesOut++;
            st.open.lastActivity = m.createdAt();
            if (st.open.firstResponseAt == null) {
                st.open.firstResponseAt = m.createdAt();
                st.open.firstResponder = m.author();
                st.open.frtSeconds = BusinessTime.secondsBetween(st.open.openedAt, m.createdAt());
            }
            if (st.open.inProgressAt == null
                    && (lower.contains("заявка в работе") || lower.contains("в работе заявка"))) {
                st.open.inProgressAt = m.createdAt();
            }
            if (lower.contains("закрыта заявка") || lower.contains("заявка закрыта")) {
                close(st, m, "closed");
            } else if (lower.contains("отклонена заявка") || lower.contains("заявка отклонена")) {
                close(st, m, "rejected");
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
            st.lastClosed = st.open;
            st.open = null;
        }

        private boolean isAck(String lower, String txt) {
            return txt.length() <= 10 || ACK.matcher(lower).find();
        }

        private ClientState load(String client) {
            ClientState st = new ClientState();
            st.open = latest(client, "status = 'open'", null);
            st.lastClosed = latest(client, "status IN ('closed','rejected')", "closed_at");
            return st;
        }

        private Ticket latest(String client, String statusFilter, String orderBy) {
            List<Ticket> found = analytics.query(
                    "SELECT id, client, opened_at, last_activity, first_response_at, first_responder, frt_seconds,"
                            + " in_progress_at, closed_at, closed_by, resolution_seconds, status, category_rank,"
                            + " messages_in, messages_out, reopened_from, reopen_score"
                            + " FROM ticket WHERE client = ? AND " + statusFilter
                            + " ORDER BY " + (orderBy == null ? "opened_at" : orderBy) + " DESC LIMIT 1",
                    (rs, i) -> {
                        Ticket t = new Ticket(rs.getString("client"), rs.getTimestamp("opened_at").toLocalDateTime());
                        t.id = rs.getLong("id");
                        t.lastActivity = rs.getTimestamp("last_activity").toLocalDateTime();
                        t.firstResponseAt = toLocal(rs.getTimestamp("first_response_at"));
                        t.firstResponder = rs.getString("first_responder");
                        long frt = rs.getLong("frt_seconds");
                        t.frtSeconds = rs.wasNull() ? null : frt;
                        t.inProgressAt = toLocal(rs.getTimestamp("in_progress_at"));
                        t.closedAt = toLocal(rs.getTimestamp("closed_at"));
                        t.closedBy = rs.getString("closed_by");
                        long resolution = rs.getLong("resolution_seconds");
                        t.resolutionSeconds = rs.wasNull() ? null : resolution;
                        t.status = rs.getString("status");
                        t.categoryRank = rs.getInt("category_rank");
                        t.messagesIn = rs.getInt("messages_in");
                        t.messagesOut = rs.getInt("messages_out");
                        long reopenedFrom = rs.getLong("reopened_from");
                        t.reopenedFrom = rs.wasNull() ? null : reopenedFrom;
                        t.reopenScore = rs.getInt("reopen_score");
                        return t;
                    },
                    client);
            return found.isEmpty() ? null : found.get(0);
        }

        private void insert(Ticket t) {
            GeneratedKeyHolder keys = new GeneratedKeyHolder();
            analytics.update(con -> {
                PreparedStatement ps = con.prepareStatement("""
                                INSERT INTO ticket (client, opened_at, last_activity, first_response_at, first_responder,
                                                    frt_seconds, in_progress_at, closed_at, closed_by, resolution_seconds,
                                                    status, category, category_rank, messages_in, messages_out,
                                                    reopened_from, reopen_score)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                """,
                        Statement.RETURN_GENERATED_KEYS);
                fillTicket(ps, t);
                return ps;
            }, keys);
            t.id = keys.getKey().longValue();
        }

        void flushDirty() {
            for (Ticket t : dirty) {
                analytics.update("""
                                UPDATE ticket SET last_activity = ?, first_response_at = ?, first_responder = ?,
                                                  frt_seconds = ?, in_progress_at = ?, closed_at = ?, closed_by = ?,
                                                  resolution_seconds = ?, status = ?, category = ?, category_rank = ?,
                                                  messages_in = ?, messages_out = ?, reopened_from = ?, reopen_score = ?
                                WHERE id = ?
                                """,
                        Timestamp.valueOf(t.lastActivity),
                        toTimestamp(t.firstResponseAt),
                        t.firstResponder,
                        t.frtSeconds,
                        toTimestamp(t.inProgressAt),
                        toTimestamp(t.closedAt),
                        t.closedBy,
                        t.resolutionSeconds,
                        t.status,
                        CategoryRules.nameOf(t.categoryRank),
                        t.categoryRank,
                        t.messagesIn,
                        t.messagesOut,
                        t.reopenedFrom,
                        t.reopenScore,
                        t.id);
            }
            dirty.clear();
        }

        private void fillTicket(PreparedStatement ps, Ticket t) throws java.sql.SQLException {
            ps.setString(1, t.client);
            ps.setTimestamp(2, Timestamp.valueOf(t.openedAt));
            ps.setTimestamp(3, Timestamp.valueOf(t.lastActivity));
            ps.setTimestamp(4, toTimestamp(t.firstResponseAt));
            ps.setString(5, t.firstResponder);
            setNullableLong(ps, 6, t.frtSeconds);
            ps.setTimestamp(7, toTimestamp(t.inProgressAt));
            ps.setTimestamp(8, toTimestamp(t.closedAt));
            ps.setString(9, t.closedBy);
            setNullableLong(ps, 10, t.resolutionSeconds);
            ps.setString(11, t.status);
            ps.setString(12, CategoryRules.nameOf(t.categoryRank));
            ps.setInt(13, t.categoryRank);
            ps.setInt(14, t.messagesIn);
            ps.setInt(15, t.messagesOut);
            setNullableLong(ps, 16, t.reopenedFrom);
            ps.setInt(17, t.reopenScore);
        }

        private void setNullableLong(PreparedStatement ps, int index, Long value) throws java.sql.SQLException {
            if (value == null) {
                ps.setNull(index, java.sql.Types.BIGINT);
            } else {
                ps.setLong(index, value);
            }
        }

        private LocalDateTime toLocal(Timestamp ts) {
            return ts == null ? null : ts.toLocalDateTime();
        }

        private Timestamp toTimestamp(LocalDateTime t) {
            return t == null ? null : Timestamp.valueOf(t);
        }
    }
}
