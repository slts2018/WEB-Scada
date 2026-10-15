CREATE TABLE IF NOT EXISTS tag_alarms (
  alarm_id VARCHAR(64) PRIMARY KEY,
  tag_id VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  level VARCHAR(16) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  limit_code VARCHAR(8) NULL,
  threshold DOUBLE NULL,
  deadband DOUBLE NULL,
  bool_value TINYINT(1) NULL,
  quality_code VARCHAR(16) NULL,
  delay_sec DOUBLE NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_tag_alarms_tag (tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
