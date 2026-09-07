package com.temnet.temnet_parser.analytics;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.stream.Stream;

/**
 * Claude Code CLI ({@code claude -p}) as the model transport, so the
 * classification runs on the machine owner's Claude subscription instead of
 * a pay-per-token API key. Every call is one short-lived {@code claude}
 * process: no tools, one turn, no session saved, the project's own settings
 * and MCP servers deliberately not loaded.
 * <p>
 * The subscription has a rolling five-hour usage window that the owner
 * shares with their interactive work, so this transport reads the window's
 * utilization from the CLI's event stream and stops calling once it crosses
 * a ceiling — a lower one while the owner is actively using Claude Code (a
 * session transcript changed recently), a higher one otherwise. Whatever is
 * left pending is picked up by a later sync run. Ceilings, the busy window,
 * the model and the pace are runtime settings ({@link LlmSettings}).
 * <p>
 * {@code ANTHROPIC_API_KEY} is removed from the child environment on
 * purpose: with it set, the CLI would bill the API instead of the
 * subscription, which is the one thing this transport exists to avoid.
 */
public final class ClaudeCliChat implements LlmChat {

    private static final Logger log = LoggerFactory.getLogger(ClaudeCliChat.class);

    /** The machine-level part of the configuration; the rest is {@link LlmSettings}. */
    public record Settings(String command, Path workDir, Path claudeHome, Duration timeout) {
    }

    /** What one {@code claude -p} run reported, parsed from its stream-json output. */
    record Outcome(
            String text,
            boolean error,
            String subtype,
            Double fiveHourUtilization,
            long fiveHourResetsAt,
            Double sevenDayUtilization,
            boolean usingOverage,
            double costUsd) {
    }

    /** The last usage reading; utilization only grows until the window resets. */
    record Reading(double fiveHour, long fiveHourResetsAt, Double sevenDay, Instant at) {
    }

    /** What {@code claude auth status} said, cached for a while. */
    record Auth(boolean loggedIn, String method, String subscription, String error, Instant checkedAt) {
    }

    private static final String MCP_FILE = "mcp.json";
    private static final String SETTINGS_FILE = "settings.json";
    private static final Duration AUTH_CACHE = Duration.ofMinutes(10);

    private final Settings settings;
    private final Supplier<LlmSettings> runtime;
    private final CallPacer pacer = new CallPacer();
    private final JsonMapper json = JsonMapper.builder().build();

    private volatile Reading lastReading;
    private volatile boolean overageSeen;
    private volatile Auth auth;
    private volatile long busyCheckedAt;
    private volatile boolean busyCached;

    public ClaudeCliChat(Settings settings, Supplier<LlmSettings> runtime) {
        this.settings = settings;
        this.runtime = runtime;
    }

    @Override
    public boolean enabled() {
        return true;
    }

    @Override
    public String kind() {
        return "claude-cli";
    }

    @Override
    public String describe() {
        return runtime.get().model() + " via Claude Code CLI (subscription)";
    }

    @Override
    public String complete(String systemPrompt, String userText) throws Exception {
        LlmSettings s = runtime.get();
        // The pause switch is read per call, so flipping it stops a run in progress, not just the next one.
        if (!s.enabled()) {
            throw new LlmUnavailableException("классификация поставлена на паузу");
        }
        Auth a = ensureAuth(false);
        if (!a.loggedIn()) {
            throw new LlmUnavailableException(a.error() != null ? a.error()
                    : "Claude Code не залогинен: выполните 'claude auth login' под учётной записью с подпиской");
        }
        String breach = ceilingBreach(lastReading, Instant.now().getEpochSecond(), isOwnerBusy(s),
                s.ceilingIdle(), s.ceilingBusy());
        if (breach != null) {
            throw new LlmUnavailableException(breach);
        }
        if (overageSeen) {
            throw new LlmUnavailableException(
                    "Claude Code сообщил об использовании платных usage credits; классификация остановлена");
        }

        pacer.await(s.requestsPerMinute());
        Outcome outcome = run(s.model(), systemPrompt, userText);
        remember(outcome);
        if (outcome.error()) {
            throw new IllegalStateException("Claude CLI: " + outcome.subtype() + ": " + CallPacer.head(outcome.text()));
        }
        return outcome.text().strip();
    }

