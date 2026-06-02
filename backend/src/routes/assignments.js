import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { listAssignments, getAssignment, createAssignment, updateAssignment, deleteAssignment } from '../controllers/assignmentController.js';

const router = Router();

router.get('/', requireAuth, listAssignments);
router.get('/:id', requireAuth, getAssignment);
router.post('/', requireAuth, requireRole('admin', 'teacher'), createAssignment);
router.put('/:id', requireAuth, requireRole('admin', 'teacher'), updateAssignment);
router.delete('/:id', requireAuth, requireRole('admin'), deleteAssignment);

export default router;
