-- Step 4: assignment create/edit upgrade.
-- Safe for existing data: adds nullable fields and creates required-document rows table.

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='assignments'
      AND COLUMN_NAME='start_time'
  ),
    'ALTER TABLE assignments MODIFY COLUMN start_time TIME NULL DEFAULT NULL',
    'ALTER TABLE assignments ADD COLUMN start_time TIME NULL DEFAULT NULL AFTER start_date'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='assignments'
      AND COLUMN_NAME='deadline_time'
  ),
    'ALTER TABLE assignments MODIFY COLUMN deadline_time TIME NULL DEFAULT NULL',
    'ALTER TABLE assignments ADD COLUMN deadline_time TIME NULL DEFAULT NULL AFTER deadline_date'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='assignments'
      AND COLUMN_NAME='guideline_file_path'
  ),
    'SELECT 1',
    'ALTER TABLE assignments ADD COLUMN guideline_file_path VARCHAR(1000) NULL AFTER deadline_time'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='assignments'
      AND COLUMN_NAME='guideline_file_original_name'
  ),
    'SELECT 1',
    'ALTER TABLE assignments ADD COLUMN guideline_file_original_name VARCHAR(255) NULL AFTER guideline_file_path'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='assignments'
      AND COLUMN_NAME='guideline_file_mime'
  ),
    'SELECT 1',
    'ALTER TABLE assignments ADD COLUMN guideline_file_mime VARCHAR(255) NULL AFTER guideline_file_original_name'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='assignments'
      AND COLUMN_NAME='guideline_file_size'
  ),
    'ALTER TABLE assignments MODIFY COLUMN guideline_file_size BIGINT NULL',
    'ALTER TABLE assignments ADD COLUMN guideline_file_size BIGINT NULL AFTER guideline_file_mime'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS assignment_required_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assignment_id INT NOT NULL,
  document_name VARCHAR(255) NOT NULL,
  allowed_file_type VARCHAR(50) NOT NULL,
  is_mandatory TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_required_docs_assignment (assignment_id),
  CONSTRAINT fk_required_docs_assignment FOREIGN KEY (assignment_id) REFERENCES assignments(assignment_id) ON DELETE CASCADE
);
