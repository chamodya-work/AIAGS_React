-- Step 3: student AI feedback history and attempt tracking.
-- Safe for existing data: creates the table only when it is missing.

CREATE TABLE IF NOT EXISTS student_feedback (
  feedback_id INT AUTO_INCREMENT PRIMARY KEY,
  student_no VARCHAR(50) NOT NULL,
  assignment_id INT NOT NULL,
  portfolio_id INT NULL,
  attempt_no INT NOT NULL,
  feedback_text LONGTEXT NULL,
  feedback_status ENUM('processing','completed','failed') DEFAULT 'processing',
  feedback_error TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_feedback_attempt (student_no, assignment_id, attempt_no),
  INDEX idx_feedback_student_assignment (student_no, assignment_id),
  CONSTRAINT fk_feedback_student FOREIGN KEY (student_no) REFERENCES students(student_no) ON DELETE CASCADE,
  CONSTRAINT fk_feedback_assignment FOREIGN KEY (assignment_id) REFERENCES assignments(assignment_id) ON DELETE CASCADE,
  CONSTRAINT fk_feedback_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id) ON DELETE SET NULL
);
