-- AIGS database schema (MySQL 8+)
-- Based on the provided structure document.

CREATE DATABASE IF NOT EXISTS aigs CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE aigs;

-- Unified auth table (not listed in the structure doc, but needed for login)
CREATE TABLE IF NOT EXISTS users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  role ENUM('admin','teacher','student') NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Student – AD
CREATE TABLE IF NOT EXISTS students (
  student_no VARCHAR(50) PRIMARY KEY,
  user_id INT NULL,
  full_name VARCHAR(255) NULL,
  batch VARCHAR(50) NULL,
  course_name VARCHAR(100) NULL,
  department VARCHAR(100) NULL,
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Teachers – AD
CREATE TABLE IF NOT EXISTS teachers (
  teacher_id VARCHAR(50) PRIMARY KEY,
  user_id INT NULL,
  teacher_mail VARCHAR(255) NULL,
  full_name VARCHAR(255) NULL,
  department VARCHAR(100) NULL,
  CONSTRAINT fk_teachers_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Administrator
CREATE TABLE IF NOT EXISTS administrators (
  admin_id VARCHAR(50) PRIMARY KEY,
  user_id INT NULL,
  admin_name VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  department VARCHAR(100) NULL,
  CONSTRAINT fk_admin_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Assignment
CREATE TABLE IF NOT EXISTS assignments (
  assignment_id INT AUTO_INCREMENT PRIMARY KEY,
  assignment_name VARCHAR(255) NOT NULL,
  batch VARCHAR(50) NOT NULL,
  course_name VARCHAR(100) NOT NULL,
  department VARCHAR(100) NULL,
  start_date DATE NULL,
  deadline_date DATE NULL,
  remark TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rubric
CREATE TABLE IF NOT EXISTS rubrics (
  rubric_id INT AUTO_INCREMENT PRIMARY KEY,
  rubric_name VARCHAR(255) NOT NULL,
  assignment_id INT NOT NULL,
  rubric_text LONGTEXT NULL,
  create_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT NULL,
  CONSTRAINT fk_rubric_assignment FOREIGN KEY (assignment_id) REFERENCES assignments(assignment_id) ON DELETE CASCADE,
  CONSTRAINT fk_rubric_created_by FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Portfolio
CREATE TABLE IF NOT EXISTS portfolios (
  portfolio_id INT AUTO_INCREMENT PRIMARY KEY,
  student_no VARCHAR(50) NOT NULL,
  assignment_id INT NOT NULL,
  portfolio_link VARCHAR(1000) NOT NULL,
  upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_portfolio_student FOREIGN KEY (student_no) REFERENCES students(student_no) ON DELETE CASCADE,
  CONSTRAINT fk_portfolio_assignment FOREIGN KEY (assignment_id) REFERENCES assignments(assignment_id) ON DELETE CASCADE
);

-- AI_Grading
CREATE TABLE IF NOT EXISTS ai_grading (
  portfolio_id INT PRIMARY KEY,
  ai_grade DECIMAL(5,2) NULL,
  ai_review_report LONGTEXT NULL,
  graded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id) ON DELETE CASCADE
);

-- Final_Grading
CREATE TABLE IF NOT EXISTS final_grading (
  student_no VARCHAR(50) NOT NULL,
  portfolio_id INT NOT NULL,
  status ENUM('DRAFT','PUBLISHED') DEFAULT 'DRAFT',
  final_grade DECIMAL(5,2) NULL,
  review_report_id INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (student_no, portfolio_id),
  CONSTRAINT fk_final_student FOREIGN KEY (student_no) REFERENCES students(student_no) ON DELETE CASCADE,
  CONSTRAINT fk_final_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id) ON DELETE CASCADE
);

-- Assign_Teachers
CREATE TABLE IF NOT EXISTS assign_teachers (
  teacher_id VARCHAR(50) NOT NULL,
  assignment_id INT NOT NULL,
  PRIMARY KEY (teacher_id, assignment_id),
  CONSTRAINT fk_assign_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(teacher_id) ON DELETE CASCADE,
  CONSTRAINT fk_assign_assignment FOREIGN KEY (assignment_id) REFERENCES assignments(assignment_id) ON DELETE CASCADE
);

-- Assigned_portfolios (a simple mapping, instead of a "list" column)
CREATE TABLE IF NOT EXISTS assigned_portfolios (
  teacher_id VARCHAR(50) NOT NULL,
  portfolio_id INT NOT NULL,
  PRIMARY KEY (teacher_id, portfolio_id),
  CONSTRAINT fk_assignedp_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(teacher_id) ON DELETE CASCADE,
  CONSTRAINT fk_assignedp_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id) ON DELETE CASCADE
);

-- Seed: a default admin user (email: admin@aigs.local, password: admin123)
-- Change this in production.
INSERT INTO users (role, email, password_hash, display_name)
SELECT 'admin', 'admin@aigs.local', '$2b$12$HOcpGpAOCv3PRC2HjorA5efQHlWxC60/XqgIc/CE4lkVxFGunt4Ri', 'Default Admin'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email='admin@aigs.local');
