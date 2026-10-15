-- DDL aligned with docs/spring-boot-migration-design.md §3.4 (tables only; database created at bootstrap)

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  version VARCHAR(64) NOT NULL DEFAULT '0.1.0',
  updated_at BIGINT NOT NULL,
  document_json LONGTEXT NOT NULL,
  created_at BIGINT NOT NULL,
  INDEX idx_projects_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS publishes (
  project_id VARCHAR(64) PRIMARY KEY,
  project_name VARCHAR(255) NOT NULL,
  publish_version VARCHAR(64) NOT NULL,
  published_at BIGINT NOT NULL,
  package_json LONGTEXT NOT NULL,
  INDEX idx_publishes_published (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_meta (
  meta_key VARCHAR(64) PRIMARY KEY,
  meta_value VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tags (
  tag_id VARCHAR(128) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  tag_group VARCHAR(128) NULL,
  device_id VARCHAR(128) NULL,
  address VARCHAR(255) NULL,
  data_type ENUM('bool','int','float','string') NOT NULL DEFAULT 'float',
  unit VARCHAR(64) NULL,
  writable TINYINT(1) NOT NULL DEFAULT 0,
  description VARCHAR(512) NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_tags_name (name),
  INDEX idx_tags_group (tag_group)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS devices (
  device_id VARCHAR(128) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  protocol VARCHAR(32) NOT NULL DEFAULT 'mock',
  channel VARCHAR(512) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  description VARCHAR(512) NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_devices_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
