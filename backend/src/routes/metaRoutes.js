import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { query } from "../db.js";
import {
    DEFAULT_COURSES,
    getAllDefaultBatchOptions,
    getBatchOptionsForCourse,
    normalizeCourseName,
} from "../services/courseBatchService.js";

const router = Router();

const DEFAULT_DEPARTMENTS = [
    "Anatomy",
    "Biochemistry",
    "Physiology",
    "Pathology",
    "Microbiology",
    "Parasitology",
    "Pharmacology",
    "Forensic Medicine",
    "Medical Education",
    "Public Health",
    "Medicine",
    "Surgery",
    "Psychiatry",
    "Paediatrics",
    "Disability Studies",
    "Family Medicine",
    "Gyn & Obs.",
];

function mergeWithDefaults(defaults, rows) {
    const seen = new Set();
    const values = [];

    for (const value of defaults) {
        const text = String(value || "").trim();
        const key = text.toLowerCase();
        if (!text || seen.has(key)) continue;
        seen.add(key);
        values.push(text);
    }

    const extras = rows
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .filter((value) => {
            const key = value.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    return [...values, ...extras];
}

// GET /api/courses
router.get("/courses", requireAuth, requireRole("admin", "teacher"), async (req, res) => {
    res.json({ courses: DEFAULT_COURSES });
});

// GET /api/batches?course_name=MBBS
router.get("/batches", requireAuth, requireRole("admin", "teacher"), async (req, res) => {
    const courseName = normalizeCourseName(req.query.course_name || req.query.course);
    const defaults = courseName ? getBatchOptionsForCourse(courseName) : getAllDefaultBatchOptions();

    let sql = "SELECT DISTINCT batch FROM assignments WHERE 1=1";
    const params = [];
    if (courseName) { sql += " AND UPPER(course_name)=?"; params.push(courseName); }
    sql += " ORDER BY batch DESC";

    const rows = await query(sql, params);
    const dbBatches = rows
        .map(r => String(r.batch || "").trim())
        .filter((batch) => !courseName || defaults.includes(batch));
    res.json({ batches: mergeWithDefaults(defaults, dbBatches) });
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
    res.json({ departments: mergeWithDefaults(DEFAULT_DEPARTMENTS, rows.map(r => r.department)) });
});

export default router;
