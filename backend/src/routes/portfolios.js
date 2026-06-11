import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  uploadPortfolio,
  listPortfolios,
  getPortfolio,
  getPortfolioSubmissionPackage,
  deletePortfolio,
  getAdminSubmission,
  removeAdminSubmissionFile,
  viewSubmissionFileForStaff,
} from '../controllers/portfolioController.js';

dotenv.config();

const router = Router();

const uploadDir = path.join(process.cwd(), 'uploads', 'submissions');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}-${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext === '.doc') {
      return cb(new Error('DOC files are not supported. Please convert the document to DOCX or PDF and upload again.'));
    }

    const allowed = ['.pdf', '.docx', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.xlsx', '.xls', '.csv'];
    if (!allowed.includes(ext)) {
      return cb(new Error('Unsupported file type. Please upload PDF, DOCX, image, or Excel files according to the required document type.'));
    }
    cb(null, true);
  },
});

function handlePortfolioUpload(req, res, next) {
  upload.any()(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

router.get('/', requireAuth, requireRole('admin','teacher'), listPortfolios);
router.get('/submission', requireAuth, requireRole('admin'), getAdminSubmission);
router.get('/assignment/:assignmentId/student/:studentNo/submission', requireAuth, requireRole('admin'), getAdminSubmission);
router.get('/files/:fileId/view', requireAuth, requireRole('admin','teacher'), viewSubmissionFileForStaff);
router.get('/:id/submission', requireAuth, requireRole('admin','teacher'), getPortfolioSubmissionPackage);
router.get('/:id', requireAuth, requireRole('admin','teacher'), getPortfolio);
router.post('/upload', requireAuth, requireRole('admin'), handlePortfolioUpload, uploadPortfolio);
router.delete('/files/:fileId', requireAuth, requireRole('admin'), removeAdminSubmissionFile);
router.delete('/:id', requireAuth, requireRole('admin'), deletePortfolio);

export default router;
