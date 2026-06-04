import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getRubricByAssignment, createRubric, uploadRubric, deleteRubric, getRubricFile } from '../controllers/rubricController.js';

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
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (ext === '.doc') {
            return cb(new Error('DOC files are not supported. Please convert the document to DOCX or PDF and upload again.'));
        }

        const ok = ['.xlsx', '.xls', '.csv', '.pdf', '.docx'].includes(ext);
        if (!ok) {
            return cb(new Error('Unsupported file type. Please upload rubric as Excel/PDF/DOCX and assignment submission as PDF or DOCX.'));
        }
        cb(null, true);
    },
});

function handleRubricUpload(req, res, next) {
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}

// ===== Existing =====
router.get('/assignment/:assignmentId', requireAuth, requireRole('admin', 'teacher'), getRubricByAssignment);
router.get('/:rubricId/file', requireAuth, requireRole('admin', 'teacher'), getRubricFile);
router.post('/', requireAuth, requireRole('admin', 'teacher'), createRubric);

// ✅ New upload endpoint
router.post(
    '/upload',
    requireAuth,
    requireRole('admin', 'teacher'),
    handleRubricUpload,
    uploadRubric
);

router.delete(
    '/:rubricId',
    requireAuth,
    requireRole('admin', 'teacher'),
    deleteRubric
);

export default router;
