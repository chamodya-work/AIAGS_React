import { authError } from './errors.js';
import { loginStaff } from './staffProvider.js';
import { loginStudent } from './studentProvider.js';
import { loginMock } from './mockProvider.js';
import { cleanText, envFlag } from './utils.js';

export async function authenticateUniversityUser({ userType, netId, password }) {
  if (!envFlag('ENABLE_UNIVERSITY_LOGIN', true)) {
    throw authError('University login is currently disabled.', 403);
  }

  const normalizedType = cleanText(userType).toLowerCase();
  const cleanNetId = cleanText(netId);
  if (!['student', 'staff'].includes(normalizedType)) {
    throw authError('Unknown user type.', 400);
  }
  if (!cleanNetId || !password) {
    throw authError('Net ID and password are required.', 400);
  }

  if ((process.env.UNIVERSITY_AUTH_PROVIDER || 'medicine_api') === 'mock') {
    return loginMock(normalizedType, cleanNetId, password);
  }

  if (normalizedType === 'student') return loginStudent(cleanNetId, password);
  return loginStaff(cleanNetId, password);
}
