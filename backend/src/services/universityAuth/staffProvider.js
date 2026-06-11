import axios from 'axios';
import { authError, serviceUnavailable } from './errors.js';
import { mapStaffRole, roleLabel } from './roleMappingService.js';
import {
  cleanText,
  envNumber,
  parseJsonishResponse,
  pickPreferredEmail,
  safeRawProfile,
} from './utils.js';

const DEFAULT_STAFF_API_URL = 'https://sys.medicine.kln.ac.lk/exp_ser/vmsinfo.php';

export async function loginStaff(netId, password) {
  const url = process.env.UNIVERSITY_STAFF_API_URL || DEFAULT_STAFF_API_URL;
  const timeout = envNumber('UNIVERSITY_STAFF_TIMEOUT_MS', 15000);

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

  if (Number(parsed?.loginStatus) !== 1) {
    throw authError('Invalid Net ID or password', 401);
  }

  return normalizeStaffProfile(parsed, netId);
}

export function normalizeStaffProfile(raw, netId) {
  const staffId = cleanText(raw?.empId);
  const name = cleanText(raw?.name);
  const email = pickPreferredEmail(raw?.email, { fallbackNetId: netId, fallbackDomain: 'kln.ac.lk' });
  if (!staffId) throw authError('Missing staff ID from university profile', 502);
  if (!name) throw authError('Missing staff name from university profile', 502);
  if (!email) throw authError('Missing staff email from university profile', 502);

  const role = mapStaffRole(raw);
  const department = cleanText(raw?.role?.dept) || cleanText(raw?.department) || null;
  const faculty = process.env.UNIVERSITY_DEFAULT_FACULTY || 'Faculty of Medicine';

  return {
    university_user_id: `staff:${staffId}`,
    auth_provider: 'medicine_staff_api',
    email,
    full_name: name,
    user_type: 'staff',
    role,
    role_label: roleLabel(role),
    faculty,
    department,
    is_active: true,
    email_verified: true,
    staff: {
      staff_id: staffId,
      designation: cleanText(raw?.designation) || null,
      staff_cat: cleanText(raw?.staff_cat) || null,
      dep_code: cleanText(raw?.dep_code) || null,
      profile_image: cleanText(raw?.img) || null,
      role_position: cleanText(raw?.role?.position) || null,
      role_pos_id: cleanText(raw?.role?.pos_id) || null,
    },
    student: null,
    raw: safeRawProfile(raw),
  };
}
