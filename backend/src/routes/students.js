import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getMyDashboard, getMyResult } from "../controllers/studentController.js";
import {
  getFeedbackAttemptsForAssignment,
  getFeedbackHistoryForAssignment,
  requestFeedbackForAssignment,
} from "../controllers/studentFeedbackController.js";
import {
  getAssignmentRequirements,
  getStudentSubmission,
  removeStudentSubmissionFile,
  saveStudentSubmission,
  viewStudentSubmissionFile,
} from "../controllers/studentSubmissionController.js";

const router = Router();

const submissionDir = path.join(process.cwd(), "uploads", "submissions");
fs.mkdirSync(submissionDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, submissionDir),
    filename: (req, file, cb) => {
      const safe = path.basename(file.originalname || "submission").replace(/[^a-zA-Z0-9._-]/g, "_");
      const unique = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}_${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (ext === ".doc") {
      return cb(new Error("DOC files are not supported. Please convert the document to DOCX or PDF and upload again."));
    }

    const allowed = [".pdf", ".docx", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".xlsx", ".xls", ".csv"];
    if (!allowed.includes(ext)) {
      return cb(new Error("Unsupported file type. Please upload PDF, DOCX, image, or Excel files according to the required document type."));
    }
    cb(null, true);
  },
});

function handleSubmissionUpload(req, res, next) {
  upload.any()(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

router.get("/dashboard", requireAuth, requireRole("student"), getMyDashboard);
router.get("/results/:assignmentId", requireAuth, requireRole("student"), getMyResult);
router.get("/feedback/attempts/:assignmentId", requireAuth, requireRole("student"), getFeedbackAttemptsForAssignment);
router.get("/feedback/history/:assignmentId", requireAuth, requireRole("student"), getFeedbackHistoryForAssignment);
router.post("/feedback", requireAuth, requireRole("student"), requestFeedbackForAssignment);
router.get("/assignments/:assignmentId/requirements", requireAuth, requireRole("student"), getAssignmentRequirements);
router.get("/assignments/:assignmentId/submission", requireAuth, requireRole("student"), getStudentSubmission);
router.post("/assignments/:assignmentId/submission", requireAuth, requireRole("student"), handleSubmissionUpload, saveStudentSubmission);
router.put("/assignments/:assignmentId/submission", requireAuth, requireRole("student"), handleSubmissionUpload, saveStudentSubmission);
router.get("/submission-files/:fileId/view", requireAuth, requireRole("student"), viewStudentSubmissionFile);
router.delete("/submission-files/:fileId", requireAuth, requireRole("student"), removeStudentSubmissionFile);

export default router;
