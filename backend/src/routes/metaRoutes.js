import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { query } from "../db.js";

const router = Router();

const DEFAULT_COURSES = ["MBBS", "SHS", "OT"];
const DEFAULT_BATCHES = ["2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"];
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
    const rows = await query(
        "SELECT DISTINCT course_name FROM assignments WHERE course_name IS NOT NULL AND course_name <> '' ORDER BY course_name"
    );
    res.json({ courses: mergeWithDefaults(DEFAULT_COURSES, rows.map(r => r.course_name)) });
});

// GET /api/batches?course_name=MBBS
router.get("/batches", requireAuth, requireRole("admin", "teacher"), async (req, res) => {
    const { course_name } = req.query;

    let sql = "SELECT DISTINCT batch FROM assignments WHERE 1=1";
    const params = [];
    if (course_name) { sql += " AND course_name=?"; params.push(course_name); }
    sql += " ORDER BY batch DESC";

    const rows = await query(sql, params);
    res.json({ batches: mergeWithDefaults(DEFAULT_BATCHES, rows.map(r => r.batch)) });
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
