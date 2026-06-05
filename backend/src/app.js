import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import assignmentRoutes from './routes/assignments.js';
import rubricRoutes from './routes/rubrics.js';
import portfolioRoutes from './routes/portfolios.js';
import gradingRoutes from './routes/grading.js';
import lecturerAssignmentRoutes from './routes/lecturerAssignments.js';
import manualGradingRoutes from './routes/manualGrading.js';
import metaRoutes from "./routes/metaRoutes.js";
import studentRoutes from "./routes/students.js";

dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CORS — allow React dev server (port 3000) in development
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',')
  : ['http://localhost:3000', 'http://localhost:4000'];

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rubric files must not be publicly downloadable; use protected rubric API routes.
app.use('/uploads/rubrics', (req, res) => {
  res.status(403).json({ error: 'Access denied' });
});

// AI report PDFs must stay behind protected grading API routes.
app.use('/uploads/reports', (req, res) => {
  res.status(403).json({ error: 'Access denied' });
});

// Assignment guideline files must stay behind protected assignment API routes.
app.use('/uploads/guidelines', (req, res) => {
  res.status(403).json({ error: 'Access denied' });
});

// Student required-document submission files must stay behind protected API routes.
app.use('/uploads/submissions', (req, res) => {
  res.status(403).json({ error: 'Access denied' });
});

// Uploaded files
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// API routes
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use("/api", metaRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/rubrics', rubricRoutes);
app.use('/api/portfolios', portfolioRoutes);
app.use('/api/grading', gradingRoutes);
app.use('/api/lecturer-assignments', lecturerAssignmentRoutes);
app.use('/api/manual-grading', manualGradingRoutes);
app.use('/api/student', studentRoutes);

// Serve React frontend (production build)
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
app.use('/', express.static(frontendDist));

// SPA fallback — send index.html for all non-API routes
app.get('*', (req, res) => {
  const indexPath = path.join(frontendDist, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      // In development the dist folder won't exist — just send a hint
      res.status(404).json({ error: 'Frontend not built. Run: cd frontend && npm run build' });
    }
  });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`AIGS backend running on http://localhost:${port}`);
});
