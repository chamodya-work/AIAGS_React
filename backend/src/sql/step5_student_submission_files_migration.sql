-- Step 5: student required-document submission files.
-- Safe for existing data: creates portfolio_files and backfills current single-file portfolios.

CREATE TABLE IF NOT EXISTS portfolio_files (
  file_id INT AUTO_INCREMENT PRIMARY KEY,
  portfolio_id INT NULL,
  assignment_id INT NOT NULL,
  student_no VARCHAR(50) NOT NULL,
  required_document_id INT NULL,
  file_path VARCHAR(1000) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(255) NULL,
  file_size BIGINT NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  removed_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_portfolio_files_portfolio (portfolio_id),
  INDEX idx_portfolio_files_assignment_student (assignment_id, student_no),
  INDEX idx_portfolio_files_required_document (required_document_id),
  CONSTRAINT fk_portfolio_files_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id) ON DELETE SET NULL,
  CONSTRAINT fk_portfolio_files_assignment FOREIGN KEY (assignment_id) REFERENCES assignments(assignment_id) ON DELETE CASCADE,
  CONSTRAINT fk_portfolio_files_student FOREIGN KEY (student_no) REFERENCES students(student_no) ON DELETE CASCADE,
  CONSTRAINT fk_portfolio_files_required_document FOREIGN KEY (required_document_id) REFERENCES assignment_required_documents(id) ON DELETE SET NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

ALTER TABLE portfolio_files
  MODIFY COLUMN file_path VARCHAR(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  MODIFY COLUMN original_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  MODIFY COLUMN mime_type VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL;

INSERT INTO portfolio_files
  (portfolio_id, assignment_id, student_no, required_document_id, file_path, original_name, mime_type, file_size, uploaded_at)
SELECT
  p.portfolio_id,
  p.assignment_id,
  p.student_no,
  NULL,
  p.portfolio_link,
  SUBSTRING_INDEX(p.portfolio_link, '/', -1),
  NULL,
  NULL,
  p.upload_date
FROM portfolios p
WHERE p.portfolio_link IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM portfolio_files pf
    WHERE pf.portfolio_id = p.portfolio_id
      AND pf.file_path = p.portfolio_link
  );
