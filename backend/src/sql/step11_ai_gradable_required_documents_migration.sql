-- Step 11: mark the required-document category used as the main AI grading submission.
-- Safe for existing data: adds a default-false flag and preserves old assignments for fallback grading.

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='assignment_required_documents'
      AND COLUMN_NAME='is_ai_gradable'
  ),
    'ALTER TABLE assignment_required_documents MODIFY COLUMN is_ai_gradable TINYINT(1) NOT NULL DEFAULT 0',
    'ALTER TABLE assignment_required_documents ADD COLUMN is_ai_gradable TINYINT(1) NOT NULL DEFAULT 0 AFTER is_mandatory'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Keep only one Main Answer flag per assignment if old/manual data has duplicates.
UPDATE assignment_required_documents ard
JOIN (
  SELECT assignment_id, MIN(id) AS keep_id
  FROM assignment_required_documents
  WHERE is_ai_gradable = 1
  GROUP BY assignment_id
  HAVING COUNT(*) > 1
) keepers ON keepers.assignment_id = ard.assignment_id
SET ard.is_ai_gradable = 0
WHERE ard.is_ai_gradable = 1
  AND ard.id <> keepers.keep_id;
