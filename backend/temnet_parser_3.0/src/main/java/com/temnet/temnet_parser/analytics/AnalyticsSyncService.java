package com.temnet.temnet_parser.analytics;

import com.temnet.temnet_parser.support.BusinessTime;
import com.temnet.temnet_parser.support.CategoryRules;
import com.temnet.temnet_parser.support.ClosurePhrase;
import com.temnet.temnet_parser.support.ReopenSignals;
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
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
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
 * Per message: the two MAM copies are collapsed into one by the stanza id
 * extracted from the archived XML, and the author is the owner of the pair's
 * FIRST row — the server archives the sender's copy before the recipient's
 * (verified on the whole dump). Then a per-client state
 * machine maintains tickets: a client message opens a ticket (unless it is a
 * short "thanks" right after a closure), an operator closure phrase closes
 * it, long silence expires it, and a quick return after a closure is scored
 * as a probable reopen (marker words + same category).
 */
@Service
public class AnalyticsSyncService {

    private static final Logger log = LoggerFactory.getLogger(AnalyticsSyncService.class);

    private static final int BATCH_SIZE = 20_000;

    // The two MAM copies of one message are written microseconds apart and sit
    // within ~17 ids of each other on real data. The margin keeps a full batch
    // from splitting a pair; the window separates twins from reused stanza ids.
    private static final int TWIN_MARGIN = 32;
    private static final long TWIN_WINDOW_MICROS = 1_000_000;

    // Windows in WORKING seconds (08:00-18:00 Mon-Fri, see BusinessTime).
    private static final long ACK_WINDOW_SECONDS = 4 * 3600;     // "спасибо" after a closure
    private static final long REOPEN_WINDOW_SECONDS = 10 * 3600; // one working day
    private static final long STALE_OPEN_SECONDS = 20 * 3600;    // silence that expires an open ticket

    /** A binary string in an Erlang term: {@code <<"name">>}. */
    private static final Pattern ERLANG_BINARY = Pattern.compile("<<\"([^\"]*)\">>");

    private final JdbcClient source;
    private final JdbcTemplate analytics;
    private final NamedParameterJdbcTemplate analyticsNamed;
    private final TransactionTemplate tx;
    private final CacheManager cacheManager;
    private final LlmReopenClassifier llmClassifier;
    private final String operatorPrefix;
    /**
     * Zone the dump's timestamps are written in and the zone the working
     * hours (BusinessTime) are defined in. ejabberd usually archives in UTC
     * while the desk works in local time; when both are configured every
     * timestamp is shifted at ingest, so 08:00-18:00 means the desk's day.
     * Both null = timestamps are taken as they are.
     */
    private final ZoneId sourceZone;
    private final ZoneId businessZone;

    public AnalyticsSyncService(
            JdbcClient source,
            @Qualifier("analyticsJdbcTemplate") JdbcTemplate analytics,
            JdbcTransactionManager analyticsTxManager,
            CacheManager cacheManager,
            LlmReopenClassifier llmClassifier,
            @Value("${app.operator-prefix:help}") String operatorPrefix,
            @Value("${app.time.source-zone:}") String sourceZone,
            @Value("${app.time.business-zone:}") String businessZone) {
        this.source = source;
        this.analytics = analytics;
        this.analyticsNamed = new NamedParameterJdbcTemplate(analytics);
        this.tx = new TransactionTemplate(analyticsTxManager);
        this.cacheManager = cacheManager;
        this.llmClassifier = llmClassifier;
        this.operatorPrefix = operatorPrefix;
        this.sourceZone = zone(sourceZone);
        this.businessZone = zone(businessZone);
        if ((this.sourceZone == null) != (this.businessZone == null)) {
            throw new IllegalArgumentException(
                    "app.time.source-zone and app.time.business-zone must be set together (or both left empty)");
        }
        if (this.sourceZone != null) {
            log.info("Dump timestamps are converted from {} to {} at ingest", this.sourceZone, this.businessZone);
        }
    }

    private static ZoneId zone(String id) {
        return id == null || id.isBlank() ? null : ZoneId.of(id.strip());
    }

