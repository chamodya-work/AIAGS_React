import axios from 'axios';
import { authError, serviceUnavailable } from './errors.js';
import { mapCourseNameFromStudentNumber, roleLabel } from './roleMappingService.js';
import {
  cleanText,
  envNumber,
  parseJsonishResponse,
  pickPreferredEmail,
  safeRawProfile,
} from './utils.js';

const DEFAULT_STUDENT_API_URL = 'http://dt.medicine.kln.ac.lk/exp_ser/hostel.php';

export async function loginStudent(netId, password) {
  const url = process.env.UNIVERSITY_STUDENT_API_URL || DEFAULT_STUDENT_API_URL;
  const timeout = envNumber('UNIVERSITY_STUDENT_TIMEOUT_MS', 15000);

  let parsed;
  try {
    const response = await axios.post(
      url,
      { netId, password },
      {
        timeout,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    parsed = parseJsonishResponse(response.data);
  } catch (error) {
    if (error?.response) {
      throw authError('Invalid Net ID or password', 401);
    }
    throw serviceUnavailable();
  }

  if (String(parsed?.state).toLowerCase() !== 'true' || !parsed?.data?.StudentNumber) {
    throw authError('Invalid Net ID or password', 401);
  }

  return normalizeStudentProfile(parsed.data, netId);
}

export function normalizeStudentProfile(raw, netId) {
  const studentNo = cleanText(raw?.StudentNumber);
  if (!studentNo) throw authError('Missing student number from university profile', 502);

  const fullName = cleanText(raw?.fullName) || cleanText(raw?.name) || studentNo;
  const email = pickPreferredEmail(raw?.studentEmail, { fallbackNetId: netId, fallbackDomain: 'stu.kln.ac.lk' });
  const faculty = process.env.UNIVERSITY_DEFAULT_FACULTY || 'Faculty of Medicine';
  const department = process.env.UNIVERSITY_DEFAULT_STUDENT_DEPARTMENT || 'Medicine';
  const batch = cleanText(raw?.intakeAcademicYear) || cleanText(raw?.Originalbatch) || null;
  const courseName = mapCourseNameFromStudentNumber(studentNo, raw?.course);

  return {
    university_user_id: `student:${studentNo}`,
    auth_provider: 'medicine_student_api',
    email,
    full_name: fullName,
    user_type: 'student',
    role: 'student',
    role_label: roleLabel('student'),
    faculty,
    department,
    is_active: true,
    email_verified: Boolean(email),
    student: {
      student_no: studentNo,
      batch,
      course_name: courseName,
      original_batch: cleanText(raw?.Originalbatch) || null,
      intake_academic_year: cleanText(raw?.intakeAcademicYear) || null,
      contact_mobile: cleanText(raw?.contactMobile) || null,
    },
    staff: null,
    raw: safeRawProfile(raw),
  };
}
