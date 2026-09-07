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
    KEY idx_message_author (author),
    KEY idx_message_recipient (recipient),
    KEY idx_message_source (source_id)
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

-- Desk-scoped queries filter on recipient as much as on author, and the sync
-- asks "which of these source ids made it in" for every batch: without these
-- two indexes each of those is a full scan of the biggest table.
ALTER TABLE message ADD INDEX IF NOT EXISTS idx_message_recipient (recipient);
ALTER TABLE message ADD INDEX IF NOT EXISTS idx_message_source (source_id);

-- The moment a ticket's silence crosses the expiry threshold: last_activity
-- plus 20 WORKING hours, precomputed at ingest (business-time arithmetic can
-- not be done reliably in SQL). It is the ticket's "death by silence" time,
-- so COALESCE(closed_at, stale_at) is the moment a ticket stopped being open
-- whatever its status — that is what the open-backlog metric counts against.
-- Needed because expiry is LAZY: the engine only marks a ticket 'expired'
-- when the client writes again, so abandoned tickets stay 'open' forever.
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS stale_at DATETIME NULL AFTER last_activity;
ALTER TABLE ticket ADD INDEX IF NOT EXISTS idx_ticket_stale (stale_at);

-- The support desk that handled the ticket: the account the client wrote to
-- when opening it. Access is granted per help account, so every ticket-level
-- query filters on this — a desk must not see another desk's work even when
-- both serve the same organization (a client can talk to two desks).
ALTER TABLE ticket ADD COLUMN IF NOT EXISTS account VARCHAR(191) NULL AFTER client;
ALTER TABLE ticket ADD INDEX IF NOT EXISTS idx_ticket_account (account);

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

-- Problem categories assigned by the LLM (for tickets the keyword dictionary
-- left in «Другое», or for every ticket in `all` mode), keyed like
-- llm_verdict so a rebuild re-applies them instead of asking again. The
-- category name is stored, not the rank: the dictionary's order may change.
CREATE TABLE IF NOT EXISTS llm_category (
    client    VARCHAR(191) NOT NULL,
    opened_at DATETIME NOT NULL,
    category  VARCHAR(64) NOT NULL,
    PRIMARY KEY (client, opened_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The verdict tables join tickets by their natural identity; this index
-- serves those joins and the classifiers' candidate queries.
ALTER TABLE ticket ADD INDEX IF NOT EXISTS idx_ticket_client_opened (client, opened_at);

-- Settings changed at runtime from the maintenance screen (LLM limits and
-- the like). They override the environment's defaults and survive restarts.
CREATE TABLE IF NOT EXISTS app_setting (
    name       VARCHAR(64) NOT NULL PRIMARY KEY,
    value      VARCHAR(255) NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(191) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which client groups each help account serves, copied by the sync job from
-- ejabberd's shared-roster configuration (sr_group.opts `displayed_groups`
-- joined with the account's help group in sr_user). Grants of type
-- 'help_account' expand through this table; it is NOT used to filter data,
-- only to list the groups a desk may see.
CREATE TABLE IF NOT EXISTS help_account_group (
    account VARCHAR(191) NOT NULL,
    grp     VARCHAR(191) NOT NULL,
    PRIMARY KEY (account, grp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Application accounts. Passwords are bcrypt hashes; `admin` sees everything
-- and manages users, `manager` sees the metrics of what user_grant allows, and
-- `user` is read-only: the company and per-user tables of its groups, without
-- the metrics dashboard, the chats or the Excel report.
CREATE TABLE IF NOT EXISTS app_user (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(64) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    full_name     VARCHAR(191) NULL,
    role          ENUM('admin','manager','user') NOT NULL DEFAULT 'manager',
    enabled       TINYINT(1) NOT NULL DEFAULT 1,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_app_user_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Installs created before the read-only role exist with the two-value enum;
-- MODIFY re-states the whole column, so re-running it is a no-op.
ALTER TABLE app_user MODIFY COLUMN role ENUM('admin','manager','user') NOT NULL DEFAULT 'manager';

-- A temporary password - generated at install or issued by an administrator -
-- has to be replaced by the account holder before anything else is allowed.
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER enabled;

-- One granted scope: a whole help account (expanded via help_account_group)
-- or a single client group. Metrics and chat access are granted separately —
-- chats expose the correspondence itself, aggregates do not.
CREATE TABLE IF NOT EXISTS user_grant (
    user_id     BIGINT NOT NULL,
    scope_type  ENUM('help_account','group') NOT NULL,
    scope_value VARCHAR(191) NOT NULL,
    can_metrics TINYINT(1) NOT NULL DEFAULT 1,
    can_chats   TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, scope_type, scope_value),
    CONSTRAINT fk_user_grant_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Group membership copied from the dump (sr_user), so analytics queries never
-- need the source DB.
CREATE TABLE IF NOT EXISTS client_group (
    client VARCHAR(191) NOT NULL,
    grp    VARCHAR(191) NOT NULL,
    PRIMARY KEY (client, grp),
    KEY idx_client_group_grp (grp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Group pickers and per-group reports look the table up by group name.
ALTER TABLE client_group ADD INDEX IF NOT EXISTS idx_client_group_grp (grp);
