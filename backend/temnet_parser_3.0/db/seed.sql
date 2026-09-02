-- Test fixtures exercising the ingest and every report on a tiny dump.
--
-- Two help desks (`help` serves CompanyA and CompanyB, `help-mag` serves
-- CompanyB only), three clients, and conversations that walk the ticket
-- state machine through every state: open -> in progress -> closed, an
-- acknowledgement after a closure, a reopen with a marker word, a rejection,
-- a ticket expiring by silence, a singleton row without its MAM twin, a
-- service row and a client<->client message that must be dropped, and an old
-- conversation outside the reporting year.
--
-- Every message is written MAM-style, twice: the sender's copy first (bare
-- peer), then the recipient's copy (sender's full jid with a /resource) a
-- few microseconds later. Both carry the same stanza id in `xml`, encoded as
-- ejabberd does it: bytes 0B 06, a length byte, the id. All ids here are 5
-- characters long, hence the constant '0B0605' prefix.

USE ejabberd;

INSERT INTO sr_group (name, opts) VALUES
    ('CompanyA',     '[{displayed_groups,[<<"help-desk">>]}]'),
    ('CompanyB',     '[{displayed_groups,[<<"help-desk">>,<<"help-magistr">>]}]'),
    ('help-desk',    '[{displayed_groups,[<<"CompanyA">>,<<"CompanyB">>]},{label,"Help desk"}]'),
    ('help-magistr', '[{displayed_groups,[<<"CompanyB">>]},{label,"Magistr desk"}]'),
    ('all',          '[{all_users,true}]');

INSERT INTO sr_user (jid, grp) VALUES
    ('petrov@xmpp',   'CompanyA'),
    ('ivanov@xmpp',   'CompanyA'),
    ('sidorov@xmpp',  'CompanyB'),
    ('petrov@xmpp',   'all'),
    ('ivanov@xmpp',   'all'),
    ('sidorov@xmpp',  'all'),
    ('help@xmpp',     'help-desk'),
    ('help-mag@xmpp', 'help-magistr');

