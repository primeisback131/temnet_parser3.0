-- Analytics DB schema (created automatically on startup, statements are
-- idempotent). The sync job normalizes the raw ejabberd archive into these
-- tables; all future metrics read from here instead of re-deriving tickets
-- with window functions on every request.

CREATE TABLE IF NOT EXISTS sync_state (
    id              TINYINT PRIMARY KEY,
    last_archive_id BIGINT NOT NULL DEFAULT 0,
    last_run_at     DATETIME NULL,
    messages_total  BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO sync_state (id, last_archive_id) VALUES (1, 0);

-- One row per REAL message of a client <-> support conversation: MAM double
-- copies collapsed (dedup_hash), true author recovered, service rows dropped.
CREATE TABLE IF NOT EXISTS message (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    source_id  BIGINT NOT NULL,
    client     VARCHAR(191) NOT NULL,
    author     VARCHAR(191) NOT NULL,
    recipient  VARCHAR(191) NOT NULL,
    direction  ENUM('in','out') NOT NULL,
    txt        MEDIUMTEXT NOT NULL,
    created_at DATETIME NOT NULL,
    dedup_hash BINARY(20) NOT NULL,
    UNIQUE KEY uq_message_dedup (dedup_hash),
    KEY idx_message_client_time (client, created_at),
    KEY idx_message_created (created_at),
    KEY idx_message_author (author)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A support ticket reconstructed by the ingest state machine. Lifecycle:
-- open -> closed/rejected (operator closure phrase) or expired (client went
-- silent and came back much later with a new issue). Tickets left 'open' at
-- the end of the data ARE the live backlog.
CREATE TABLE IF NOT EXISTS ticket (
    id                BIGINT AUTO_INCREMENT PRIMARY KEY,
    client            VARCHAR(191) NOT NULL,
    opened_at         DATETIME NOT NULL,
    last_activity     DATETIME NOT NULL,
    first_response_at DATETIME NULL,
    first_responder   VARCHAR(191) NULL,
    frt_seconds       BIGINT NULL,
    in_progress_at    DATETIME NULL,
    closed_at         DATETIME NULL,
    closed_by         VARCHAR(191) NULL,
    resolution_seconds BIGINT NULL,
    status            ENUM('open','closed','rejected','expired') NOT NULL DEFAULT 'open',
    category          VARCHAR(64) NOT NULL,
    category_rank     TINYINT NOT NULL,
    messages_in       INT NOT NULL DEFAULT 0,
    messages_out      INT NOT NULL DEFAULT 0,
    reopened_from     BIGINT NULL,
    reopen_score      TINYINT NOT NULL DEFAULT 0,
    KEY idx_ticket_client_status (client, status),
    KEY idx_ticket_client_closed (client, closed_at),
    KEY idx_ticket_opened (opened_at),
    KEY idx_ticket_closed (closed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Upgrades for databases created by an older version (no-ops on fresh ones).
-- frt_seconds / resolution_seconds are WORKING seconds, precomputed at ingest.
ALTER TABLE message ADD COLUMN IF NOT EXISTS recipient VARCHAR(191) NOT NULL DEFAULT '' AFTER author;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS first_responder VARCHAR(191) NULL AFTER first_response_at;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS frt_seconds BIGINT NULL AFTER first_responder;
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS resolution_seconds BIGINT NULL AFTER closed_by;

-- The moment a ticket's silence crosses the expiry threshold: last_activity
-- plus 20 WORKING hours, precomputed at ingest (business-time arithmetic can
-- not be done reliably in SQL). It is the ticket's "death by silence" time,
-- so COALESCE(closed_at, stale_at) is the moment a ticket stopped being open
-- whatever its status — that is what the open-backlog metric counts against.
-- Needed because expiry is LAZY: the engine only marks a ticket 'expired'
-- when the client writes again, so abandoned tickets stay 'open' forever.
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS stale_at DATETIME NULL AFTER last_activity;
ALTER TABLE ticket ADD INDEX IF NOT EXISTS idx_ticket_stale (stale_at);

-- LLM verdict for ambiguous reopen candidates (no marker words, different
-- category): 'pending' -> awaiting classification, 'same' -> confirmed the
-- same issue, 'new' -> a different issue. NULL for non-candidates and for
-- candidates already decided by the heuristics.
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS reopen_llm VARCHAR(10) NULL AFTER reopen_score;
ALTER TABLE ticket ADD INDEX IF NOT EXISTS idx_ticket_reopen_llm (reopen_llm);

-- LLM verdicts keyed by the ticket's natural identity, so a full rebuild
-- (which truncates `ticket`) never re-pays for already-classified cases.
CREATE TABLE IF NOT EXISTS llm_verdict (
    client    VARCHAR(191) NOT NULL,
    opened_at DATETIME NOT NULL,
    verdict   VARCHAR(10) NOT NULL,
    PRIMARY KEY (client, opened_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Group membership copied from the dump (sr_user), so analytics queries never
-- need the source DB.
CREATE TABLE IF NOT EXISTS client_group (
    client VARCHAR(191) NOT NULL,
    grp    VARCHAR(191) NOT NULL,
    PRIMARY KEY (client, grp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
