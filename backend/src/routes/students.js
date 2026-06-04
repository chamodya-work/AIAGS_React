import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getMyDashboard, getMyResult } from "../controllers/studentController.js";
import {
  getFeedbackAttemptsForAssignment,
  getFeedbackHistoryForAssignment,
  requestFeedbackForAssignment,
} from "../controllers/studentFeedbackController.js";

const router = Router();

router.get("/dashboard", requireAuth, requireRole("student"), getMyDashboard);
router.get("/results/:assignmentId", requireAuth, requireRole("student"), getMyResult);
router.get("/feedback/attempts/:assignmentId", requireAuth, requireRole("student"), getFeedbackAttemptsForAssignment);
router.get("/feedback/history/:assignmentId", requireAuth, requireRole("student"), getFeedbackHistoryForAssignment);
router.post("/feedback", requireAuth, requireRole("student"), requestFeedbackForAssignment);

export default router;