    /** A dump timestamp shifted into the zone the working hours are defined in. */
    private LocalDateTime toBusinessTime(LocalDateTime sourceTime) {
        if (sourceZone == null || businessZone == null || sourceZone.equals(businessZone)) {
            return sourceTime;
        }
        return sourceTime.atZone(sourceZone).withZoneSameInstant(businessZone).toLocalDateTime();
    }

    public record SyncSummary(boolean fullRebuild, long scannedRows, long newMessages, long llmClassified,
                              long watermark, long durationMs) {
    }

    /** Kinds of run, as shown on the maintenance screen. */
    public static final String KIND_SCHEDULED = "scheduled";
    public static final String KIND_INCREMENTAL = "incremental";
    public static final String KIND_REBUILD = "rebuild";

    private static final String STARTED_BY_SCHEDULER = "по расписанию";

    /**
     * What the sync is doing right now, or how the last attempt ended — the
     * only progress signal a caller gets, since a run is fire-and-forget.
     */
    public record SyncRun(String kind, String startedBy, LocalDateTime startedAt, LocalDateTime finishedAt,
                          boolean running, SyncSummary summary, String error) {

        SyncRun finished(SyncSummary result, String failure) {
            return new SyncRun(kind, startedBy, startedAt, LocalDateTime.now(), false, result, failure);
        }
    }

