import { useEffect, useRef, useState } from 'react';
import { api } from '../api/api';

const DEPARTMENT_FALLBACK = ['Medicine', 'Surgery', 'Pediatrics', 'Obstetrics', 'Community Medicine'];

function cleanParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value));
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map(row => row?.[key]).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
}

function fileNameFromPath(value) {
  return value ? String(value).split('/').pop() : '';
}

export default function UploadPortfolio() {
  const [courses, setCourses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [batches, setBatches] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [selCourse, setSelCourse] = useState('');
  const [selDepartment, setSelDepartment] = useState('');
  const [selBatch, setSelBatch] = useState('');
  const [selAssignment, setSelAssignment] = useState('');
  const [studentNo, setStudentNo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileRef = useRef();

  useEffect(() => {
    api.courses.list()
      .then(d => setCourses(d.courses || []))
      .catch(err => setError(err.message));
  }, []);

  const loadSubmissions = async (assignmentId) => {
    if (!assignmentId) {
      setSubmissions([]);
      return;
    }

    try {
      const data = await api.portfolios.list({ assignment_id: assignmentId });
      setSubmissions(data.portfolios || []);
    } catch {
      setSubmissions([]);
    }
  };

  const onCourseChange = async (courseName) => {
    setSelCourse(courseName);
    setSelDepartment('');
    setSelBatch('');
    setSelAssignment('');
    setAssignments([]);
    setSubmissions([]);
    setDepartments([]);
    setBatches([]);

    if (!courseName) return;

    try {
      const [departmentData, batchData] = await Promise.all([
        api.departments.list({ course_name: courseName }),
        api.batches.list({ course_name: courseName }),
      ]);
      const loadedDepartments = departmentData.departments || [];
      setDepartments(loadedDepartments.length ? loadedDepartments : DEPARTMENT_FALLBACK);
      setBatches(batchData.batches || []);
    } catch (err) {
      setDepartments(DEPARTMENT_FALLBACK);
      setBatches([]);
      setError(err.message);
    }
  };

  const onDepartmentChange = async (department) => {
    setSelDepartment(department);
    setSelBatch('');
    setSelAssignment('');
    setAssignments([]);
    setSubmissions([]);

    if (!selCourse) return;

    try {
      const data = await api.assignments.list(cleanParams({ course_name: selCourse, department }));
      setBatches(uniqueValues(data.assignments || [], 'batch'));
    } catch {
      setBatches([]);
    }
  };

  const onBatchChange = async (batch) => {
    setSelBatch(batch);
    setSelAssignment('');
    setSubmissions([]);

    if (batch && selCourse) {
      try {
        const data = await api.assignments.list(cleanParams({
          course_name: selCourse,
          department: selDepartment,
          batch,
        }));
        setAssignments(data.assignments || []);
      } catch {
        setAssignments([]);
      }
    } else {
      setAssignments([]);
    }
  };

  const onAssignmentChange = async (assignmentId) => {
    setSelAssignment(assignmentId);
    await loadSubmissions(assignmentId);
  };

  const handleUpload = async () => {
    const files = Array.from(fileRef.current?.files || []);
    if (!selAssignment) {
      setError('Select an assignment first.');
      return;
    }
    if (!studentNo.trim()) {
      setError('Enter the student number.');
      return;
    }
    if (!files.length) {
      setError('Choose one or more files to upload.');
      return;
    }

    setError('');
    setSaving(true);
    try {
      await api.portfolios.upload({
        student_no: studentNo.trim(),
        assignment_id: selAssignment,
        files,
      });
      await loadSubmissions(selAssignment);
      setSuccess('Portfolio uploaded successfully.');
      fileRef.current.value = '';
      setStudentNo('');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenPortfolio = async (submission) => {
    setError('');
    try {
      if (submission.primary_file_id) {
        await api.portfolios.openFile(submission.primary_file_id);
      } else if (submission.portfolio_link) {
        window.open(submission.portfolio_link, '_blank', 'noopener,noreferrer');
      } else {
        setError('No file is available for this portfolio.');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (portfolioId) => {
    if (!window.confirm('Delete this portfolio?')) return;
    setError('');
    try {
      await api.portfolios.remove(portfolioId);
      setSubmissions(prev => prev.filter(row => row.portfolio_id !== portfolioId));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <h1 className="page-title">Upload Portfolio</h1>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="content-card">
        <div className="form-row">
          <label className="form-label">Course:</label>
          <select className="form-select" value={selCourse} onChange={e => onCourseChange(e.target.value)}>
            <option value="">Select Course</option>
            {courses.map(course => <option key={course} value={course}>{course}</option>)}
          </select>

          <label className="form-label">Department:</label>
          <select
            className="form-select"
            value={selDepartment}
            onChange={e => onDepartmentChange(e.target.value)}
            disabled={!selCourse}
          >
            <option value="">Select Department</option>
            {departments.map(department => (
              <option key={department} value={department}>{department}</option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Batch:</label>
          <select
            className="form-select"
            value={selBatch}
            onChange={e => onBatchChange(e.target.value)}
            disabled={!selCourse}
          >
            <option value="">Select Batch</option>
            {batches.map(batch => <option key={batch} value={batch}>{batch}</option>)}
          </select>

          <label className="form-label">Assignment:</label>
          <select
            className="form-select"
            value={selAssignment}
            onChange={e => onAssignmentChange(e.target.value)}
            disabled={!selBatch}
          >
            <option value="">Select Assignment</option>
            {assignments.map(assignment => (
              <option key={assignment.assignment_id} value={assignment.assignment_id}>
                {assignment.assignment_name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Student No:</label>
          <input
            className="form-input"
            placeholder="e.g. ME/2020/001"
            value={studentNo}
            onChange={e => setStudentNo(e.target.value)}
            style={{ maxWidth: 260 }}
          />
        </div>

        <div className="form-row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <label className="form-label">Files:</label>
          <input
            type="file"
            ref={fileRef}
            multiple
            accept=".pdf,.doc,.docx,.zip,.xlsx,.xls,.csv,.png,.jpg,.jpeg"
            style={{ flex: 1, minWidth: 220 }}
          />
          <button className="btn btn-primary" onClick={handleUpload} disabled={saving}>
            {saving ? 'Uploading...' : 'Upload Portfolio'}
          </button>
        </div>

        <div className="table-container">
          <table className="data-table" style={{ minWidth: 850 }}>
            <thead>
              <tr>
                <th>Student Number</th>
                <th>File</th>
                <th>File Count</th>
                <th>Uploaded</th>
                <th>Status</th>
                <th>View</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              {submissions.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: '#999', padding: '32px' }}>
                    {selAssignment ? 'No submissions yet.' : 'Select an assignment to see submissions.'}
                  </td>
                </tr>
              ) : submissions.map(submission => (
                <tr key={submission.portfolio_id}>
                  <td>{submission.student_no}</td>
                  <td style={{ fontSize: 12, color: '#555' }}>
                    {submission.primary_file_name || fileNameFromPath(submission.portfolio_link) || '-'}
                  </td>
                  <td>{submission.active_file_count || (submission.portfolio_link ? 1 : 0)}</td>
                  <td>{submission.upload_date ? new Date(submission.upload_date).toLocaleDateString() : '-'}</td>
                  <td>{submission.submission_status || 'SUBMITTED'}</td>
                  <td>
                    {(submission.primary_file_id || submission.portfolio_link) ? (
                      <button className="btn btn-info btn-sm" onClick={() => handleOpenPortfolio(submission)}>
                        View
                      </button>
                    ) : (
                      <span style={{ color: '#6c757d' }}>No file</span>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(submission.portfolio_id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
