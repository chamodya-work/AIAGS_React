-- Step 6: assign submitted portfolios to lecturers by logged-in lecturer user id.
-- Safe for existing data: creates a new ownership table and preserves old assigned_portfolios.

CREATE TABLE IF NOT EXISTS lecturer_portfolio_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assignment_id INT NOT NULL,
  portfolio_id INT NOT NULL,
  lecturer_user_id INT NOT NULL,
  assigned_by INT NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lpa_portfolio (portfolio_id),
  INDEX idx_lpa_assignment (assignment_id),
  INDEX idx_lpa_lecturer (lecturer_user_id),
  CONSTRAINT fk_lpa_assignment FOREIGN KEY (assignment_id) REFERENCES assignments(assignment_id) ON DELETE CASCADE,
  CONSTRAINT fk_lpa_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id) ON DELETE CASCADE,
  CONSTRAINT fk_lpa_lecturer_user FOREIGN KEY (lecturer_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_lpa_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(user_id) ON DELETE SET NULL
);

INSERT INTO lecturer_portfolio_assignments
  (assignment_id, portfolio_id, lecturer_user_id, assigned_by, assigned_at)
SELECT
  p.assignment_id,
  ap.portfolio_id,
  t.user_id,
  NULL,
  CURRENT_TIMESTAMP
FROM assigned_portfolios ap
JOIN teachers t ON t.teacher_id = ap.teacher_id
JOIN portfolios p ON p.portfolio_id = ap.portfolio_id
WHERE t.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM lecturer_portfolio_assignments lpa
    WHERE lpa.portfolio_id = ap.portfolio_id
  );
