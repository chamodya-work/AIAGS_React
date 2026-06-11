import { authError } from './errors.js';
import { normalizeStaffProfile } from './staffProvider.js';
import { normalizeStudentProfile } from './studentProvider.js';

export async function loginMock(userType, netId, password) {
  if (password !== 'password') throw authError('Invalid Net ID or password', 401);

  if (userType === 'student') {
    return normalizeStudentProfile({
      StudentNumber: 'ME/2019/008',
      course: 'Bachelor of Medicine, Bachelor of Surgery',
      Originalbatch: '32',
      intakeAcademicYear: '2019/2020',
      fullName: 'Mock Student',
      name: 'MOCK S.',
      studentEmail: 'mock.student@stu.kln.ac.lk',
      contactMobile: '0700000000',
    }, netId);
  }

  if (userType === 'staff') {
    return normalizeStaffProfile({
      loginStatus: 1,
      name: netId === 'hod' ? 'Mock Head' : 'Mock Lecturer',
      empId: netId === 'hod' ? 'HOD001' : 'STAFF001',
      designation: netId === 'hod' ? 'Professor' : 'Lecturer',
      department: 'Department of Medical Education',
      email: `${netId}@kln.ac.lk`,
      staff_cat: '1',
      role: netId === 'hod'
        ? { dept: 'Department of Medical Education', position: 'Head of the Department', pos_id: '2', div_id: '18' }
        : { dept: '', position: '', pos_id: '', div_id: '' },
    }, netId);
  }

  throw authError('Unknown user type', 400);
}
