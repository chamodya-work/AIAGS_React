import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getRubricByAssignment, createRubric, uploadRubric } from '../controllers/rubricController.js';

const router = Router();

// ===== Multer config =====
const uploadDir = path.join(process.cwd(), 'uploads', 'rubrics');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
        const unique = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
        cb(null, `${unique}_${safe}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const ok = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
        ].includes(file.mimetype);
        if (!ok) return cb(new Error('Only PDF/DOC/DOCX/TXT allowed'));
        cb(null, true);
    },
});

// ===== Existing =====
router.get('/assignment/:assignmentId', requireAuth, getRubricByAssignment);
router.post('/', requireAuth, requireRole('admin', 'teacher'), createRubric);

// ✅ New upload endpoint
router.post(
    '/upload',
    requireAuth,
    requireRole('admin', 'teacher'),
    upload.single('file'),
    uploadRubric
);

export default router;
