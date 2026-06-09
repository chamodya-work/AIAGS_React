import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  getAiReport,
  getAiReportPdf,
  getAssignmentGradingStatus,
  gradeOne,
  gradeAssignment,
  setFinalGrade,
  listResultsByAssignment,
  publishAssignmentGrades
} from '../controllers/gradingController.js';

const router = Router();

router.post('/portfolio/:id/ai', requireAuth, requireRole('admin','teacher'), gradeOne);
router.post('/assignment/:assignmentId/ai', requireAuth, requireRole('admin','teacher'), gradeAssignment);
router.get('/assignment/:assignmentId/status', requireAuth, requireRole('admin','teacher'), getAssignmentGradingStatus);
router.get('/assignment/:assignmentId/results', requireAuth, requireRole('admin','teacher'), listResultsByAssignment);
router.get('/portfolio/:id/report', requireAuth, requireRole('admin','teacher'), getAiReport);
router.get('/portfolio/:id/report/pdf', requireAuth, requireRole('admin','teacher'), getAiReportPdf);
router.post('/portfolio/:id/final', requireAuth, requireRole('admin','teacher'), setFinalGrade);
router.post('/assignment/:assignmentId/publish', requireAuth, requireRole('admin'), publishAssignmentGrades);

export default router;
