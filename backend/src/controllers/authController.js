import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { z } from "zod";
import { query } from "../db.js";

dotenv.config();

// ✅ Allow netId OR email (do NOT use .email() here)
const loginSchema = z.object({
  email: z.string().min(1),       // can be "mf_fw_test" OR "mf_fw_test@kln.ac.lk"
  password: z.string().min(1),
});

const createUserSchema = z.object({
  role: z.enum(["admin", "teacher", "student"]),
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
  return jwt.sign(
    {
      user_id: user.user_id,
      role: user.role,
      email: user.email,
      display_name: user.display_name,
      ...extra,
    },
    process.env.JWT_SECRET || "change_me",
    { expiresIn: "12h" }
  );
}

function getHomeRoute(role) {
  return role === "student" ? "/home_student.html" : "/add_assignments.html";
}

/**
 * POST /api/auth/login
 * Supports:
 *  - netId login (e.g., "mf_fw_test") -> university auth
 *  - university email login (e.g., "mf_fw_test@kln.ac.lk") -> university auth
 *  - local admin/teacher login using DB password_hash
 */
export async function login(req, res) {
  try {
    const { email: rawEmailOrNetId, password } = loginSchema.parse(req.body);

    const input = rawEmailOrNetId.trim();
    const inputNoDomainPrefix = input.includes("\\")
      ? input.split("\\").pop().trim()
      : input.includes("/")
        ? input.split("/").pop().trim()
        : input;

    // ✅ netId derived from either "netid" or "netid@domain"
    const netId = inputNoDomainPrefix.includes("@")
      ? inputNoDomainPrefix.split("@")[0].trim()
      : inputNoDomainPrefix;

    // ✅ Create a stable "full email" to store/search in DB for university users
    // Choose your official domain here:
    const fullEmail = inputNoDomainPrefix.includes("@")
      ? inputNoDomainPrefix
      : `${netId}@kln.ac.lk`;

    // ✅ Decide whether to use university auth
    // If user typed just netId -> university auth
    // If user typed @kln.ac.lk or @medicine.kln.ac.lk -> university auth
    const lowerInput = input.toLowerCase();
    const isUniversityLogin =
      !input.includes("@") ||
      lowerInput.endsWith("@kln.ac.lk") ||
      lowerInput.endsWith(".kln.ac.lk");

    // --------------------------------------------
    // 1) University auth path
    // --------------------------------------------
    if (isUniversityLogin) {
      const adStudentBaseDn =
        process.env.AD_STUDENT_BASE_DN ||
        "OU=Medicine,OU=Students,DC=kln,DC=ac,DC=lk";
      const adStaffBaseDn =
        process.env.AD_STAFF_BASE_DN ||
        "OU=Medicine,OU=Staff,DC=kln,DC=ac,DC=lk";
      const adBaseDns = [adStudentBaseDn, adStaffBaseDn];

      let uniData = null;
      let authSource = "student";
      let lastMessage = "Invalid credentials";
      const authAttempts = [];

      const candidateNetIds = Array.from(
        new Set(
          [
            netId,
            inputNoDomainPrefix,
            inputNoDomainPrefix.includes("@")
              ? inputNoDomainPrefix.split("@")[0].trim()
              : null,
            inputNoDomainPrefix.includes("@")
              ? inputNoDomainPrefix
              : `${netId}@kln.ac.lk`,
            `${netId}@medicine.kln.ac.lk`,
            `kln\\${netId}`,
            `kln.ac.lk\\${netId}`,
            `medicine\\${netId}`,
            `medicine.kln.ac.lk\\${netId}`,
          ].filter(Boolean)
        )
      );

      for (const baseDn of adBaseDns) {
        for (const candidateNetId of candidateNetIds) {
          const payload = {
            req_type: "log",
            netId: candidateNetId,
            username: candidateNetId,
            userName: candidateNetId,
            email: candidateNetId,
            password,
            baseDn,
            searchBase: baseDn,
            adBaseDn: baseDn,
          };

          try {
            const response = await fetch(
              "https://systems.medicine.kln.ac.lk/logsc/login.php",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              }
            );

            const text = await response.text();
            let parsed;
            try {
              parsed = text ? JSON.parse(text) : {};
            } catch {
              return res.status(502).json({
                error: "University auth returned invalid response",
                raw: text,
              });
            }

            if (parsed?.loginStatus === true) {
              authAttempts.push({
                baseDn,
                candidateNetId,
                loginStatus: true,
                message: parsed?.message || null,
              });
              uniData = parsed;
              authSource = baseDn === adStaffBaseDn ? "staff" : "student";
              break;
            }

            authAttempts.push({
              baseDn,
              candidateNetId,
              loginStatus: false,
              message: parsed?.message || null,
            });
            if (parsed?.message) lastMessage = parsed.message;
          } catch (e) {
            authAttempts.push({
              baseDn,
              candidateNetId,
              loginStatus: false,
              message: "fetch_error",
            });
            console.error("University auth fetch error:", e);
            return res.status(502).json({ error: "University auth system error" });
          }
        }

        if (uniData) break;
      }

      if (!uniData) {
        const debugInfo = {
          input,
          normalized: inputNoDomainPrefix,
          attempts: authAttempts,
        };
        console.warn("University auth failed", {
          input,
          normalized: inputNoDomainPrefix,
          attempts: authAttempts,
        });
        return res.status(401).json({
          error: lastMessage,
          ...(process.env.AUTH_DEBUG === "true" ? { debug: debugInfo } : {}),
        });
      }

      const stdNo = uniData?.stdNo || uniData?.student_no || uniData?.studentNo || null;
      const studentFullName =
        uniData?.full_name ||
        uniData?.fullName ||
        uniData?.display_name ||
        uniData?.displayName ||
        uniData?.name ||
        null;
      const studentBatch = uniData?.batch || uniData?.intake || null;
      const studentCourse = uniData?.course_name || uniData?.course || null;
      const studentDepartment = uniData?.department || uniData?.dept || null;
      const userRole = authSource === "staff" ? "teacher" : "student";

      // 2) Find or create local user (use fullEmail!)
      const existing = await query(
        "SELECT user_id, role, email, display_name FROM users WHERE email=?",
        [fullEmail]
      );
      let user = existing[0];

      if (!user) {
        const dummyHash = await bcrypt.hash("UNIVERSITY_AUTH_ONLY", 10);

        const ins = await query(
          "INSERT INTO users (role, email, password_hash, display_name) VALUES (?,?,?,?)",
          [userRole, fullEmail, dummyHash, null]
        );
        const userId = ins.insertId;

        if (userRole === "student") {
          const resolvedStudentNo = stdNo || `STD-${userId}`;
          await query(
            "INSERT INTO students (student_no, user_id, full_name, batch, course_name, department) VALUES (?,?,?,?,?,?)",
            [
              resolvedStudentNo,
              userId,
              studentFullName,
              studentBatch,
              studentCourse,
              studentDepartment,
            ]
          );
        } else {
          await query(
            "INSERT INTO teachers (teacher_id, user_id, teacher_mail, department) VALUES (?,?,?,?)",
            [netId, userId, fullEmail, null]
          );
        }

        const after = await query(
          "SELECT user_id, role, email, display_name FROM users WHERE user_id=?",
          [userId]
        );
        user = after[0];
      } else if (userRole === "student") {
        const resolvedStudentNo = stdNo || `STD-${user.user_id}`;
        const existingStudentByUser = (
          await query("SELECT student_no FROM students WHERE user_id=? LIMIT 1", [user.user_id])
        )[0];

        if (!existingStudentByUser) {
          const existingStudentByNo = (
            await query("SELECT student_no FROM students WHERE student_no=? LIMIT 1", [resolvedStudentNo])
          )[0];

          if (existingStudentByNo) {
            await query("UPDATE students SET user_id=? WHERE student_no=?", [user.user_id, resolvedStudentNo]);
          } else {
            await query(
              "INSERT INTO students (student_no, user_id, full_name, batch, course_name, department) VALUES (?,?,?,?,?,?)",
              [
                resolvedStudentNo,
                user.user_id,
                studentFullName,
                studentBatch,
                studentCourse,
                studentDepartment,
              ]
            );
          }
        }

        await query(
          `UPDATE students
           SET full_name = COALESCE(?, full_name),
               batch = COALESCE(?, batch),
               course_name = COALESCE(?, course_name),
               department = COALESCE(?, department)
           WHERE user_id = ?`,
          [studentFullName, studentBatch, studentCourse, studentDepartment, user.user_id]
        );
      }

      const token = signToken(user, { stdNo, adSource: authSource });

      return res.json({
        token,
        user: {
          user_id: user.user_id,
          role: user.role,
          email: user.email, // this will be fullEmail
          display_name: user.display_name,
          stdNo,
          adSource: authSource,
        },
        homeRoute: getHomeRoute(user.role),
      });
    }

    // --------------------------------------------
    // 2) Local login path (admin/teacher)
    // --------------------------------------------
    // Local users MUST login using real email stored in DB
    // If someone typed netId here, it will not match DB and fail (expected)
    const rows = await query(
      "SELECT user_id, role, email, password_hash, display_name FROM users WHERE email=?",
      [input]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    if (!user.password_hash) {
      return res.status(401).json({ error: "Use university login for this account" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    const token = signToken(user);

    return res.json({
      token,
      user: {
        user_id: user.user_id,
        role: user.role,
        email: user.email,
        display_name: user.display_name,
      },
      homeRoute: getHomeRoute(user.role),
    });
  } catch (e) {
    if (e?.issues) {
      return res.status(400).json({ error: "Validation error", details: e.issues });
    }
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}

export async function createUser(req, res) {
  try {
    const data = createUserSchema.parse(req.body);

    const hash = await bcrypt.hash(data.password, 10);
    const result = await query(
      "INSERT INTO users (role, email, password_hash, display_name) VALUES (?,?,?,?)",
      [data.role, data.email, hash, data.display_name || null]
    );
    const userId = result.insertId;

    if (data.role === "student") {
      if (!data.student_no)
        return res.status(400).json({ error: "student_no is required for students" });

      await query(
        "INSERT INTO students (student_no, user_id, batch, course_name, department) VALUES (?,?,?,?,?)",
        [
          data.student_no,
          userId,
          data.batch || null,
          data.course_name || null,
          data.department || null,
        ]
      );
    }

    if (data.role === "teacher") {
      if (!data.teacher_id)
        return res.status(400).json({ error: "teacher_id is required for teachers" });

      await query(
        "INSERT INTO teachers (teacher_id, user_id, teacher_mail, department) VALUES (?,?,?,?)",
        [data.teacher_id, userId, data.email, data.department || null]
      );
    }

    if (data.role === "admin") {
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

