import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

import { requireAuth, requireRole } from '../middleware/auth.js';
import { uploadPortfolio, listPortfolios, getPortfolio, deletePortfolio } from '../controllers/portfolioController.js';

dotenv.config();

const router = Router();

const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}-${safe}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

router.get('/', requireAuth, listPortfolios);
router.get('/:id', requireAuth, getPortfolio);
router.post('/upload', requireAuth, requireRole('admin','teacher','student'), upload.single('file'), uploadPortfolio);
router.delete('/:id', requireAuth, requireRole('admin','teacher'), deletePortfolio);

export default router;
