import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaPath = path.join(__dirname, 'schema.sql');
const step2MigrationPath = path.join(__dirname, 'step2_dynamic_ai_grading_migration.sql');

const schemaSql = await fs.readFile(schemaPath, 'utf8');
let step2Sql = '';

try {
  step2Sql = await fs.readFile(step2MigrationPath, 'utf8');
} catch {
  step2Sql = '';
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  multipleStatements: true
});

await conn.query(schemaSql);
if (step2Sql.trim()) {
  await conn.query(step2Sql);
}
await conn.end();

console.log('Database schema applied');