    /**
     * Why a call must not be made now, or null. Pure so it can be tested:
     * a reading older than its window is ignored (the window has reset).
     */
    static String ceilingBreach(Reading reading, long nowEpochSeconds, boolean busy,
                                double idleCeiling, double busyCeiling) {
        if (reading == null || nowEpochSeconds >= reading.fiveHourResetsAt()) {
            return null;
        }
        double ceiling = busy ? busyCeiling : idleCeiling;
        if (reading.fiveHour() < ceiling) {
            return null;
        }
        long minutesLeft = Math.max(1, (reading.fiveHourResetsAt() - nowEpochSeconds) / 60);
        return String.format("5-часовое окно Claude занято на %.0f%% при потолке %.0f%% (%s), окно обновится через %d мин",
                reading.fiveHour() * 100, ceiling * 100,
                busy ? "владелец сейчас работает с Claude Code" : "владелец не работает с Claude Code",
                minutesLeft);
    }

    private void remember(Outcome outcome) {
        if (outcome.fiveHourUtilization() != null) {
            lastReading = new Reading(outcome.fiveHourUtilization(), outcome.fiveHourResetsAt(),
                    outcome.sevenDayUtilization(), Instant.now());
            log.debug("Claude usage: 5h window {}%, 7d window {}%, this call ${}",
                    Math.round(outcome.fiveHourUtilization() * 100),
                    outcome.sevenDayUtilization() == null ? "?" : Math.round(outcome.sevenDayUtilization() * 100),
                    outcome.costUsd());
        }
        if (outcome.usingOverage() && !overageSeen) {
            overageSeen = true;
            log.warn("Claude Code использует платные usage credits: дальнейшие вызовы остановлены. "
                    + "Отключите overage в claude.ai или примите расходы.");
        }
    }

    /** The current five-hour utilization as last seen, for the run summary log. */
    public String usageSummary() {
        Reading r = lastReading;
        return r == null ? "usage unknown" : "5h window " + Math.round(r.fiveHour() * 100) + "%";
    }

    @Override
    public Map<String, Object> telemetry() {
        LlmSettings s = runtime.get();
        Map<String, Object> t = new LinkedHashMap<>();
        Auth a = ensureAuth(true);
        t.put("loggedIn", a.loggedIn());
        t.put("authMethod", a.method());
        t.put("subscription", a.subscription());
        t.put("authError", a.error());
        t.put("authCheckedAt", a.checkedAt() == null ? null : a.checkedAt().toEpochMilli());
        Reading r = lastReading;
        long now = Instant.now().getEpochSecond();
        boolean fresh = r != null && now < r.fiveHourResetsAt();
        t.put("fiveHourUtilization", fresh ? r.fiveHour() : null);
        t.put("fiveHourResetsAt", fresh ? r.fiveHourResetsAt() * 1000 : null);
        t.put("sevenDayUtilization", r == null ? null : r.sevenDay());
        t.put("readingAt", r == null ? null : r.at().toEpochMilli());
        boolean busy = isOwnerBusy(s);
        t.put("ownerBusy", busy);
        t.put("ceilingNow", busy ? s.ceilingBusy() : s.ceilingIdle());
        t.put("overageSeen", overageSeen);
        t.put("pausedReason", overageSeen
                ? "используются платные usage credits"
                : ceilingBreach(r, now, busy, s.ceilingIdle(), s.ceilingBusy()));
        t.put("command", settings.command());
        return t;
    }

    // ---- owner activity -------------------------------------------------

    /**
     * True when a Claude Code session transcript under ~/.claude/projects
     * changed within the busy window. Headless runs save no session, so
     * this transport never sees itself. Cached for a minute.
     */
    private boolean isOwnerBusy(LlmSettings s) {
        long now = System.currentTimeMillis();
        if (now - busyCheckedAt < 60_000) {
            return busyCached;
        }
        busyCached = recentTranscriptExists(settings.claudeHome().resolve("projects"),
                Duration.ofMinutes(s.busyWindowMinutes()), Instant.ofEpochMilli(now));
        busyCheckedAt = now;
        return busyCached;
    }

