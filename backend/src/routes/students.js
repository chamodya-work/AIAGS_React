import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getMyDashboard } from "../controllers/studentController.js";

const router = Router();

router.get("/dashboard", requireAuth, requireRole("student"), getMyDashboard);

export default router;
