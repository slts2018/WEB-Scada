ALTER TABLE tags
  ADD COLUMN on_text VARCHAR(64) NULL,
  ADD COLUMN off_text VARCHAR(64) NULL,
  ADD COLUMN scan_period_ms INT NULL,
  ADD COLUMN push_enabled TINYINT(1) NULL,
  ADD COLUMN push_period_ms INT NULL,
  ADD COLUMN history_json TEXT NULL;