-- (username, peer, bare_peer, txt, created_at, timestamp in microseconds, xml with the stanza id)
INSERT INTO archive (username, peer, bare_peer, txt, created_at, timestamp, xml) VALUES
    -- An old conversation (2024): outside every 2025 report, but it seeds
    -- petrov's "last closed" state.
    ('petrov', 'help@xmpp',          'help@xmpp',   'старое сообщение', '2024-01-15 09:00:00', UNIX_TIMESTAMP('2024-01-15 09:00:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0001')))),
    ('help',   'petrov@xmpp/mobile', 'petrov@xmpp', 'старое сообщение', '2024-01-15 09:00:00', UNIX_TIMESTAMP('2024-01-15 09:00:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0001')))),
    ('help',   'petrov@xmpp',        'petrov@xmpp', 'закрыта заявка',   '2024-01-15 09:30:00', UNIX_TIMESTAMP('2024-01-15 09:30:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0002')))),
    ('petrov', 'help@xmpp/desk',     'help@xmpp',   'закрыта заявка',   '2024-01-15 09:30:00', UNIX_TIMESTAMP('2024-01-15 09:30:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0002')))),

    -- Mon 2025-06-02, petrov <-> help: open -> in progress -> closed (FRT 3 min,
    -- resolution 40 working minutes), then an acknowledgement, then a reopen
    -- with a marker word inside the reopen window, closed again.
    ('petrov', 'help@xmpp',          'help@xmpp',   'Здравствуйте, не работает принтер на 2 этаже', '2025-06-02 10:00:00', UNIX_TIMESTAMP('2025-06-02 10:00:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0101')))),
    ('help',   'petrov@xmpp/mobile', 'petrov@xmpp', 'Здравствуйте, не работает принтер на 2 этаже', '2025-06-02 10:00:00', UNIX_TIMESTAMP('2025-06-02 10:00:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0101')))),
    ('help',   'petrov@xmpp',        'petrov@xmpp', 'Принято, заявка в работе',                     '2025-06-02 10:03:00', UNIX_TIMESTAMP('2025-06-02 10:03:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0102')))),
    ('petrov', 'help@xmpp/desk',     'help@xmpp',   'Принято, заявка в работе',                     '2025-06-02 10:03:00', UNIX_TIMESTAMP('2025-06-02 10:03:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0102')))),
    ('help',   'petrov@xmpp',        'petrov@xmpp', 'Закрыта заявка',                               '2025-06-02 10:40:00', UNIX_TIMESTAMP('2025-06-02 10:40:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0103')))),
    ('petrov', 'help@xmpp/desk',     'help@xmpp',   'Закрыта заявка',                               '2025-06-02 10:40:00', UNIX_TIMESTAMP('2025-06-02 10:40:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0103')))),
    ('petrov', 'help@xmpp',          'help@xmpp',   'Спасибо!',                                     '2025-06-02 10:45:00', UNIX_TIMESTAMP('2025-06-02 10:45:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0104')))),
    ('help',   'petrov@xmpp/mobile', 'petrov@xmpp', 'Спасибо!',                                     '2025-06-02 10:45:00', UNIX_TIMESTAMP('2025-06-02 10:45:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0104')))),
    ('petrov', 'help@xmpp',          'help@xmpp',   'опять не печатает',                            '2025-06-02 11:30:00', UNIX_TIMESTAMP('2025-06-02 11:30:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0105')))),
    ('help',   'petrov@xmpp/mobile', 'petrov@xmpp', 'опять не печатает',                            '2025-06-02 11:30:00', UNIX_TIMESTAMP('2025-06-02 11:30:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0105')))),
    ('help',   'petrov@xmpp',        'petrov@xmpp', 'Проверяем',                                    '2025-06-02 11:35:00', UNIX_TIMESTAMP('2025-06-02 11:35:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0106')))),
    ('petrov', 'help@xmpp/desk',     'help@xmpp',   'Проверяем',                                    '2025-06-02 11:35:00', UNIX_TIMESTAMP('2025-06-02 11:35:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0106')))),
    ('help',   'petrov@xmpp',        'petrov@xmpp', 'заявка закрыта',                               '2025-06-02 12:00:00', UNIX_TIMESTAMP('2025-06-02 12:00:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0107')))),
    ('petrov', 'help@xmpp/desk',     'help@xmpp',   'заявка закрыта',                               '2025-06-02 12:00:00', UNIX_TIMESTAMP('2025-06-02 12:00:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0107')))),

    -- Tue 2025-06-03, ivanov <-> help: rejected.
    ('ivanov', 'help@xmpp',          'help@xmpp',   'не могу зайти в 1С, пишет неверный пароль', '2025-06-03 09:00:00', UNIX_TIMESTAMP('2025-06-03 09:00:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0201')))),
    ('help',   'ivanov@xmpp/pc',     'ivanov@xmpp', 'не могу зайти в 1С, пишет неверный пароль', '2025-06-03 09:00:00', UNIX_TIMESTAMP('2025-06-03 09:00:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0201')))),
    ('help',   'ivanov@xmpp',        'ivanov@xmpp', 'Отклонена заявка, обратитесь к бухгалтеру',  '2025-06-03 09:20:00', UNIX_TIMESTAMP('2025-06-03 09:20:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0202')))),
    ('ivanov', 'help@xmpp/desk',     'help@xmpp',   'Отклонена заявка, обратитесь к бухгалтеру',  '2025-06-03 09:20:00', UNIX_TIMESTAMP('2025-06-03 09:20:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0202')))),

    -- Wed 2025-06-04, sidorov <-> help-mag: never closed; expires by silence
    -- when sidorov writes again the following Monday (a new ticket, closed).
    ('sidorov',  'help-mag@xmpp',        'help-mag@xmpp', 'не работает интернет',              '2025-06-04 14:00:00', UNIX_TIMESTAMP('2025-06-04 14:00:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0301')))),
    ('help-mag', 'sidorov@xmpp/pc',      'sidorov@xmpp',  'не работает интернет',              '2025-06-04 14:00:00', UNIX_TIMESTAMP('2025-06-04 14:00:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0301')))),
    ('help-mag', 'sidorov@xmpp',         'sidorov@xmpp',  'Смотрим',                           '2025-06-04 14:05:00', UNIX_TIMESTAMP('2025-06-04 14:05:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0302')))),
    ('sidorov',  'help-mag@xmpp/desk',   'help-mag@xmpp', 'Смотрим',                           '2025-06-04 14:05:00', UNIX_TIMESTAMP('2025-06-04 14:05:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0302')))),
    ('sidorov',  'help-mag@xmpp',        'help-mag@xmpp', 'добрый день, нужен доступ к папке', '2025-06-09 09:00:00', UNIX_TIMESTAMP('2025-06-09 09:00:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0303')))),
    ('help-mag', 'sidorov@xmpp/pc',      'sidorov@xmpp',  'добрый день, нужен доступ к папке', '2025-06-09 09:00:00', UNIX_TIMESTAMP('2025-06-09 09:00:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0303')))),
    ('help-mag', 'sidorov@xmpp',         'sidorov@xmpp',  'закрыта заявка',                    '2025-06-09 09:10:00', UNIX_TIMESTAMP('2025-06-09 09:10:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0304')))),
    ('sidorov',  'help-mag@xmpp/desk',   'help-mag@xmpp', 'закрыта заявка',                    '2025-06-09 09:10:00', UNIX_TIMESTAMP('2025-06-09 09:10:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0304')))),

    -- Thu 2025-06-05, petrov <-> help: the client's message survives only as
    -- the recipient's copy (no twin) — the resource heuristic must still
    -- attribute it to petrov. Closed by a normal pair.
    ('help',   'petrov@xmpp/mobile', 'petrov@xmpp', 'проверьте пожалуйста почту, письма не приходят', '2025-06-05 15:00:00', UNIX_TIMESTAMP('2025-06-05 15:00:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0401')))),
    ('help',   'petrov@xmpp',        'petrov@xmpp', 'закрыта заявка',                                 '2025-06-05 15:30:00', UNIX_TIMESTAMP('2025-06-05 15:30:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0402')))),
    ('petrov', 'help@xmpp/desk',     'help@xmpp',   'закрыта заявка',                                 '2025-06-05 15:30:00', UNIX_TIMESTAMP('2025-06-05 15:30:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0402')))),

    -- Rows the ingest must drop: a MAM service row (empty text) and a
    -- client <-> client message that is not a support conversation.
    ('petrov', 'help@xmpp',          'help@xmpp',   '',                       '2025-06-05 15:31:00', UNIX_TIMESTAMP('2025-06-05 15:31:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0403')))),
    ('ivanov', 'petrov@xmpp',        'petrov@xmpp', 'обед сегодня в 13:00?',  '2025-06-05 12:00:00', UNIX_TIMESTAMP('2025-06-05 12:00:00') * 1000000,        UNHEX(CONCAT('0B0605', HEX('m0501')))),
    ('petrov', 'ivanov@xmpp/pc',     'ivanov@xmpp', 'обед сегодня в 13:00?',  '2025-06-05 12:00:00', UNIX_TIMESTAMP('2025-06-05 12:00:00') * 1000000 + 1500, UNHEX(CONCAT('0B0605', HEX('m0501'))));
