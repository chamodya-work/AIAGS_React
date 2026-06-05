-- Step 7: manual grading and publish workflow.
-- Safe for existing data: extends final_grading without dropping old status/final_grade values.

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='final_grading'
      AND COLUMN_NAME='manual_score'
  ),
    'SELECT 1',
    'ALTER TABLE final_grading ADD COLUMN manual_score DECIMAL(5,2) NULL AFTER final_grade'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='final_grading'
      AND COLUMN_NAME='manual_remark'
  ),
    'SELECT 1',
    'ALTER TABLE final_grading ADD COLUMN manual_remark TEXT NULL AFTER manual_score'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='final_grading'
      AND COLUMN_NAME='saved_by'
  ),
    'SELECT 1',
    'ALTER TABLE final_grading ADD COLUMN saved_by INT NULL AFTER manual_remark'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='final_grading'
      AND COLUMN_NAME='saved_by_role'
  ),
    'SELECT 1',
    'ALTER TABLE final_grading ADD COLUMN saved_by_role VARCHAR(50) NULL AFTER saved_by'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='final_grading'
      AND COLUMN_NAME='saved_at'
  ),
    'ALTER TABLE final_grading MODIFY COLUMN saved_at TIMESTAMP NULL DEFAULT NULL',
    'ALTER TABLE final_grading ADD COLUMN saved_at TIMESTAMP NULL DEFAULT NULL AFTER saved_by_role'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='final_grading'
      AND COLUMN_NAME='publish_status'
  ),
    'ALTER TABLE final_grading MODIFY COLUMN publish_status ENUM(''draft'',''submitted_to_head'',''published_to_student'') NOT NULL DEFAULT ''draft''',
    'ALTER TABLE final_grading ADD COLUMN publish_status ENUM(''draft'',''submitted_to_head'',''published_to_student'') NOT NULL DEFAULT ''draft'' AFTER saved_at'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='final_grading'
      AND COLUMN_NAME='submitted_to_head_at'
  ),
    'ALTER TABLE final_grading MODIFY COLUMN submitted_to_head_at TIMESTAMP NULL DEFAULT NULL',
    'ALTER TABLE final_grading ADD COLUMN submitted_to_head_at TIMESTAMP NULL DEFAULT NULL AFTER publish_status'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='final_grading'
      AND COLUMN_NAME='published_by'
  ),
    'SELECT 1',
    'ALTER TABLE final_grading ADD COLUMN published_by INT NULL AFTER submitted_to_head_at'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='final_grading'
      AND COLUMN_NAME='published_at'
  ),
    'ALTER TABLE final_grading MODIFY COLUMN published_at TIMESTAMP NULL DEFAULT NULL',
    'ALTER TABLE final_grading ADD COLUMN published_at TIMESTAMP NULL DEFAULT NULL AFTER published_by'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='final_grading'
      AND COLUMN_NAME='ai_score_at_save'
  ),
    'SELECT 1',
    'ALTER TABLE final_grading ADD COLUMN ai_score_at_save DECIMAL(5,2) NULL AFTER published_at'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='final_grading'
      AND COLUMN_NAME='score_difference'
  ),
    'SELECT 1',
    'ALTER TABLE final_grading ADD COLUMN score_difference DECIMAL(5,2) NULL AFTER ai_score_at_save'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='final_grading'
      AND COLUMN_NAME='score_difference_warning'
  ),
    'ALTER TABLE final_grading MODIFY COLUMN score_difference_warning TINYINT(1) NOT NULL DEFAULT 0',
    'ALTER TABLE final_grading ADD COLUMN score_difference_warning TINYINT(1) NOT NULL DEFAULT 0 AFTER score_difference'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE final_grading
SET manual_score = final_grade
WHERE manual_score IS NULL
  AND final_grade IS NOT NULL;

UPDATE final_grading
SET publish_status = CASE
    WHEN status = 'PUBLISHED' THEN 'published_to_student'
    ELSE publish_status
  END
WHERE status = 'PUBLISHED';
