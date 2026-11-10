-- Fixed requests_index rows for the stats panel check against a local logger.
-- Times are relative to the moment of seeding and sit at least 8 minutes from
-- the 1-hour and 24-hour windows, so the counts hold for the whole run.
-- Domain counts are distinct (alpha 5, beta 3, gamma 2, delta 1).
INSERT INTO requests_index (request_id, url, domain, created_at, updated_at, last_event_ts, terminal_state, stage) VALUES
  ('e2e-done-1', 'https://alpha.test/1', 'alpha.test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-19 minutes'), 1, 'done'),
  ('e2e-done-2', 'https://alpha.test/2', 'alpha.test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-29 minutes'), 1, 'done'),
  ('e2e-done-3', 'https://alpha.test/3', 'alpha.test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-39 minutes'), 1, 'done'),
  ('e2e-queued-1', 'https://alpha.test/4', 'alpha.test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 minutes'), NULL, 0, 'queued'),
  ('e2e-render-1', 'https://alpha.test/5', 'alpha.test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-180 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-180 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-179 minutes'), 0, 'rendering'),
  ('e2e-done-4', 'https://beta.test/1', 'beta.test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-180 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-180 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-179 minutes'), 1, 'done'),
  ('e2e-fail-1', 'https://beta.test/2', 'beta.test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-89 minutes'), 1, 'failed'),
  ('e2e-fail-2', 'https://beta.test/3', 'beta.test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 hours'), 1, 'failed'),
  ('e2e-done-5', 'https://gamma.test/1', 'gamma.test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-48 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-48 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-48 hours'), 1, 'done'),
  ('e2e-fail-3', 'https://gamma.test/2', 'gamma.test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'), 1, 'failed'),
  ('e2e-done-6', 'https://delta.test/1', 'delta.test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-15 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-15 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 minutes'), 1, 'done');
