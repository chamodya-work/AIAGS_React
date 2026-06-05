import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { query } from "../db.js";

const router = Router();

// GET /api/courses
router.get("/courses", requireAuth, requireRole("admin", "teacher"), async (req, res) => {
    const rows = await query(
        "SELECT DISTINCT course_name FROM assignments ORDER BY course_name"
    );
    res.json({ courses: rows.map(r => r.course_name) });
});

// GET /api/batches?course_name=MBBS
router.get("/batches", requireAuth, requireRole("admin", "teacher"), async (req, res) => {
    const { course_name } = req.query;

    let sql = "SELECT DISTINCT batch FROM assignments WHERE 1=1";
    const params = [];
    if (course_name) { sql += " AND course_name=?"; params.push(course_name); }
    sql += " ORDER BY batch DESC";

    const rows = await query(sql, params);
    res.json({ batches: rows.map(r => r.batch) });
});

// GET /api/departments?course_name=MBBS&batch=2024
router.get("/departments", requireAuth, requireRole("admin", "teacher"), async (req, res) => {
    const { course_name, batch } = req.query;

    let sql = "SELECT DISTINCT department FROM assignments WHERE department IS NOT NULL AND department <> ''";
    const params = [];
    if (course_name) { sql += " AND course_name=?"; params.push(course_name); }
    if (batch) { sql += " AND batch=?"; params.push(batch); }
    sql += " ORDER BY department ASC";

    const rows = await query(sql, params);
    res.json({ departments: rows.map(r => r.department) });
});

export default router;
