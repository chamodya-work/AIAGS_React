import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaPath = path.join(__dirname, 'schema.sql');
const migrationPaths = [
  path.join(__dirname, 'step2_dynamic_ai_grading_migration.sql'),
  path.join(__dirname, 'step2_fix_ai_grading_timestamps.sql'),
  path.join(__dirname, 'step3_student_feedback_migration.sql'),
  path.join(__dirname, 'step4_assignment_upgrade_migration.sql'),
  path.join(__dirname, 'step5_student_submission_files_migration.sql'),
  path.join(__dirname, 'step6_lecturer_assignments_migration.sql'),
];

const schemaSql = await fs.readFile(schemaPath, 'utf8');
const migrationSql = [];

for (const migrationPath of migrationPaths) {
  try {
    migrationSql.push(await fs.readFile(migrationPath, 'utf8'));
  } catch {
    // Older checkouts may not have every migration file.
  }
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  multipleStatements: true
});

await conn.query(schemaSql);
for (const sql of migrationSql) {
  if (sql.trim()) {
    await conn.query(sql);
  }
}
await conn.end();

console.log('Database schema applied');
