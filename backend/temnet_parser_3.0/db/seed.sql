-- Test fixtures exercising every branch of the reporting queries.
--
-- Two data shapes, matching the two query models:
--   1) Group members (sr_user = operators) send request-status phrases to
--      clients  -> drives /companies and /users aggregations.
--   2) A group client <-> "help" conversation -> drives /chat history and the
--      metric queries (SLA, categories, operators).

USE ejabberd;

-- Groups: two real companies, plus a help-desk group and "all" that the
-- queries must exclude (name LIKE 'help%' / name = 'all').
INSERT INTO sr_group (name) VALUES
    ('CompanyA'),
    ('CompanyB'),
    ('help-desk'),
    ('all');

-- Operators that belong to the companies, plus a client (petrov) whose
-- help conversation below must show up under CompanyA in /chat.
INSERT INTO sr_user (jid, grp) VALUES
    ('alice@xmpp',  'CompanyA'),
    ('bob@xmpp',    'CompanyA'),
    ('carol@xmpp',  'CompanyB'),
    ('petrov@xmpp', 'CompanyA');

-- (1) Operator -> client messages with the status phrases the reports count.
INSERT INTO archive (username, peer, bare_peer, txt, created_at) VALUES
    -- alice (CompanyA): 4 messages in 2025
    ('alice', 'client1@xmpp', 'client1@xmpp', 'Здравствуйте, чем помочь', '2025-03-01 10:00:00'),
    ('alice', 'client1@xmpp', 'client1@xmpp', 'закрыта заявка №1',        '2025-03-01 10:05:00'),
    ('alice', 'client2@xmpp', 'client2@xmpp', 'заявка в работе',          '2025-03-02 09:00:00'),
    ('alice', 'client3@xmpp', 'client3@xmpp', 'отклонена заявка №2',      '2025-03-03 12:00:00'),
    -- bob (CompanyA): 2 messages
    ('bob',   'client4@xmpp', 'client4@xmpp', 'добрый день',              '2025-04-01 08:00:00'),
    ('bob',   'client4@xmpp', 'client4@xmpp', 'заявка закрыта успешно',   '2025-04-01 08:10:00'),
    -- carol (CompanyB): 2 messages
    ('carol', 'client5@xmpp', 'client5@xmpp', 'слушаю вас',               '2025-05-01 11:00:00'),
    ('carol', 'client5@xmpp', 'client5@xmpp', 'заявка закрыта',           '2025-05-01 11:05:00'),
    -- out of the 2025 range -> must be ignored by date filter
    ('alice', 'client1@xmpp', 'client1@xmpp', 'старое сообщение',         '2024-01-15 09:00:00');

-- (2) A client <-> help conversation for /chat and the metric queries.
-- Stored MAM-style, twice per message: the sender's copy has a bare `peer`,
-- the recipient's copy carries the sender's full jid with a /resource. The
-- dedup logic must collapse each pair into one message.
INSERT INTO archive (username, peer, bare_peer, txt, created_at) VALUES
    ('petrov', 'help@xmpp',          'help@xmpp',   'Здравствуйте, не работает интернет', '2025-06-01 10:00:00'),
    ('help',   'petrov@xmpp/mobile', 'petrov@xmpp', 'Здравствуйте, не работает интернет', '2025-06-01 10:00:00'),
    ('help',   'petrov@xmpp',        'petrov@xmpp', 'Принято, проверяем',                 '2025-06-01 10:01:00'),
    ('petrov', 'help@xmpp/desk',     'help@xmpp',   'Принято, проверяем',                 '2025-06-01 10:01:00'),
    ('petrov', 'help@xmpp',          'help@xmpp',   'Спасибо',                            '2025-06-01 10:05:00'),
    ('help',   'petrov@xmpp/mobile', 'petrov@xmpp', 'Спасибо',                            '2025-06-01 10:05:00');
