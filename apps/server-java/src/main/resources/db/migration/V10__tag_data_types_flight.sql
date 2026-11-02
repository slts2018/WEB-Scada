-- Flight 对齐：扩展变量类型（原 ENUM 仅 bool/int/float/string，写入 short/word 等会 500）
ALTER TABLE tags
  MODIFY COLUMN data_type VARCHAR(16) NOT NULL DEFAULT 'float';