    static boolean recentTranscriptExists(Path projectsDir, Duration window, Instant now) {
        if (window == null || window.isZero() || window.isNegative() || !Files.isDirectory(projectsDir)) {
            return false;
        }
        FileTime threshold = FileTime.from(now.minus(window));
        try (Stream<Path> files = Files.walk(projectsDir, 2)) {
            return files.anyMatch(p -> p.getFileName().toString().endsWith(".jsonl") && modifiedAfter(p, threshold));
        } catch (IOException e) {
            log.debug("Cannot scan {} for recent sessions: {}", projectsDir, e.getMessage());
            return false;
        }
    }

    private static boolean modifiedAfter(Path p, FileTime threshold) {
        try {
            return Files.getLastModifiedTime(p).compareTo(threshold) > 0;
        } catch (IOException e) {
            return false;
        }
    }

    // ---- the CLI process --------------------------------------------------

    /**
     * Runs {@code claude auth status} unless a recent answer is cached.
     * {@code quiet} (the screen) never throws; a failure becomes the
     * {@code error} of the returned record.
     */
    private Auth ensureAuth(boolean quiet) {
        Auth cached = auth;
        Instant now = Instant.now();
        if (cached != null && cached.checkedAt().plus(AUTH_CACHE).isAfter(now)
                && (cached.loggedIn() || quiet)) {
            return cached;
        }
        Auth fresh;
        try {
            prepareWorkDir();
            ProcessResult result = exec(List.of(settings.command(), "auth", "status"), null);
            JsonNode status = firstJson(result.stdout());
            if (status == null) {
                fresh = new Auth(false, null, null, "claude auth status не вернул JSON (команда '"
                        + settings.command() + "'): "
                        + CallPacer.head(result.stderr().isBlank() ? result.stdout() : result.stderr()), now);
            } else {
                boolean loggedIn = status.path("loggedIn").asBoolean(false);
                fresh = new Auth(loggedIn,
                        status.path("authMethod").isNull() ? null : status.path("authMethod").asString(null),
                        status.path("subscriptionType").isNull() ? null : status.path("subscriptionType").asString(null),
                        loggedIn ? null : "Claude Code не залогинен: выполните 'claude auth login' под учётной записью с подпиской",
                        now);
                if (loggedIn && (cached == null || !cached.loggedIn())) {
                    log.info("Claude CLI готов: вход через {}, подписка {}, модель {}",
                            fresh.method(), fresh.subscription() == null ? "-" : fresh.subscription(),
                            runtime.get().model());
                }
            }
        } catch (Exception e) {
            fresh = new Auth(false, null, null, e.getMessage(), now);
        }
        auth = fresh;
        return fresh;
    }

    private void prepareWorkDir() throws IOException {
        Files.createDirectories(settings.workDir());
        writeIfMissing(settings.workDir().resolve(MCP_FILE), "{\"mcpServers\":{}}");
        // Thinking off: the answers are one word, reasoning only adds latency and usage.
        writeIfMissing(settings.workDir().resolve(SETTINGS_FILE), "{\"alwaysThinkingEnabled\":false}");
    }

    private Outcome run(String model, String systemPrompt, String userText) throws Exception {
        Path systemFile = systemPromptFile(systemPrompt);
        List<String> command = List.of(
                settings.command(), "-p",
                "--model", model,
                "--system-prompt-file", systemFile.toString(),
                "--disallowedTools", "*",
                "--max-turns", "1",
                "--no-session-persistence",
                "--strict-mcp-config",
                "--mcp-config", settings.workDir().resolve(MCP_FILE).toString(),
                "--setting-sources", "",
                "--settings", settings.workDir().resolve(SETTINGS_FILE).toString(),
                "--effort", "low",
                "--output-format", "stream-json",
                "--verbose");
        ProcessResult result = exec(command, userText);
        Outcome outcome = parseStream(result.stdout());
        if (outcome == null) {
            throw new IllegalStateException("Claude CLI завершился с кодом " + result.exitCode()
                    + " без результата: " + CallPacer.head(result.stderr().isBlank() ? result.stdout() : result.stderr()));
        }
        return outcome;
    }

