ALTER TABLE tag_alarms
  ADD COLUMN target_value DOUBLE NULL,
  ADD COLUMN window_sec DOUBLE NULL,
  ADD COLUMN expect_text VARCHAR(255) NULL;
