CREATE TABLE IF NOT EXISTS alarm_events (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  alarm_id VARCHAR(64) NOT NULL,
  tag_id VARCHAR(128) NOT NULL,
  name VARCHAR(255) NULL,
  level VARCHAR(16) NOT NULL,
  kind VARCHAR(32) NULL,
  event_kind VARCHAR(16) NOT NULL,
  message VARCHAR(512) NULL,
  value_text VARCHAR(255) NULL,
  quality VARCHAR(32) NULL,
  event_at BIGINT NOT NULL,
  INDEX idx_alarm_events_at (event_at),
  INDEX idx_alarm_events_tag (tag_id, event_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
