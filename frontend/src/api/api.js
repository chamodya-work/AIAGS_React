// src/api/api.js

const BASE = '';

async function request(path, opts = {}) {
  const token = localStorage.getItem('aigs_token');
  const headers = { ...(opts.headers || {}) };

  if (!(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(BASE + path, { ...opts, headers });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.error || data?.message || `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function openAuthorizedFile(path) {
  const token = localStorage.getItem('aigs_token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(BASE + path, { headers });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const data = await res.json();
      message = data?.error || data?.message || message;
    } catch {
      // Keep the generic message when the response is not JSON.
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || 'download';
  const namedBlob = typeof File === 'function'
    ? new File([blob], filename, { type: blob.type || 'application/octet-stream' })
    : blob;
  const url = URL.createObjectURL(namedBlob);
  const viewable = (blob.type || '').startsWith('application/pdf')
    || (blob.type || '').startsWith('image/')
    || (blob.type || '').startsWith('text/');

  if (viewable) {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function downloadAuthorizedFile(path, fallbackFilename) {
  const token = localStorage.getItem('aigs_token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(BASE + path, { headers });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const data = await res.json();
      message = data?.error || data?.message || message;
    } catch {
      // Keep the generic message when the response is not JSON.
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || fallbackFilename || 'download.pdf';
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const api = {
  auth: {
    // POST /api/auth/login
    login: (email, password) =>
      request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    universityLogin: ({ userType, netId, password }) =>
      request('/api/auth/university/login', {
        method: 'POST',
        body: JSON.stringify({ userType, netId, password }),
      }),
    // GET /api/auth/me
    me: () => request('/api/auth/me'),
  },

  // GET /api/courses  → { courses: ["MBBS","BDS",...] }  (plain strings)
  courses: {
    list: () => request('/api/courses'),
  },

  // GET /api/batches?course_name=X  → { batches: ["2023","2024",...] }  (plain strings)
  batches: {
    list: ({ course_name } = {}) =>
      request(`/api/batches${course_name ? `?course_name=${encodeURIComponent(course_name)}` : ''}`),
  },

  departments: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request(`/api/departments${q ? `?${q}` : ''}`);
    },
  },

  // /api/assignments
  assignments: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request(`/api/assignments${q ? `?${q}` : ''}`);
    },
    get: (id) => request(`/api/assignments/${id}`),
    create: (payload) =>
      request('/api/assignments', {
        method: 'POST',
        body: payload instanceof FormData ? payload : JSON.stringify(payload),
      }),
    update: (id, payload) => request(`/api/assignments/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    remove: (id) => request(`/api/assignments/${id}`, { method: 'DELETE' }),
    openGuideline: (id) => openAuthorizedFile(`/api/assignments/${id}/guideline`),
  },

  // /api/rubrics
  rubrics: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request(`/api/rubrics${q ? `?${q}` : ''}`);
    },
    byAssignment: (assignmentId) => request(`/api/rubrics/assignment/${assignmentId}`),
    create: (payload) => request('/api/rubrics', { method: 'POST', body: JSON.stringify(payload) }),
    upload: ({ assignment_id, rubric_name, file }) => {
      const fd = new FormData();
      fd.append('assignment_id', String(assignment_id));
      if (rubric_name) fd.append('rubric_name', rubric_name);
      fd.append('file', file);
      return request('/api/rubrics/upload', { method: 'POST', body: fd });
    },
    openFile: (rubricId) => openAuthorizedFile(`/api/rubrics/${rubricId}/file`),
    update: (rubricId, payload) => request(`/api/rubrics/${rubricId}`, { method: 'PUT', body: JSON.stringify(payload) }),
    remove: (rubricId) => request(`/api/rubrics/${rubricId}`, { method: 'DELETE' }),
  },

  // /api/portfolios
  portfolios: {
    list: ({ assignment_id } = {}) => {
      const qs = new URLSearchParams();
      if (assignment_id) qs.set('assignment_id', assignment_id);
      return request(`/api/portfolios?${qs.toString()}`);
    },
    adminSubmission: ({ assignment_id, student_no }) => {
      const qs = new URLSearchParams();
      qs.set('assignment_id', assignment_id);
      if (student_no) qs.set('student_no', student_no);
      return request(`/api/portfolios/submission?${qs.toString()}`);
    },
    submissionPackage: (portfolioId) => request(`/api/portfolios/${portfolioId}/submission`),
    // Backend requires: student_no (string), assignment_id (number), file (multipart)
    upload: ({ student_no, assignment_id, file, files, filesByRequirement }) => {
      const fd = new FormData();
      fd.append('student_no', student_no);
      fd.append('assignment_id', String(assignment_id));
      if (filesByRequirement) {
        Object.entries(filesByRequirement).forEach(([requirementId, groupFiles]) => {
          const fieldName = requirementId === 'general' ? 'files_general' : `files_${requirementId}`;
          (groupFiles || []).forEach((item) => fd.append(fieldName, item));
        });
      } else {
        const uploadFiles = files?.length ? files : (file ? [file] : []);
        uploadFiles.forEach((item) => fd.append(uploadFiles.length > 1 ? 'files' : 'file', item));
      }
      return request('/api/portfolios/upload', { method: 'POST', body: fd });
    },
    remove: (id) => request(`/api/portfolios/${id}`, { method: 'DELETE' }),
    removeFile: (fileId) => request(`/api/portfolios/files/${fileId}`, { method: 'DELETE' }),
    openFile: (fileId) => openAuthorizedFile(`/api/portfolios/files/${fileId}/view`),
  },

  // /api/grading
  grading: {
    gradePortfolioAI: (portfolioId, options = {}) =>
      request(`/api/grading/portfolio/${portfolioId}/ai`, { method: 'POST', body: JSON.stringify(options) }),
    gradeAssignmentAI: (assignmentId, options = {}) =>
      request(`/api/grading/assignment/${assignmentId}/ai`, { method: 'POST', body: JSON.stringify(options) }),
    statusByAssignment: (assignmentId) =>
      request(`/api/grading/assignment/${assignmentId}/status`),
    resultsByAssignment: (assignmentId) =>
      request(`/api/grading/assignment/${assignmentId}/results`),
    report: (portfolioId) => request(`/api/grading/portfolio/${portfolioId}/report`),
    downloadReportPdf: (portfolioId) =>
      downloadAuthorizedFile(
        `/api/grading/portfolio/${portfolioId}/report/pdf`,
        `ai-assignment-evaluation-report-${portfolioId}.pdf`
      ),
    // Backend expects: { final_grade: number, status?: 'DRAFT'|'PUBLISHED' }
    setFinal: (portfolioId, payload) =>
      request(`/api/grading/portfolio/${portfolioId}/final`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    publishAssignment: (assignmentId) =>
      request(`/api/grading/assignment/${assignmentId}/publish`, { method: 'POST' }),
  },

  lecturerAssignments: {
    lecturers: () => request('/api/lecturer-assignments/lecturers'),
    submissions: (assignmentId) => request(`/api/lecturer-assignments/assignments/${assignmentId}/submissions`),
    groups: (assignmentId) => request(`/api/lecturer-assignments/assignments/${assignmentId}/groups`),
    assign: (payload) =>
      request('/api/lecturer-assignments/assign', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    distribute: (payload) =>
      request('/api/lecturer-assignments/distribute', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    unassign: (payload) =>
      request('/api/lecturer-assignments/unassign', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },

  manualGrading: {
    resultsByAssignment: (assignmentId) =>
      request(`/api/manual-grading/assignment/${assignmentId}/results`),
    downloadExcel: (assignmentId) =>
      downloadAuthorizedFile(
        `/api/manual-grading/assignment/${assignmentId}/export/excel`,
        'manual-grading-report.xlsx'
      ),
    save: (portfolioId, payload) =>
      request(`/api/manual-grading/portfolio/${portfolioId}/save`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    submitToHead: (assignmentId) =>
      request(`/api/manual-grading/assignment/${assignmentId}/submit-to-head`, { method: 'POST' }),
    publishToStudents: (assignmentId) =>
      request(`/api/manual-grading/assignment/${assignmentId}/publish-to-students`, { method: 'POST' }),
  },

  notifications: {
    sendDeadlineReminders: () =>
      request('/api/notifications/send-deadline-reminders', { method: 'POST' }),
  },

  // /api/student
  student: {
    dashboard: () => request('/api/student/dashboard'),
    result: (assignmentId) => request(`/api/student/results/${assignmentId}`),
    assignmentRequirements: (assignmentId) => request(`/api/student/assignments/${assignmentId}/requirements`),
    submission: (assignmentId) => request(`/api/student/assignments/${assignmentId}/submission`),
    saveSubmission: (assignmentId, payload) =>
      request(`/api/student/assignments/${assignmentId}/submission`, {
        method: 'POST',
        body: payload,
      }),
    updateSubmission: (assignmentId, payload) =>
      request(`/api/student/assignments/${assignmentId}/submission`, {
        method: 'PUT',
        body: payload,
      }),
    removeSubmissionFile: (fileId) => request(`/api/student/submission-files/${fileId}`, { method: 'DELETE' }),
    openSubmissionFile: (fileId) => openAuthorizedFile(`/api/student/submission-files/${fileId}/view`),
    feedbackAttempts: (assignmentId) => request(`/api/student/feedback/attempts/${assignmentId}`),
    feedbackHistory: (assignmentId) => request(`/api/student/feedback/history/${assignmentId}`),
    requestFeedback: (assignmentId) =>
      request('/api/student/feedback', {
        method: 'POST',
        body: JSON.stringify({ assignment_id: assignmentId }),
      }),
  },

  // /api/auth/users  (admin only)
  users: {
    list:   ()         => request('/api/auth/users'),
    create: (payload)  => request('/api/auth/users', { method: 'POST', body: JSON.stringify(payload) }),
    // Backend: PUT /api/auth/users/:id  accepts { display_name, role }
    update: (id, payload) => request(`/api/auth/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    remove: (id)       => request(`/api/auth/users/${id}`, { method: 'DELETE' }),
  },
};
