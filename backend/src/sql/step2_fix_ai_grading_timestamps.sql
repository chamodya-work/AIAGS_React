-- Step 2 fix: ai_grading timestamp columns must allow NULL.
-- This is safe for existing data and fixes MySQL installs where TIMESTAMP
-- columns were created as NOT NULL DEFAULT CURRENT_TIMESTAMP.

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='ai_grading'
      AND COLUMN_NAME='grading_started_at'
  ),
    'ALTER TABLE ai_grading MODIFY COLUMN grading_started_at TIMESTAMP NULL DEFAULT NULL',
    'ALTER TABLE ai_grading ADD COLUMN grading_started_at TIMESTAMP NULL DEFAULT NULL AFTER ai_model'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='ai_grading'
      AND COLUMN_NAME='graded_at'
  ),
    'ALTER TABLE ai_grading MODIFY COLUMN graded_at TIMESTAMP NULL DEFAULT NULL',
    'ALTER TABLE ai_grading ADD COLUMN graded_at TIMESTAMP NULL DEFAULT NULL AFTER grading_started_at'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE ai_grading
SET graded_at = NULL
WHERE ai_status IN ('pending', 'processing', 'failed');
