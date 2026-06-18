import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { z } from "zod";
import { query } from "../db.js";
import { normalizeRole, roleLabel } from "../middleware/auth.js";
import { authenticateUniversityUser } from "../services/universityAuth/index.js";
import { upsertUserFromUniversityProfile } from "../services/universityAuth/userSyncService.js";
import { envFlag } from "../services/universityAuth/utils.js";

dotenv.config();

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

const universityLoginSchema = z.object({
  userType: z.enum(["student", "staff"]),
  netId: z.string().min(1),
  password: z.string().min(1),
});

const createUserSchema = z.object({
  role: z.enum(["admin", "teacher", "lecturer", "student"]),
  email: z.string().email(),
  password: z.string().min(6),
  display_name: z.string().min(1).optional(),
  student_no: z.string().min(1).optional(),
  teacher_id: z.string().min(1).optional(),
  department: z.string().optional(),
  batch: z.string().optional(),
  course_name: z.string().optional(),
});

function signToken(user, extra = {}) {
  const role = normalizeRole(user.role);

  return jwt.sign(
    {
      user_id: user.user_id,
      role,
      role_label: roleLabel(role),
      email: user.email,
      display_name: user.display_name,
      auth_provider: user.auth_provider || "local",
      ...extra,
    },
    process.env.JWT_SECRET || "change_me",
    { expiresIn: "12h" }
  );
}

function getHomeRoute(role) {
  const normalized = normalizeRole(role);
  if (normalized === "student") return "/student/home";
  if (normalized === "admin") return "/portfolio/list";
  return "/grading";
}

async function getRelatedIdentity(user) {
  const role = normalizeRole(user.role);
  if (role === "student") {
    const row = (
      await query(
        `SELECT student_no, full_name, batch, course_name, department
         FROM students
         WHERE user_id=?
         LIMIT 1`,
        [user.user_id]
      )
    )[0];
    return row ? {
      student_no: row.student_no,
      stdNo: row.student_no,
      full_name: row.full_name,
      batch: row.batch,
      course_name: row.course_name,
      department: row.department,
    } : {};
  }

  if (role === "teacher") {
    const row = (
      await query(
        `SELECT teacher_id, staff_id, full_name, department, designation
         FROM teachers
         WHERE user_id=?
         LIMIT 1`,
        [user.user_id]
      )
    )[0];
    return row ? {
      teacher_id: row.teacher_id,
      staff_id: row.staff_id,
      full_name: row.full_name,
      department: row.department,
      designation: row.designation,
    } : {};
  }

  if (role === "admin") {
    const row = (
      await query(
        `SELECT admin_id, staff_id, admin_name, department, designation
         FROM administrators
         WHERE user_id=?
         LIMIT 1`,
        [user.user_id]
      )
    )[0];
    return row ? {
      admin_id: row.admin_id,
      staff_id: row.staff_id,
      full_name: row.admin_name,
      department: row.department,
      designation: row.designation,
    } : {};
  }

  return {};
}

async function buildLoginResponse(user) {
  const role = normalizeRole(user.role);
  const related = await getRelatedIdentity(user);
  const token = signToken(user, related);
  return {
    token,
    user: {
      user_id: user.user_id,
      role,
      role_label: roleLabel(role),
      email: user.email,
      display_name: user.display_name,
      auth_provider: user.auth_provider || "local",
      university_user_id: user.university_user_id || null,
      user_type: user.user_type || null,
      ...related,
    },
    homeRoute: getHomeRoute(role),
  };
}

export async function login(req, res) {
  try {
    // console.log("Status of local login:", process.env.ENABLE_LOCAL_LOGIN);
    if (!envFlag("ENABLE_LOCAL_LOGIN", true)) {
      return res.status(403).json({ error: "Local login is currently disabled." });
    }

    const { email, password } = loginSchema.parse(req.body);
    const rows = await query(
      `SELECT user_id, university_user_id, auth_provider, role, email, password_hash,
              display_name, user_type, is_active
       FROM users
       WHERE email=?
       LIMIT 1`,
      [email.trim()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    if (Number(user.is_active) === 0) return res.status(403).json({ error: "This account is inactive." });
    if (!user.password_hash) {
      return res.status(401).json({ error: "Use university login for this account" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    await query("UPDATE users SET last_login_at=NOW() WHERE user_id=?", [user.user_id]);
    return res.json(await buildLoginResponse(user));
  } catch (e) {
    if (e?.issues) {
      return res.status(400).json({ error: "Validation error", details: e.issues });
    }
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}

export async function universityLogin(req, res) {
  try {
    const credentials = universityLoginSchema.parse(req.body);
    const profile = await authenticateUniversityUser(credentials);
    if (!profile?.is_active) return res.status(403).json({ error: "This university account is inactive." });

    const user = await upsertUserFromUniversityProfile(profile);
    return res.json(await buildLoginResponse(user));
  } catch (e) {
    if (e?.issues) {
      return res.status(400).json({ error: "Validation error", details: e.issues });
    }
    if (e?.statusCode) {
      return res.status(e.statusCode).json({ error: e.publicMessage || e.message });
    }
    if (e?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "A local user already exists with the synced university email." });
    }
    console.error(e);
    return res.status(500).json({ error: "University login failed" });
  }
}

export async function createUser(req, res) {
  try {
    const data = createUserSchema.parse(req.body);
    const role = normalizeRole(data.role);

    const hash = await bcrypt.hash(data.password, 10);
    const result = await query(
      "INSERT INTO users (role, email, password_hash, display_name, auth_provider) VALUES (?,?,?,?, 'local')",
      [role, data.email, hash, data.display_name || null]
    );
    const userId = result.insertId;

    if (role === "student") {
      if (!data.student_no)
        return res.status(400).json({ error: "student_no is required for students" });

      await query(
        "INSERT INTO students (student_no, user_id, batch, course_name, department) VALUES (?,?,?,?,?)",
        [
          data.student_no,
          userId,
          // data.batch || null,
          data.student_no.split('/')[1] || null,
          data.course_name || null,
          data.department || null,
        ]
      );
    }

    if (role === "teacher") {
      if (!data.teacher_id)
        return res.status(400).json({ error: "teacher_id is required for teachers" });

      await query(
        "INSERT INTO teachers (teacher_id, user_id, teacher_mail, department) VALUES (?,?,?,?)",
        [data.teacher_id, userId, data.email, data.department || null]
      );
    }

    if (role === "admin") {
      await query(
        "INSERT INTO administrators (admin_id, user_id, admin_name, email, department) VALUES (?,?,?,?,?)",
        [`ADMIN-${userId}`, userId, data.display_name || null, data.email, data.department || null]
      );
    }

    return res.status(201).json({ ok: true, user_id: userId });
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: "Validation error", details: e.issues });
    if (e?.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Email already exists" });
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}

export async function me(req, res) {
  return res.json({ user: req.user });
}

export async function studentHomeAccess(req, res) {
  return res.json({ ok: true, user: req.user });
}
