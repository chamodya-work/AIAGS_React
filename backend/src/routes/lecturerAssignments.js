import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  assignPortfolios,
  getAssignmentGroups,
  listAssignmentSubmissions,
  listLecturers,
  unassignPortfolios,
} from '../controllers/lecturerAssignmentController.js';

const router = Router();

router.get('/lecturers', requireAuth, requireRole('admin'), listLecturers);
router.get('/assignments/:assignmentId/submissions', requireAuth, requireRole('admin'), listAssignmentSubmissions);
router.get('/assignments/:assignmentId/groups', requireAuth, requireRole('admin'), getAssignmentGroups);
router.post('/assign', requireAuth, requireRole('admin'), assignPortfolios);
router.post('/unassign', requireAuth, requireRole('admin'), unassignPortfolios);

export default router;
