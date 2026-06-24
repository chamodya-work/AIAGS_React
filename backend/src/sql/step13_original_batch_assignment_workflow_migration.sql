-- Step 13: use university original batch as the system batch and make assignment department optional.
-- Safe for existing data: no columns are dropped and old department values are preserved.

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='students'
      AND COLUMN_NAME='original_batch'
  ),
    'ALTER TABLE students MODIFY COLUMN original_batch VARCHAR(50) NULL',
    'ALTER TABLE students ADD COLUMN original_batch VARCHAR(50) NULL'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='assignments'
      AND COLUMN_NAME='department'
      AND IS_NULLABLE='YES'
  ),
    'SELECT 1',
    'ALTER TABLE assignments MODIFY COLUMN department VARCHAR(100) NULL'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE students
SET batch = original_batch
WHERE original_batch IS NOT NULL
  AND original_batch <> ''
  AND (
    batch IS NULL
    OR batch = ''
    OR batch REGEXP '^[12][0-9]{3}$'
  );
