import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/api';

const STATUS_BADGE = {
  SUBMITTED: 'badge-success',
  INCOMPLETE: 'badge-warning',
  PENDING: 'badge-warning',
  OVERDUE: 'badge-danger',
};

function formatDateTime(dateValue, timeValue) {
  if (!dateValue) return '-';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '-';
  const dateText = date.toLocaleDateString();
  return timeValue ? `${dateText} ${String(timeValue).slice(0, 5)}` : dateText;
}

function RequiredBadge({ mandatory }) {
  return (
    <span className={`badge ${mandatory ? 'badge-danger' : 'badge-info'}`}>
      {mandatory ? 'Mandatory' : 'Optional'}
    </span>
  );
}

export default function StudentHome() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewLoading, setViewLoading] = useState(false);
  const [viewSubmission, setViewSubmission] = useState(null);

  useEffect(() => {
    api.student.dashboard()
      .then(d => setData(d))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const assignments = data?.assignments || [];
  const filtered = filterStatus
    ? assignments.filter(a => a.status === filterStatus)
    : assignments;

  const summary = data?.summary || {};
  const student = data?.student || {};

  const handleViewSubmission = async (assignmentId) => {
    setError('');
    setViewLoading(true);
    try {
      const submission = await api.student.submission(assignmentId);
      setViewSubmission(submission);
    } catch (err) {
      setError(err.message);
    } finally {
      setViewLoading(false);
    }
  };

  const handleOpenGuideline = async (assignmentId) => {
    setError('');
    try {
      await api.assignments.openGuideline(assignmentId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleOpenFile = async (fileId) => {
    setError('');
    try {
      await api.student.openSubmissionFile(fileId);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <h1 className="page-title">My Assignments</h1>
      {error && <div className="alert alert-error">{error}</div>}

      {student.student_no && (
        <div className="student-summary-card">
          <div><span>Student No</span><strong>{student.student_no}</strong></div>
          <div><span>Batch</span><strong>{student.batch || '-'}</strong></div>
          <div><span>Course</span><strong>{student.course_name || '-'}</strong></div>
          <div className="student-summary-stats">
            <div><strong style={{ color: '#27ae60' }}>{summary.submitted || 0}</strong><span>Submitted</span></div>
            <div><strong style={{ color: '#f39c12' }}>{summary.incomplete || 0}</strong><span>Incomplete</span></div>
            <div><strong style={{ color: '#f39c12' }}>{summary.pending || 0}</strong><span>Pending</span></div>
            <div><strong style={{ color: '#e74c3c' }}>{summary.overdue || 0}</strong><span>Overdue</span></div>
          </div>
        </div>
      )}

      <div className="content-card">
        <div className="filters-section">
          <div className="filter-group">
            <label className="filter-label">Filter by Status</label>
            <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Status</option>
              <option value="PENDING">Pending</option>
              <option value="INCOMPLETE">Incomplete</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="OVERDUE">Overdue</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : (
          <div className="table-container">
            <table className="data-table student-assignments-table">
              <thead>
                <tr>
                  <th>Assignment</th>
                  <th>Course</th>
                  <th>Batch</th>
                  <th>Due Date/Time</th>
                  <th>Status</th>
                  <th>View</th>
                  <th>Edit</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: '#999', padding: '40px' }}>No assignments found.</td></tr>
                ) : filtered.map(a => (
                  <tr key={a.assignment_id}>
                    <td>{a.assignment_name}</td>
                    <td>{a.course_name}</td>
                    <td>{a.batch}</td>
                    <td>{formatDateTime(a.deadline_date, a.deadline_time)}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[a.status] || 'badge-warning'}`}>
                        {a.status}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-info btn-sm"
                        onClick={() => handleViewSubmission(a.assignment_id)}
                        disabled={viewLoading}
                      >
                        View
                      </button>
                    </td>
                    <td>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => navigate(`/student/submission/${a.assignment_id}/edit`)}
                      >
                        {a.has_submission ? 'Edit' : 'Upload'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewSubmission && (
        <div className="modal-backdrop" onClick={() => setViewSubmission(null)}>
          <div className="modal submission-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Submission Details</h3>
              <button className="modal-close" onClick={() => setViewSubmission(null)}>x</button>
            </div>

            <div className="submission-meta">
              <div><span>Assignment</span><strong>{viewSubmission.assignment.assignment_name}</strong></div>
              <div><span>Course</span><strong>{viewSubmission.assignment.course_name || '-'}</strong></div>
              <div><span>Batch</span><strong>{viewSubmission.assignment.batch || '-'}</strong></div>
              <div><span>Due</span><strong>{formatDateTime(viewSubmission.assignment.deadline_date, viewSubmission.assignment.deadline_time)}</strong></div>
            </div>

            {viewSubmission.assignment.has_guideline && (
              <button className="btn btn-info btn-sm" onClick={() => handleOpenGuideline(viewSubmission.assignment.assignment_id)}>
                View Guideline
              </button>
            )}

            <div className={`alert ${viewSubmission.portfolio.is_complete ? 'alert-success' : 'alert-warning'}`} style={{ marginTop: 14 }}>
              Upload status: {viewSubmission.portfolio.is_complete ? 'Complete' : 'Incomplete'}
              {!viewSubmission.portfolio.is_complete && viewSubmission.portfolio.missing_mandatory_documents?.length > 0 && (
                <span> - Missing: {viewSubmission.portfolio.missing_mandatory_documents.join(', ')}</span>
              )}
            </div>

            <div className="submission-groups">
              {(viewSubmission.groups || []).map((group, index) => (
                <div className="submission-group" key={group.requirement.id || `general-${index}`}>
                  <div className="submission-group-header">
                    <div>
                      <strong>{group.requirement.document_name}</strong>
                      <span>{String(group.requirement.allowed_file_type || '').replaceAll('_', ' ')}</span>
                    </div>
                    <RequiredBadge mandatory={group.requirement.is_mandatory} />
                  </div>

                  {group.files.length === 0 ? (
                    <div className="submission-empty">No file uploaded.</div>
                  ) : (
                    <div className="submission-file-list">
                      {group.files.map(file => (
                        <div className="submission-file-row" key={file.file_id}>
                          <span>{file.original_name}</span>
                          <button className="btn btn-info btn-sm" onClick={() => handleOpenFile(file.file_id)}>View</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