    // One run at a time: the ticket state machine walks the dump in order and
    // a rebuild truncates underneath it, so two of them must never overlap.
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicReference<SyncRun> lastRun = new AtomicReference<>();
    private final ExecutorService syncExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "analytics-sync");
        thread.setDaemon(true);
        return thread;
    });

    /** A normalized message of a client <-> support conversation. */
    private record Msg(long sourceId, String client, String author, String recipient, boolean inbound, String txt,
                       LocalDateTime createdAt, byte[] hash) {
    }

    /** A raw archive row: authorship and support-ness not yet resolved. */
    private record Raw(long id, String owner, String peer, String barePeer, String txt,
                       LocalDateTime createdAt, long tsMicros, String stanzaId) {
    }

    /**
     * The pair of tables a run writes to: the live ones for an incremental
     * sync, or the shadow copies a full rebuild fills before swapping them in.
     */
    private record Tables(String message, String ticket) {
        static final Tables LIVE = new Tables("message", "ticket");
        static final Tables REBUILD = new Tables("message_rebuild", "ticket_rebuild");
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
        SyncRun started;
        try {
            started = claim(KIND_SCHEDULED, STARTED_BY_SCHEDULER);
        } catch (IllegalStateException e) {
            log.debug("Scheduled sync skipped: {}", e.getMessage());
            return;
        }
        // Deliberately inline rather than on the executor: fixedDelay has to
        // measure from the end of a run, not from handing it off.
        run(started, false);
    }

    /** What the sync is doing right now, or how it last ended; null before the first run. */
    public SyncRun lastRun() {
        return lastRun.get();
    }

    /**
     * Starts a run on a background thread and returns its initial state at
     * once. A full rebuild re-ingests the entire dump and takes minutes — far
     * longer than an HTTP request may sit open — so callers poll
     * {@link #lastRun()} instead of waiting.
     *
     * @throws IllegalStateException if a run is already in flight
     */
    public SyncRun startAsync(boolean rebuild, String startedBy) {
        SyncRun started = claim(rebuild ? KIND_REBUILD : KIND_INCREMENTAL, startedBy);
        syncExecutor.execute(() -> run(started, rebuild));
        return started;
    }

    /** Takes the single run slot, or refuses. */
    private SyncRun claim(String kind, String startedBy) {
        if (!running.compareAndSet(false, true)) {
            throw new IllegalStateException("Синхронизация уже выполняется");
        }
        SyncRun started = new SyncRun(kind, startedBy, LocalDateTime.now(), null, true, null, null);
        lastRun.set(started);
        return started;
    }

    private void run(SyncRun started, boolean rebuild) {
        SyncRun done;
        try {
            done = started.finished(sync(rebuild), null);
        } catch (Exception e) {
            log.error("{} sync failed", started.kind(), e);
            done = started.finished(null, e.getMessage() == null ? e.toString() : e.getMessage());
        }
        // Publish the outcome before freeing the slot: a poll must never see an
        // idle sync still carrying the previous run's result.
        lastRun.set(done);
        running.set(false);
    }

    public synchronized SyncSummary sync(boolean rebuild) {
        long startedAt = System.currentTimeMillis();
        long watermark = analytics.queryForObject("SELECT last_archive_id FROM sync_state WHERE id = 1", Long.class);
        Long maxId = source.sql("SELECT MAX(id) FROM archive")
                .query((rs, i) -> rs.getObject(1, Long.class))
                .list()
                .get(0);

        boolean full = rebuild || maxId == null || maxId < watermark;
        Tables tables = full ? Tables.REBUILD : Tables.LIVE;
        if (full) {
            log.info("Full rebuild (requested={}, source max id={}, watermark={})", rebuild, maxId, watermark);
            // A rebuild fills shadow tables and swaps them in at the very end:
            // the live tables keep serving the old data for the minutes it
            // takes, and a crash half-way leaves them untouched (the shadows
            // are simply dropped at the next attempt).
            prepareRebuildTables();
            watermark = 0;
        }

        TicketEngine engine = new TicketEngine(tables);
        long scanned = 0;
        long inserted = 0;

        while (true) {
            List<Raw> batch = fetchBatch(watermark);
            if (batch.isEmpty()) {
                break;
            }
            if (batch.size() == BATCH_SIZE) {
                // Trim a tail margin off full batches so a twin pair never
                // splits across two batches; the tail returns with the next one.
                batch = batch.subList(0, BATCH_SIZE - TWIN_MARGIN);
            }
            scanned += batch.size();
            long newWatermark = batch.get(batch.size() - 1).id();
            List<Msg> messages = normalizePairs(batch);

            inserted += tx.execute(status -> {
                long fresh = insertAndProcess(messages, engine, tables);
                if (!full) {
                    // The watermark describes the LIVE tables; during a rebuild
                    // it moves only once the shadows have replaced them.
                    analytics.update("UPDATE sync_state SET last_archive_id = ? WHERE id = 1", newWatermark);
                }
                return fresh;
            });
            watermark = newWatermark;
        }

        if (full) {
            swapRebuiltTables(watermark);
        }

        syncGroups();
        syncHelpAccountGroups();
        int llmClassified = llmClassifier.classifyPending();
        analytics.update(
                "UPDATE sync_state SET last_run_at = NOW(), messages_total = (SELECT COUNT(*) FROM message m) WHERE id = 1");

        if (full || inserted > 0 || llmClassified > 0) {
            // Metric responses are cached; new data must show up immediately.
            for (String name : cacheManager.getCacheNames()) {
                Cache cache = cacheManager.getCache(name);
                if (cache != null) {
                    cache.clear();
                }
            }
        }

        SyncSummary summary = new SyncSummary(full, scanned, inserted, llmClassified, watermark,
                System.currentTimeMillis() - startedAt);
        log.info("Sync done: {}", summary);
        return summary;
    }

    /** Next batch of raw archive rows after the watermark, oldest first. */
    private List<Raw> fetchBatch(long watermark) {
        return source.sql("""
                        SELECT id, username, peer, bare_peer, txt, created_at, timestamp, xml
                        FROM archive
                        WHERE id > :watermark AND txt IS NOT NULL
                        ORDER BY id
                        LIMIT %d
                        """.formatted(BATCH_SIZE))
                .param("watermark", watermark)
                .query((rs, i) -> new Raw(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5).strip(), toBusinessTime(rs.getTimestamp(6).toLocalDateTime()),
                        rs.getLong(7), stanzaId(rs.getBytes(8))))
                .list();
    }

    /**
     * Collapses the two MAM copies of each message into one and resolves the
     * author: the server archives the sender's copy before the recipient's,
     * so within a twin pair — same stanza id, same text, written microseconds
     * apart — the first row's owner is the author (verified on the whole
     * dump: 92502/92502 checkable pairs). Rows without a twin fall back to
     * the per-row resource heuristic; it cannot tell the sides apart when
     * both copies carry a peer resource, which is how mirrored in/out
     * duplicates used to appear.
     */
    private List<Msg> normalizePairs(List<Raw> batch) {
        List<Msg> result = new ArrayList<>(batch.size() / 2 + 8);
        Map<String, Raw> pending = new HashMap<>();
        for (Raw row : batch) {
            if (row.txt().isEmpty()) {
                continue; // MAM service row (receipt / chat marker)
            }
            if (row.stanzaId() == null) {
                addIfSupport(result, singleton(row));
                continue;
            }
            Raw first = pending.get(row.stanzaId());
            if (first != null && first.txt().equals(row.txt())
                    && row.tsMicros() - first.tsMicros() < TWIN_WINDOW_MICROS) {
                pending.remove(row.stanzaId());
                addIfSupport(result, message(first.id(), first.owner(), local(first.barePeer()),
                        first.txt(), first.createdAt(), first.stanzaId()));
            } else {
                Raw replaced = pending.put(row.stanzaId(), row);
                if (replaced != null) {
                    addIfSupport(result, singleton(replaced)); // stanza id reused by a later message
                }
            }
        }
        for (Raw leftover : pending.values()) {
            addIfSupport(result, singleton(leftover));
        }
        return result;
    }

    private static void addIfSupport(List<Msg> result, Msg msg) {
        if (msg != null) {
            result.add(msg);
        }
    }

    /** A row without a twin in the batch: the author comes from the resource heuristic. */
    private Msg singleton(Raw row) {
        // The recipient's copy carries the sender's full jid with a /resource;
        // the sender's copy usually has a bare peer.
        String author = row.peer().contains("/") ? local(row.peer()) : row.owner();
        String counterpart = author.equals(row.owner()) ? local(row.barePeer()) : row.owner();
        return message(row.id(), author, counterpart, row.txt(), row.createdAt(), row.stanzaId());
    }

    /** Builds the normalized message; null when it is not a client <-> support conversation. */
    private Msg message(long sourceId, String author, String counterpart, String txt,
                        LocalDateTime createdAt, String stanzaId) {
        boolean authorIsOp = author.startsWith(operatorPrefix);
        if (authorIsOp == counterpart.startsWith(operatorPrefix)) {
            return null; // operator<->operator or client<->client — not a support conversation
        }
        String client = authorIsOp ? counterpart : author;
        return new Msg(sourceId, client, author, counterpart, !authorIsOp, txt, createdAt,
                dedupHash(client, txt, stanzaId != null ? stanzaId : createdAt.toString()));
    }

    /**
     * Stanza id from ejabberd's token-encoded archive XML: the id attribute is
     * stored as bytes {@code 0x0B 0x06}, a length byte, then the id itself.
     * Everything before it is header tokens and a printable /resource, so the
     * first marker occurrence is the id. Returns null when not found.
     */
    private static String stanzaId(byte[] xml) {
        if (xml == null) {
            return null;
        }
        for (int i = 0; i + 2 < xml.length; i++) {
            if (xml[i] == 0x0B && xml[i + 1] == 0x06) {
                int length = xml[i + 2] & 0xFF;
                int from = i + 3;
                if (length == 0 || from + length > xml.length) {
                    return null;
                }
                return new String(xml, from, length, StandardCharsets.UTF_8);
            }
        }
        return null;
    }

    /** Empty shadow copies of the live tables, structure and indexes included. */
    private void prepareRebuildTables() {
        analytics.execute("DROP TABLE IF EXISTS " + Tables.REBUILD.message());
        analytics.execute("DROP TABLE IF EXISTS " + Tables.REBUILD.ticket());
        analytics.execute("CREATE TABLE " + Tables.REBUILD.message() + " LIKE " + Tables.LIVE.message());
        analytics.execute("CREATE TABLE " + Tables.REBUILD.ticket() + " LIKE " + Tables.LIVE.ticket());
    }

    /**
     * Puts the rebuilt tables in place of the live ones in a single atomic
     * RENAME, then records the watermark they were built to. If the process
     * dies between the two, the next incremental run re-reads the rows after
     * the old watermark and finds every one of them already present.
     */
    private void swapRebuiltTables(long watermark) {
        analytics.execute("DROP TABLE IF EXISTS message_old");
        analytics.execute("DROP TABLE IF EXISTS ticket_old");
        analytics.execute("RENAME TABLE "
                + Tables.LIVE.message() + " TO message_old, "
                + Tables.REBUILD.message() + " TO " + Tables.LIVE.message() + ", "
                + Tables.LIVE.ticket() + " TO ticket_old, "
                + Tables.REBUILD.ticket() + " TO " + Tables.LIVE.ticket());
        analytics.update("UPDATE sync_state SET last_archive_id = ? WHERE id = 1", watermark);
        analytics.execute("DROP TABLE message_old");
        analytics.execute("DROP TABLE ticket_old");
        log.info("Rebuilt tables swapped in at watermark {}", watermark);
    }

    /**
     * Inserts the batch (dupes silently skipped via the unique dedup key) and
     * feeds ONLY the actually-new messages to the ticket state machine, in
     * chronological order. Runs inside one transaction with the watermark
     * update, so a crash never double-processes a message.
     */
    private long insertAndProcess(List<Msg> batch, TicketEngine engine, Tables tables) {
        if (batch.isEmpty()) {
            return 0;
        }
        analytics.batchUpdate("""
                        INSERT IGNORE INTO %s (source_id, client, author, recipient, direction, txt, created_at, dedup_hash)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """.formatted(tables.message()),
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
                "SELECT source_id FROM " + tables.message() + " WHERE source_id IN (:ids)",
                Map.of("ids", ids), Long.class));

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

    /**
     * Which groups each help desk serves, taken from ejabberd's shared-roster
     * configuration: {@code sr_group.opts} carries a {@code displayed_groups}
     * list, and {@code sr_user} says which help group an account belongs to
     * (the names differ — account {@code help-mag} sits in group
     * {@code help-magistr}). This is what the administrators configured, so no
     * heuristic over the correspondence can beat it: it is right the moment a
     * desk is set up and it follows a hand-over immediately.
     * <p>
     * Both source tables are tiny, so this runs on every sync — a change in
     * ejabberd reaches the permissions within one sync interval.
     */
    private void syncHelpAccountGroups() {
        Map<String, List<String>> served = new HashMap<>();
        source.sql("SELECT name, opts FROM sr_group WHERE name LIKE :prefix")
                .param("prefix", operatorPrefix + "%")
                .query((rs, i) -> Map.entry(rs.getString("name"), displayedGroups(rs.getString("opts"))))
                .list()
                .forEach(e -> served.put(e.getKey().toLowerCase(), e.getValue()));

        // An account can sit in several help groups; it then serves the union.
        List<Object[]> rows = source.sql(
                        "SELECT DISTINCT SUBSTRING_INDEX(jid, '@', 1) AS account, grp FROM sr_user WHERE grp LIKE :prefix")
                .param("prefix", operatorPrefix + "%")
                .query((rs, i) -> Map.entry(rs.getString("account"), rs.getString("grp").toLowerCase()))
                .list().stream()
                .flatMap(e -> served.getOrDefault(e.getValue(), List.of()).stream()
                        .map(grp -> new Object[]{e.getKey(), grp}))
                .distinct()
                .toList();

        tx.executeWithoutResult(status -> {
            analytics.update("DELETE FROM help_account_group");
            analytics.batchUpdate("INSERT IGNORE INTO help_account_group (account, grp) VALUES (?, ?)", rows);
        });
        log.debug("Help account scopes rebuilt: {} pairs", rows.size());
    }

    /**
     * Pulls the group names out of an Erlang {@code opts} term. Only the
     * {@code displayed_groups} list is read; the {@code label} next to it is
     * encoded as a byte list, not as a binary string, so it cannot be mistaken
     * for a group name. Service groups are dropped — a desk may display another
     * desk's group, which is not a client organization.
     */
    private List<String> displayedGroups(String opts) {
        if (opts == null) {
            return List.of();
        }
        int marker = opts.indexOf("displayed_groups");
        if (marker < 0) {
            return List.of();
        }
        int open = opts.indexOf('[', marker);
        int close = opts.indexOf(']', open);
        if (open < 0 || close < 0) {
            return List.of();
        }
        List<String> groups = new ArrayList<>();
        Matcher m = ERLANG_BINARY.matcher(opts.substring(open, close));
        while (m.find()) {
            String grp = m.group(1);
            if (!grp.toLowerCase().startsWith(operatorPrefix) && !grp.equals("all")) {
                groups.add(grp);
            }
        }
        return groups;
    }

    private static String local(String jid) {
        int at = jid.indexOf('@');
        return at < 0 ? jid : jid.substring(0, at);
    }

    /**
     * The author is deliberately NOT part of the key: if a twin pair ever does
     * split (dump grows mid-sync) and the copies resolve to different authors,
     * the second copy must still collide with the first instead of inserting
     * a mirrored duplicate.
     */
    private static byte[] dedupHash(String client, String txt, String identity) {
        try {
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            sha1.update(client.getBytes(StandardCharsets.UTF_8));
            sha1.update((byte) 0);
            sha1.update(identity.getBytes(StandardCharsets.UTF_8));
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

        private final Tables tables;
        private final Map<String, ClientState> states = new HashMap<>();
        private final Set<Ticket> dirty = new LinkedHashSet<>();

        TicketEngine(Tables tables) {
            this.tables = tables;
        }

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
                if (st.open.awaitingSince == null) {
                    st.open.awaitingSince = m.createdAt();
                }
                int rank = CategoryRules.rankOf(m.txt());
                if (rank < st.open.categoryRank) {
                    st.open.categoryRank = rank;
                }
                dirty.add(st.open);
                return;
            }

            // "спасибо" after a closure is not a new ticket — but "не помогло"
            // is, however short: ReopenSignals checks the markers first.
            if (st.lastClosed != null
                    && ReopenSignals.isAck(m.txt())
                    && BusinessTime.secondsBetween(st.lastClosed.closedAt, m.createdAt()) <= ACK_WINDOW_SECONDS) {
                st.lastClosed.thanked = true;
                dirty.add(st.lastClosed);
                return;
            }

            Ticket ticket = new Ticket(m.client(), m.createdAt());
            // The desk this ticket belongs to: whoever the client addressed.
            ticket.account = m.recipient();
            ticket.categoryRank = CategoryRules.rankOf(m.txt());
            ticket.messagesIn = 1;
            if (st.lastClosed != null
                    && BusinessTime.secondsBetween(st.lastClosed.closedAt, m.createdAt()) <= REOPEN_WINDOW_SECONDS) {
                int score = 0;
                if (ReopenSignals.isReopenMarker(m.txt())) {
                    score += 2;
                }
                if (ticket.categoryRank == st.lastClosed.categoryRank
                        && ticket.categoryRank != CategoryRules.otherRank()) {
                    score += 1;
                }
                ticket.reopenedFrom = st.lastClosed.id;
                ticket.reopenScore = score;
                if (score == 0) {
                    // No heuristic signal — an ambiguous candidate for the LLM.
                    ticket.reopenLlm = "pending";
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
            st.lastClosed = st.open;
            st.open = null;
        }

        private ClientState load(String client) {
            ClientState st = new ClientState();
            st.open = latest(client, "status = 'open'", null);
            st.lastClosed = latest(client, "status IN ('closed','rejected')", "closed_at");
            return st;
        }

        private Ticket latest(String client, String statusFilter, String orderBy) {
            List<Ticket> found = analytics.query(
                    "SELECT id, client, account, opened_at, last_activity, first_response_at, first_responder, frt_seconds,"
                            + " in_progress_at, pickup_seconds, closed_at, closed_by, resolution_seconds, status,"
                            + " category_rank, messages_in, messages_out, reopened_from, reopen_score, reopen_llm,"
                            + " thanked, awaiting_since, replies, reply_seconds"
                            + " FROM " + tables.ticket() + " WHERE client = ? AND " + statusFilter
                            + " ORDER BY " + (orderBy == null ? "opened_at" : orderBy) + " DESC LIMIT 1",
                    (rs, i) -> {
                        Ticket t = new Ticket(rs.getString("client"), rs.getTimestamp("opened_at").toLocalDateTime());
                        t.account = rs.getString("account");
                        t.id = rs.getLong("id");
                        t.lastActivity = rs.getTimestamp("last_activity").toLocalDateTime();
                        t.firstResponseAt = toLocal(rs.getTimestamp("first_response_at"));
                        t.firstResponder = rs.getString("first_responder");
                        long frt = rs.getLong("frt_seconds");
                        t.frtSeconds = rs.wasNull() ? null : frt;
                        t.inProgressAt = toLocal(rs.getTimestamp("in_progress_at"));
                        long pickup = rs.getLong("pickup_seconds");
                        t.pickupSeconds = rs.wasNull() ? null : pickup;
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
                        t.reopenLlm = rs.getString("reopen_llm");
                        t.thanked = rs.getBoolean("thanked");
                        t.awaitingSince = toLocal(rs.getTimestamp("awaiting_since"));
                        t.replies = rs.getInt("replies");
                        t.replySeconds = rs.getLong("reply_seconds");
                        return t;
                    },
                    client);
            return found.isEmpty() ? null : found.get(0);
        }

        private void insert(Ticket t) {
            GeneratedKeyHolder keys = new GeneratedKeyHolder();
            analytics.update(con -> {
                PreparedStatement ps = con.prepareStatement("""
                                INSERT INTO %s (client, account, opened_at, last_activity, stale_at,
                                                first_response_at, first_responder, frt_seconds, in_progress_at,
                                                closed_at, closed_by, resolution_seconds, status, category,
                                                category_rank, messages_in, messages_out, reopened_from,
                                                reopen_score, reopen_llm, pickup_seconds, thanked,
                                                awaiting_since, replies, reply_seconds)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                """.formatted(tables.ticket()),
                        Statement.RETURN_GENERATED_KEYS);
                fillTicket(ps, t);
                return ps;
            }, keys);
            t.id = keys.getKey().longValue();
        }

        void flushDirty() {
            for (Ticket t : dirty) {
                analytics.update("""
                                UPDATE %s SET last_activity = ?, stale_at = ?, first_response_at = ?,
                                              first_responder = ?, frt_seconds = ?, in_progress_at = ?,
                                              closed_at = ?, closed_by = ?, resolution_seconds = ?, status = ?,
                                              category = ?, category_rank = ?, messages_in = ?, messages_out = ?,
                                              reopened_from = ?, reopen_score = ?, reopen_llm = ?,
                                              pickup_seconds = ?, thanked = ?, awaiting_since = ?,
                                              replies = ?, reply_seconds = ?
                                WHERE id = ?
                                """.formatted(tables.ticket()),
                        Timestamp.valueOf(t.lastActivity),
                        Timestamp.valueOf(staleAt(t)),
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
                        t.reopenLlm,
                        t.pickupSeconds,
                        t.thanked,
                        toTimestamp(t.awaitingSince),
                        t.replies,
                        t.replySeconds,
                        t.id);
            }
            dirty.clear();
        }

        private void fillTicket(PreparedStatement ps, Ticket t) throws java.sql.SQLException {
            ps.setString(1, t.client);
            ps.setString(2, t.account);
            ps.setTimestamp(3, Timestamp.valueOf(t.openedAt));
            ps.setTimestamp(4, Timestamp.valueOf(t.lastActivity));
            ps.setTimestamp(5, Timestamp.valueOf(staleAt(t)));
            ps.setTimestamp(6, toTimestamp(t.firstResponseAt));
            ps.setString(7, t.firstResponder);
            setNullableLong(ps, 8, t.frtSeconds);
            ps.setTimestamp(9, toTimestamp(t.inProgressAt));
            ps.setTimestamp(10, toTimestamp(t.closedAt));
            ps.setString(11, t.closedBy);
            setNullableLong(ps, 12, t.resolutionSeconds);
            ps.setString(13, t.status);
            ps.setString(14, CategoryRules.nameOf(t.categoryRank));
            ps.setInt(15, t.categoryRank);
            ps.setInt(16, t.messagesIn);
            ps.setInt(17, t.messagesOut);
            setNullableLong(ps, 18, t.reopenedFrom);
            ps.setInt(19, t.reopenScore);
            ps.setString(20, t.reopenLlm);
            setNullableLong(ps, 21, t.pickupSeconds);
            ps.setBoolean(22, t.thanked);
            ps.setTimestamp(23, toTimestamp(t.awaitingSince));
            ps.setInt(24, t.replies);
            ps.setLong(25, t.replySeconds);
        }

        /**
         * When this ticket's silence would cross the expiry threshold — derived
         * from lastActivity on every write, so the column can never drift from
         * the value {@link #applyInbound} compares against.
         */
        private LocalDateTime staleAt(Ticket t) {
            return BusinessTime.plusBusinessSeconds(t.lastActivity, STALE_OPEN_SECONDS);
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