    /**
     * The result line and the usage event of a stream-json run; null when
     * the stream has no result (the process died or printed an error).
     */
    Outcome parseStream(String stdout) {
        String text = null;
        boolean error = false;
        String subtype = null;
        boolean sawResult = false;
        Double fiveHour = null;
        long fiveHourResets = 0;
        Double sevenDay = null;
        boolean overage = false;
        double cost = 0;

        for (String line : stdout.split("\r?\n")) {
            String trimmed = line.strip();
            if (!trimmed.startsWith("{")) {
                continue;
            }
            JsonNode node;
            try {
                node = json.readTree(trimmed);
            } catch (RuntimeException e) {
                continue;
            }
            String type = node.path("type").asString("");
            if ("result".equals(type)) {
                sawResult = true;
                text = node.path("result").asString("");
                error = node.path("is_error").asBoolean(false);
                subtype = node.path("subtype").asString("");
                cost = node.path("total_cost_usd").asDouble(0);
            } else if ("rate_limit_event".equals(type)) {
                JsonNode info = node.path("rate_limit_info");
                overage = info.path("isUsingOverage").asBoolean(false);
                JsonNode five = info.path("unifiedWindows").path("five_hour");
                if (five.has("utilization")) {
                    fiveHour = five.path("utilization").asDouble();
                    fiveHourResets = five.path("resetsAt").asLong(0);
                }
                JsonNode seven = info.path("unifiedWindows").path("seven_day");
                if (seven.has("utilization")) {
                    sevenDay = seven.path("utilization").asDouble();
                }
            }
        }
        return sawResult ? new Outcome(text, error, subtype, fiveHour, fiveHourResets, sevenDay, overage, cost) : null;
    }

    private JsonNode firstJson(String stdout) {
        int brace = stdout.indexOf('{');
        if (brace < 0) {
            return null;
        }
        try {
            return json.readTree(stdout.substring(brace));
        } catch (RuntimeException e) {
            return null;
        }
    }

    private Path systemPromptFile(String systemPrompt) throws IOException {
        Path file = settings.workDir().resolve("system-" + sha1(systemPrompt) + ".txt");
        writeIfMissing(file, systemPrompt);
        return file;
    }

    private static void writeIfMissing(Path file, String content) throws IOException {
        if (!Files.exists(file)) {
            Files.writeString(file, content, StandardCharsets.UTF_8);
        }
    }

    private static String sha1(String text) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-1");
            return HexFormat.of().formatHex(digest.digest(text.getBytes(StandardCharsets.UTF_8))).substring(0, 12);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private record ProcessResult(int exitCode, String stdout, String stderr) {
    }

    private ProcessResult exec(List<String> command, String stdin) throws IOException, InterruptedException {
        ProcessBuilder builder = new ProcessBuilder(command).directory(settings.workDir().toFile());
        Map<String, String> env = builder.environment();
        // Never let the CLI pick an API key: that would bill the API, not the subscription.
        env.remove("ANTHROPIC_API_KEY");
        env.remove("ANTHROPIC_AUTH_TOKEN");

        Process process;
        try {
            process = builder.start();
        } catch (IOException e) {
            throw new IOException("Не удалось запустить '" + settings.command()
                    + "': установите Claude Code или задайте CLAUDE_CLI с полным путём (" + e.getMessage() + ")", e);
        }
        StringBuilder stderr = new StringBuilder();
        Thread drain = Thread.ofVirtual().start(() -> drain(process.getErrorStream(), stderr));
        try (OutputStream in = process.getOutputStream()) {
            if (stdin != null) {
                in.write(stdin.getBytes(StandardCharsets.UTF_8));
            }
        }
        String stdout;
        try (InputStream out = process.getInputStream()) {
            stdout = new String(out.readAllBytes(), StandardCharsets.UTF_8);
        }
        if (!process.waitFor(settings.timeout().toMillis(), TimeUnit.MILLISECONDS)) {
            process.destroyForcibly();
            throw new IllegalStateException("Claude CLI не ответил за " + settings.timeout().toSeconds() + " с");
        }
        drain.join(1_000);
        return new ProcessResult(process.exitValue(), stdout, stderr.toString());
    }

    private static void drain(InputStream stream, StringBuilder into) {
        try (stream) {
            into.append(new String(stream.readAllBytes(), StandardCharsets.UTF_8));
        } catch (IOException ignored) {
            // the process is gone; whatever was read is enough for a message
        }
    }
}
