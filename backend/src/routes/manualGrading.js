import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  exportManualGradingExcel,
  listManualResultsByAssignment,
  publishAssignmentToStudents,
  saveManualGrade,
  submitAssignmentToHead,
} from '../controllers/manualGradingController.js';

const router = Router();

router.get('/assignment/:assignmentId/results', requireAuth, requireRole('admin', 'teacher'), listManualResultsByAssignment);
router.get('/assignment/:assignmentId/export/excel', requireAuth, requireRole('admin', 'teacher'), exportManualGradingExcel);
router.post('/portfolio/:portfolioId/save', requireAuth, requireRole('admin', 'teacher'), saveManualGrade);
router.post('/assignment/:assignmentId/submit-to-head', requireAuth, requireRole('teacher'), submitAssignmentToHead);
router.post('/assignment/:assignmentId/publish-to-students', requireAuth, requireRole('admin'), publishAssignmentToStudents);

export default router;
