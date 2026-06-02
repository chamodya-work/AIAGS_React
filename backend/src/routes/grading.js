import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { gradeOne, gradeAssignment, setFinalGrade, listResultsByAssignment, publishAssignmentGrades } from '../controllers/gradingController.js';

const router = Router();

router.post('/portfolio/:id/ai', requireAuth, requireRole('admin','teacher'), gradeOne);
router.post('/assignment/:assignmentId/ai', requireAuth, requireRole('admin','teacher'), gradeAssignment);
router.get('/assignment/:assignmentId/results', requireAuth, listResultsByAssignment);
router.post('/portfolio/:id/final', requireAuth, requireRole('admin','teacher'), setFinalGrade);
router.post('/assignment/:assignmentId/publish', requireAuth, requireRole('admin','teacher'), publishAssignmentGrades);

export default router;
