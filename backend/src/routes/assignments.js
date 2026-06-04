import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  listAssignments,
  getAssignment,
  getAssignmentGuideline,
  createAssignment,
  updateAssignment,
  deleteAssignment,
} from '../controllers/assignmentController.js';

const router = Router();

const guidelineDir = path.join(process.cwd(), 'uploads', 'guidelines');
const rubricDir = path.join(process.cwd(), 'uploads', 'rubrics');
fs.mkdirSync(guidelineDir, { recursive: true });
fs.mkdirSync(rubricDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, file.fieldname === 'rubric_file' ? rubricDir : guidelineDir);
    },
    filename: (req, file, cb) => {
      const safe = path.basename(file.originalname || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_');
      const unique = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}_${safe}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext === '.doc') {
      return cb(new Error('DOC files are not supported. Please convert the document to DOCX or PDF and upload again.'));
    }

    const allowedByField = {
      guideline_file: ['.pdf', '.docx', '.txt'],
      rubric_file: ['.xlsx', '.xls', '.csv', '.pdf', '.docx'],
    };
    const allowed = allowedByField[file.fieldname] || [];

    if (!allowed.includes(ext)) {
      const message = file.fieldname === 'guideline_file'
        ? 'Unsupported guideline file type. Please upload the guideline as PDF, DOCX, or TXT.'
        : 'Unsupported file type. Please upload rubric as Excel/PDF/DOCX and assignment submission as PDF or DOCX.';
      return cb(new Error(message));
    }

    cb(null, true);
  },
});

function handleAssignmentUpload(req, res, next) {
  upload.fields([
    { name: 'guideline_file', maxCount: 1 },
    { name: 'rubric_file', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

router.get('/', requireAuth, listAssignments);
router.get('/:id/guideline', requireAuth, getAssignmentGuideline);
router.get('/:id', requireAuth, getAssignment);
router.post('/', requireAuth, requireRole('admin', 'teacher'), handleAssignmentUpload, createAssignment);
router.put('/:id', requireAuth, requireRole('admin', 'teacher'), updateAssignment);
router.delete('/:id', requireAuth, requireRole('admin'), deleteAssignment);

export default router;
