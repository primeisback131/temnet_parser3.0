-- Minimal subset of the ejabberd schema used by temnet_parser.
-- Charset utf8mb4 so Cyrillic message text and LIKE-matching work correctly.

CREATE DATABASE IF NOT EXISTS ejabberd
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ejabberd;

DROP TABLE IF EXISTS archive;
DROP TABLE IF EXISTS sr_user;
DROP TABLE IF EXISTS sr_group;

-- Shared-roster groups (companies).
CREATE TABLE sr_group (
    name VARCHAR(191) NOT NULL,
    PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Membership: which jid belongs to which group.
CREATE TABLE sr_user (
    jid VARCHAR(191) NOT NULL,
    grp VARCHAR(191) NOT NULL,
    PRIMARY KEY (jid, grp),
    KEY idx_sr_user_grp (grp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Message archive (MAM). Only the columns the app reads are modelled.
CREATE TABLE archive (
    id         BIGINT NOT NULL AUTO_INCREMENT,
    username   VARCHAR(191) NOT NULL,
    peer       VARCHAR(191) NOT NULL,
    txt        TEXT,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    KEY idx_archive_username (username),
    KEY idx_archive_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
