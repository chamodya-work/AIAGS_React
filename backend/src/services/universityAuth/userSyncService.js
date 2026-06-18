import bcrypt from 'bcryptjs';
import { pool } from '../../db.js';

const UNIVERSITY_ONLY_PASSWORD = 'UNIVERSITY_AUTH_ONLY';

function jsonProfile(profile) {
  return JSON.stringify(profile?.raw || {});
}

async function findExistingUser(conn, profile) {
  const [byUniversityId] = await conn.execute(
    `SELECT user_id, role, email, display_name, local_role_override
     FROM users
     WHERE university_user_id=?
     LIMIT 1`,
    [profile.university_user_id]
  );
  if (byUniversityId[0]) return byUniversityId[0];

  const [byEmail] = await conn.execute(
    `SELECT user_id, role, email, display_name, local_role_override
     FROM users
     WHERE email=?
     LIMIT 1`,
    [profile.email]
  );
  return byEmail[0] || null;
}

async function syncStudent(conn, userId, profile) {
  console.log('student profile details:', profile);
  const student = profile.student;
  if (!student?.student_no) return;

  const [existing] = await conn.execute(
    'SELECT student_no FROM students WHERE student_no=? LIMIT 1',
    [student.student_no]
  );

  if (existing[0]) {
    await conn.execute(
      `UPDATE students
       SET user_id=?, full_name=?, batch=?, course_name=?, department=?,
           faculty=?, university_email=?, intake_academic_year=?, original_batch=?, contact_mobile=?
       WHERE student_no=?`,
      [
        userId,
        profile.full_name,
        // student.batch,
        student.student_no.split('/')[1] || null,
        student.course_name,
        profile.department,
        profile.faculty,
        profile.email,
        student.intake_academic_year,
        student.original_batch,
        student.contact_mobile,
        student.student_no,
      ]
    );
  } else {
    await conn.execute(
      `INSERT INTO students
        (student_no, user_id, full_name, batch, course_name, department,
         faculty, university_email, intake_academic_year, original_batch, contact_mobile)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        student.student_no,
        userId,
        profile.full_name,
        // student.batch,
        student.student_no.split('/')[1] || null,
        student.course_name,
        profile.department,
        profile.faculty,
        profile.email,
        student.intake_academic_year,
        student.original_batch,
        student.contact_mobile,
      ]
    );
  }
}

async function syncTeacher(conn, userId, profile) {
  const staff = profile.staff;
  if (!staff?.staff_id) return;
  const teacherId = staff.staff_id;

  const [existingByUser] = await conn.execute(
    'SELECT teacher_id FROM teachers WHERE user_id=? LIMIT 1',
    [userId]
  );
  const [existingByTeacher] = await conn.execute(
    'SELECT teacher_id FROM teachers WHERE teacher_id=? LIMIT 1',
    [teacherId]
  );

  if (existingByUser[0]) {
    await conn.execute(
      `UPDATE teachers
       SET staff_id=?, teacher_mail=?, full_name=?, department=?,
           designation=?, faculty=?, profile_image=?
       WHERE user_id=?`,
      [
        staff.staff_id,
        profile.email,
        profile.full_name,
        profile.department,
        staff.designation,
        profile.faculty,
        staff.profile_image,
        userId,
      ]
    );
  } else if (existingByTeacher[0]) {
    await conn.execute(
      `UPDATE teachers
       SET user_id=?, staff_id=?, teacher_mail=?, full_name=?, department=?,
           designation=?, faculty=?, profile_image=?
       WHERE teacher_id=?`,
      [
        userId,
        staff.staff_id,
        profile.email,
        profile.full_name,
        profile.department,
        staff.designation,
        profile.faculty,
        staff.profile_image,
        teacherId,
      ]
    );
  } else {
    await conn.execute(
      `INSERT INTO teachers
        (teacher_id, staff_id, user_id, teacher_mail, full_name, department,
         designation, faculty, profile_image)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        teacherId,
        staff.staff_id,
        userId,
        profile.email,
        profile.full_name,
        profile.department,
        staff.designation,
        profile.faculty,
        staff.profile_image,
      ]
    );
  }
}

async function syncAdministrator(conn, userId, profile) {
  const staff = profile.staff;
  const staffId = staff?.staff_id || String(userId);
  const adminId = `ADMIN-${staffId}`;

  const [existingByUser] = await conn.execute(
    'SELECT admin_id FROM administrators WHERE user_id=? LIMIT 1',
    [userId]
  );
  const [existingByAdmin] = await conn.execute(
    'SELECT admin_id FROM administrators WHERE admin_id=? LIMIT 1',
    [adminId]
  );

  if (existingByUser[0]) {
    await conn.execute(
      `UPDATE administrators
       SET staff_id=?, admin_name=?, email=?, department=?, designation=?
       WHERE user_id=?`,
      [staffId, profile.full_name, profile.email, profile.department, staff?.designation || null, userId]
    );
  } else if (existingByAdmin[0]) {
    await conn.execute(
      `UPDATE administrators
       SET user_id=?, staff_id=?, admin_name=?, email=?, department=?, designation=?
       WHERE admin_id=?`,
      [userId, staffId, profile.full_name, profile.email, profile.department, staff?.designation || null, adminId]
    );
  } else {
    await conn.execute(
      `INSERT INTO administrators
        (admin_id, staff_id, user_id, admin_name, email, department, designation)
       VALUES (?,?,?,?,?,?,?)`,
      [adminId, staffId, userId, profile.full_name, profile.email, profile.department, staff?.designation || null]
    );
  }
}

export async function upsertUserFromUniversityProfile(profile) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const existing = await findExistingUser(conn, profile);
    const role = existing?.local_role_override ? existing.role : profile.role;
    let userId = existing?.user_id;

    if (!userId) {
      const passwordHash = await bcrypt.hash(UNIVERSITY_ONLY_PASSWORD, 10);
      const [result] = await conn.execute(
        `INSERT INTO users
          (university_user_id, auth_provider, role, email, password_hash, display_name,
           email_verified, user_type, is_active, last_login_at, last_synced_at, raw_university_profile)
         VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW(),?)`,
        [
          profile.university_user_id,
          profile.auth_provider,
          role,
          profile.email,
          passwordHash,
          profile.full_name,
          profile.email_verified ? 1 : 0,
          profile.user_type,
          profile.is_active ? 1 : 0,
          jsonProfile(profile),
        ]
      );
      userId = result.insertId;
    } else {
      await conn.execute(
        `UPDATE users
         SET university_user_id=COALESCE(university_user_id, ?),
             auth_provider=?,
             role=?,
             email=?,
             display_name=?,
             email_verified=?,
             user_type=?,
             is_active=?,
             last_login_at=NOW(),
             last_synced_at=NOW(),
             raw_university_profile=?
         WHERE user_id=?`,
        [
          profile.university_user_id,
          profile.auth_provider,
          role,
          profile.email,
          profile.full_name,
          profile.email_verified ? 1 : 0,
          profile.user_type,
          profile.is_active ? 1 : 0,
          jsonProfile(profile),
          userId,
        ]
      );
    }

    if (role === 'student') await syncStudent(conn, userId, profile);
    if (role === 'teacher') await syncTeacher(conn, userId, profile);
    if (role === 'admin') await syncAdministrator(conn, userId, profile);

    const [rows] = await conn.execute(
      `SELECT user_id, university_user_id, auth_provider, role, email, display_name,
              email_verified, user_type, is_active, local_role_override,
              last_login_at, last_synced_at
       FROM users
       WHERE user_id=?`,
      [userId]
    );

    await conn.commit();
    return rows[0];
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}
