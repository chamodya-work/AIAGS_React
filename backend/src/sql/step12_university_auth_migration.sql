-- Step 12: real University/Faculty authentication metadata.
-- Safe for existing data: adds nullable identity/profile fields and keeps local login users intact.

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='users'
      AND COLUMN_NAME='university_user_id'
  ),
    'SELECT 1',
    'ALTER TABLE users ADD COLUMN university_user_id VARCHAR(255) NULL AFTER user_id'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='users'
      AND COLUMN_NAME='auth_provider'
  ),
    'ALTER TABLE users MODIFY COLUMN auth_provider VARCHAR(50) NOT NULL DEFAULT ''local''',
    'ALTER TABLE users ADD COLUMN auth_provider VARCHAR(50) NOT NULL DEFAULT ''local'' AFTER university_user_id'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='users'
      AND COLUMN_NAME='email_verified'
  ),
    'ALTER TABLE users MODIFY COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER display_name'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='users'
      AND COLUMN_NAME='user_type'
  ),
    'ALTER TABLE users MODIFY COLUMN user_type VARCHAR(50) NULL',
    'ALTER TABLE users ADD COLUMN user_type VARCHAR(50) NULL AFTER email_verified'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='users'
      AND COLUMN_NAME='is_active'
  ),
    'ALTER TABLE users MODIFY COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1',
    'ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER user_type'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='users'
      AND COLUMN_NAME='last_login_at'
  ),
    'ALTER TABLE users MODIFY COLUMN last_login_at TIMESTAMP NULL DEFAULT NULL',
    'ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP NULL DEFAULT NULL AFTER is_active'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='users'
      AND COLUMN_NAME='last_synced_at'
  ),
    'ALTER TABLE users MODIFY COLUMN last_synced_at TIMESTAMP NULL DEFAULT NULL',
    'ALTER TABLE users ADD COLUMN last_synced_at TIMESTAMP NULL DEFAULT NULL AFTER last_login_at'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='users'
      AND COLUMN_NAME='local_role_override'
  ),
    'ALTER TABLE users MODIFY COLUMN local_role_override TINYINT(1) NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN local_role_override TINYINT(1) NOT NULL DEFAULT 0 AFTER last_synced_at'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='users'
      AND COLUMN_NAME='raw_university_profile'
  ),
    'ALTER TABLE users MODIFY COLUMN raw_university_profile LONGTEXT NULL',
    'ALTER TABLE users ADD COLUMN raw_university_profile LONGTEXT NULL AFTER local_role_override'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='users'
      AND COLUMN_NAME='updated_at'
  ),
    'ALTER TABLE users MODIFY COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    'ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='users'
      AND INDEX_NAME='idx_users_university_user_id'
  ),
    'SELECT 1',
    'CREATE INDEX idx_users_university_user_id ON users (university_user_id)'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='students'
      AND COLUMN_NAME='faculty'
  ),
    'SELECT 1',
    'ALTER TABLE students ADD COLUMN faculty VARCHAR(255) NULL AFTER department'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='students'
      AND COLUMN_NAME='university_email'
  ),
    'SELECT 1',
    'ALTER TABLE students ADD COLUMN university_email VARCHAR(255) NULL AFTER faculty'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='students'
      AND COLUMN_NAME='intake_academic_year'
  ),
    'SELECT 1',
    'ALTER TABLE students ADD COLUMN intake_academic_year VARCHAR(50) NULL AFTER university_email'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='students'
      AND COLUMN_NAME='original_batch'
  ),
    'SELECT 1',
    'ALTER TABLE students ADD COLUMN original_batch VARCHAR(50) NULL AFTER intake_academic_year'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='students'
      AND COLUMN_NAME='contact_mobile'
  ),
    'SELECT 1',
    'ALTER TABLE students ADD COLUMN contact_mobile VARCHAR(50) NULL AFTER original_batch'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='teachers'
      AND COLUMN_NAME='staff_id'
  ),
    'SELECT 1',
    'ALTER TABLE teachers ADD COLUMN staff_id VARCHAR(100) NULL AFTER teacher_id'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='teachers'
      AND COLUMN_NAME='designation'
  ),
    'SELECT 1',
    'ALTER TABLE teachers ADD COLUMN designation VARCHAR(255) NULL AFTER department'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='teachers'
      AND COLUMN_NAME='faculty'
  ),
    'SELECT 1',
    'ALTER TABLE teachers ADD COLUMN faculty VARCHAR(255) NULL AFTER designation'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='teachers'
      AND COLUMN_NAME='profile_image'
  ),
    'SELECT 1',
    'ALTER TABLE teachers ADD COLUMN profile_image VARCHAR(1000) NULL AFTER faculty'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='administrators'
      AND COLUMN_NAME='staff_id'
  ),
    'SELECT 1',
    'ALTER TABLE administrators ADD COLUMN staff_id VARCHAR(100) NULL AFTER admin_id'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='administrators'
      AND COLUMN_NAME='designation'
  ),
    'SELECT 1',
    'ALTER TABLE administrators ADD COLUMN designation VARCHAR(255) NULL AFTER department'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
