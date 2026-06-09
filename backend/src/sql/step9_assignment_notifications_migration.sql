USE aigs;

CREATE TABLE IF NOT EXISTS assignment_notifications (
  notification_id INT AUTO_INCREMENT PRIMARY KEY,
  assignment_id INT NOT NULL,
  student_no VARCHAR(50) NULL,
  email VARCHAR(255) NOT NULL,
  notification_type ENUM('created','deadline_reminder') NOT NULL,
  status ENUM('pending','sent','failed','skipped') DEFAULT 'pending',
  error TEXT NULL,
  sent_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assignment_student_notification (assignment_id, student_no, notification_type),
  INDEX idx_assignment_notifications_assignment (assignment_id),
  INDEX idx_assignment_notifications_type_status (notification_type, status),
  CONSTRAINT fk_assignment_notifications_assignment
    FOREIGN KEY (assignment_id) REFERENCES assignments(assignment_id) ON DELETE CASCADE,
  CONSTRAINT fk_assignment_notifications_student
    FOREIGN KEY (student_no) REFERENCES students(student_no) ON DELETE SET NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
