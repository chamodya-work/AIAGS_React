import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db.js";

const router = Router();

// GET /api/courses
router.get("/courses", requireAuth, async (req, res) => {
    const rows = await query(
        "SELECT DISTINCT course_name FROM assignments ORDER BY course_name"
    );
    res.json({ courses: rows.map(r => r.course_name) });
});

// GET /api/batches?course_name=MBBS
router.get("/batches", requireAuth, async (req, res) => {
    const { course_name } = req.query;

    let sql = "SELECT DISTINCT batch FROM assignments WHERE 1=1";
    const params = [];
    if (course_name) { sql += " AND course_name=?"; params.push(course_name); }
    sql += " ORDER BY batch DESC";

    const rows = await query(sql, params);
    res.json({ batches: rows.map(r => r.batch) });
});

export default router;
