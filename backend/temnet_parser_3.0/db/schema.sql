-- Minimal subset of the ejabberd schema used by temnet_parser — exactly the
-- columns the sync job reads. Charset utf8mb4 so Cyrillic message text and
-- LIKE-matching work correctly.

CREATE DATABASE IF NOT EXISTS ejabberd
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ejabberd;

DROP TABLE IF EXISTS archive;
DROP TABLE IF EXISTS sr_user;
DROP TABLE IF EXISTS sr_group;

-- Shared-roster groups: client organizations and help desks. `opts` is the
-- Erlang term ejabberd stores; for a help group its `displayed_groups` list
-- names the organizations the desk serves.
CREATE TABLE sr_group (
    name VARCHAR(191) NOT NULL,
    opts TEXT NOT NULL,
    PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Membership: which jid belongs to which group (clients to their
-- organization, help accounts to their help group).
CREATE TABLE sr_user (
    jid VARCHAR(191) NOT NULL,
    grp VARCHAR(191) NOT NULL,
    PRIMARY KEY (jid, grp),
    KEY idx_sr_user_grp (grp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Message archive (MAM). Every message is stored twice — once in each
-- participant's archive (`username` is the archive owner, `peer` the other
-- side; the recipient's copy carries the sender's full jid with a
-- /resource). `timestamp` is microseconds since the epoch, `xml` the
-- token-encoded stanza from which the sync extracts the stanza id that
-- pairs the two copies.
CREATE TABLE archive (
    id         BIGINT NOT NULL AUTO_INCREMENT,
    username   VARCHAR(191) NOT NULL,
    peer       VARCHAR(191) NOT NULL,
    bare_peer  VARCHAR(191) NOT NULL,
    txt        TEXT,
    created_at DATETIME NOT NULL,
    timestamp  BIGINT NOT NULL,
    xml        BLOB,
    PRIMARY KEY (id),
    KEY idx_archive_username (username),
    KEY idx_archive_bare_peer (bare_peer),
    KEY idx_archive_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
