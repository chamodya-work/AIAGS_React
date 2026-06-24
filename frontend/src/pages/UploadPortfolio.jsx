import { useEffect, useState } from 'react';
import { api } from '../api/api';
import { COURSE_OPTIONS, getBatchOptionsForCourse } from '../utils/courseBatches';

const ACCEPT_BY_TYPE = {
  pdf: '.pdf',
  docx: '.docx',
  pdf_or_docx: '.pdf,.docx',
  image: '.jpg,.jpeg,.png,.gif,.webp',
  excel: '.xlsx,.xls,.csv',
  any_supported_document: '.pdf,.docx,.jpg,.jpeg,.png,.gif,.webp,.xlsx,.xls,.csv',
};

function cleanParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value));
}

function fileNameFromPath(value) {
  return value ? String(value).split('/').pop() : '';
}

function formatDateTime(dateValue, timeValue) {
  if (!dateValue) return '-';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '-';
  const dateText = date.toLocaleDateString();
  return timeValue ? `${dateText} ${String(timeValue).slice(0, 5)}` : dateText;
}

function typeLabel(value) {
  return String(value || 'pdf_or_docx').replaceAll('_', ' ');
}

function buildGroups(submission) {
  if (!submission) return [];
  if (submission.groups?.length) return submission.groups;
  return [
    {
      requirement: {
        id: null,
        document_name: 'Assignment Submission',
        allowed_file_type: 'pdf_or_docx',
        is_mandatory: true,
        is_ai_gradable: false,
      },
      files: [],
    },
  ];
}

function clearLoadedFiles(submission) {
  if (!submission) return submission;
  return {
    ...submission,
    student_no: null,
    portfolio: {
      ...submission.portfolio,
      portfolio_id: null,
      upload_date: null,
      is_complete: false,
    },
    files: [],
    groups: (submission.groups || []).map((group) => ({ ...group, files: [] })),
  };
}

export default function UploadPortfolio() {
  const [courses, setCourses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [selCourse, setSelCourse] = useState('');
  const [selBatch, setSelBatch] = useState('');
  const [selAssignment, setSelAssignment] = useState('');
  const [studentNo, setStudentNo] = useState('');
  const [submission, setSubmission] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState({});
  const [inputVersion, setInputVersion] = useState(0);
  const [loadingSubmission, setLoadingSubmission] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setCourses(COURSE_OPTIONS);
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

  const loadAdminSubmission = async (assignmentId = selAssignment, studentNoValue = studentNo) => {
    if (!assignmentId) {
      setSubmission(null);
      return;
    }

    setError('');
    setLoadingSubmission(true);
    try {
      const data = await api.portfolios.adminSubmission({
        assignment_id: assignmentId,
        student_no: studentNoValue.trim(),
      });
      setSubmission(data);
      setSelectedFiles({});
      setInputVersion(v => v + 1);
    } catch (err) {
      setSubmission(null);
      setError(err.message);
    } finally {
      setLoadingSubmission(false);
    }
  };

  const onCourseChange = async (courseName) => {
    setSelCourse(courseName);
    setSelBatch('');
    setSelAssignment('');
    setAssignments([]);
    setSubmissions([]);
    setSubmission(null);
    setBatches(courseName ? getBatchOptionsForCourse(courseName) : []);
  };

  const onBatchChange = async (batch) => {
    setSelBatch(batch);
    setSelAssignment('');
    setSubmission(null);
    setSubmissions([]);

    if (batch && selCourse) {
      try {
        const data = await api.assignments.list(cleanParams({
          course_name: selCourse,
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
    setSubmission(null);
    setSelectedFiles({});
    setInputVersion(v => v + 1);
    await loadSubmissions(assignmentId);
    if (assignmentId) await loadAdminSubmission(assignmentId, studentNo);
  };

  const handleFilesChange = (requirementId, files) => {
    const key = requirementId ?? 'general';
    setSelectedFiles(prev => ({ ...prev, [key]: Array.from(files || []) }));
  };

  const selectedAssignment = submission?.assignment || assignments.find(a => String(a.assignment_id) === String(selAssignment));
  const groups = buildGroups(submission);
  const hasSelectedFiles = Object.values(selectedFiles).some(files => files?.length);

  const missingMandatoryAfterSelection = groups
    .filter((group) => group.requirement.is_mandatory)
    .filter((group) => {
      const key = group.requirement.id ?? 'general';
      return !group.files?.length && !selectedFiles[key]?.length;
    })
    .map((group) => group.requirement.document_name);

  const handleUpload = async () => {
    if (!selAssignment) {
      setError('Select an assignment first.');
      return;
    }
    if (!studentNo.trim()) {
      setError('Please enter Student No before saving the portfolio.');
      return;
    }
    if (!submission) {
      setError('Load the student submission sections before saving.');
      return;
    }
    if (!hasSelectedFiles) {
      setError('Choose at least one new file to upload.');
      return;
    }
    if (missingMandatoryAfterSelection.length) {
      setError(`Missing mandatory document(s): ${missingMandatoryAfterSelection.join(', ')}`);
      return;
    }

    setError('');
    setSaving(true);
    try {
      const data = await api.portfolios.upload({
        student_no: studentNo.trim(),
        assignment_id: selAssignment,
        filesByRequirement: selectedFiles,
      });
      setSubmission(data.submission || null);
      setSelectedFiles({});
      setInputVersion(v => v + 1);
      await loadSubmissions(selAssignment);
      setSuccess('Portfolio saved successfully.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenPortfolio = async (submissionRow) => {
    setError('');
    try {
      if (submissionRow.primary_file_id) {
        await api.portfolios.openFile(submissionRow.primary_file_id);
      } else if (submissionRow.portfolio_link) {
        window.open(submissionRow.portfolio_link, '_blank', 'noopener,noreferrer');
      } else {
        setError('No file is available for this portfolio.');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleOpenFile = async (fileId) => {
    setError('');
    try {
      await api.portfolios.openFile(fileId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleOpenGuideline = async () => {
    if (!selAssignment) return;
    setError('');
    try {
      await api.assignments.openGuideline(selAssignment);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRemoveFile = async (fileId) => {
    if (!window.confirm('Remove this uploaded file?')) return;
    setError('');
    try {
      const data = await api.portfolios.removeFile(fileId);
      setSubmission(data.submission || null);
      await loadSubmissions(selAssignment);
      setSuccess('File removed.');
      setTimeout(() => setSuccess(''), 3000);
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
      if (submission?.portfolio?.portfolio_id === portfolioId) setSubmission(null);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <h1 className="page-title">Upload Portfolio</h1>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="content-card admin-upload-card">
        <div className="form-row">
          <label className="form-label">Course:</label>
          <select className="form-select" value={selCourse} onChange={e => onCourseChange(e.target.value)}>
            <option value="">Select Course</option>
            {courses.map(course => <option key={course} value={course}>{course}</option>)}
          </select>

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

        <div className="form-row admin-student-load-row">
          <label className="form-label">Student No:</label>
          <input
            className="form-input"
            placeholder="e.g. ME/2020/001"
            value={studentNo}
            onChange={e => {
              setStudentNo(e.target.value);
              setSubmission(prev => clearLoadedFiles(prev));
            }}
            onBlur={() => loadAdminSubmission()}
            style={{ maxWidth: 260 }}
          />
          <button className="btn btn-secondary btn-sm" onClick={() => loadAdminSubmission()} disabled={!selAssignment}>
            {studentNo.trim() ? 'Load Student Files' : 'Load Sections'}
          </button>
        </div>

        {selectedAssignment && (
          <div className="submission-assignment-panel">
            <div>
              <span>Assignment</span>
              <strong>{selectedAssignment.assignment_name}</strong>
            </div>
            <div>
              <span>Course</span>
              <strong>{selectedAssignment.course_name || '-'}</strong>
            </div>
            <div>
              <span>Batch</span>
              <strong>{selectedAssignment.batch || '-'}</strong>
            </div>
            <div>
              <span>Due</span>
              <strong>{formatDateTime(selectedAssignment.deadline_date, selectedAssignment.deadline_time)}</strong>
            </div>
            {selectedAssignment.has_guideline && (
              <button className="btn btn-info btn-sm" onClick={handleOpenGuideline}>
                View Guideline
              </button>
            )}
          </div>
        )}

        {loadingSubmission ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : submission ? (
          <>
            <div className={`alert ${submission.portfolio.is_complete ? 'alert-success' : 'alert-warning'}`}>
              Upload status: {submission.portfolio.is_complete ? 'Complete' : 'Incomplete'}
              {!submission.portfolio.is_complete && submission.portfolio.missing_mandatory_documents?.length > 0 && (
                <span> - Missing: {submission.portfolio.missing_mandatory_documents.join(', ')}</span>
              )}
            </div>

            <div className="submission-groups">
              {groups.map((group, index) => {
                const requirementId = group.requirement.id;
                const selectedKey = requirementId ?? 'general';
                const accept = ACCEPT_BY_TYPE[group.requirement.allowed_file_type] || ACCEPT_BY_TYPE.pdf_or_docx;
                const supportsAi = ['pdf', 'docx', 'pdf_or_docx', 'any_supported_document'].includes(group.requirement.allowed_file_type);

                return (
                  <div className="submission-group" key={requirementId || `general-${index}`}>
                    <div className="submission-group-header">
                      <div>
                        <strong>{group.requirement.document_name}</strong>
                        <span>Allowed: {typeLabel(group.requirement.allowed_file_type)}</span>
                      </div>
                      <div className="submission-badge-row">
                        {group.requirement.is_ai_gradable && (
                          <span className="badge badge-success">Main Answer for AI Grading</span>
                        )}
                        <span className={`badge ${group.requirement.is_mandatory ? 'badge-danger' : 'badge-info'}`}>
                          {group.requirement.is_mandatory ? 'Mandatory' : 'Optional'}
                        </span>
                      </div>
                    </div>

                    {!supportsAi && (
                      <div className="submission-note">
                        This file type can be stored for submission evidence. AI grading uses PDF/DOCX files only.
                      </div>
                    )}

                    {group.files.length > 0 ? (
                      <div className="submission-file-list">
                        {group.files.map(file => (
                          <div className="submission-file-row" key={file.file_id}>
                            <span>{file.original_name}</span>
                            <div>
                              <button className="btn btn-info btn-sm" onClick={() => handleOpenFile(file.file_id)}>View</button>
                              <button className="btn btn-danger btn-sm" onClick={() => handleRemoveFile(file.file_id)}>
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="submission-empty">No file uploaded for this section.</div>
                    )}

                    <div className="submission-file-input">
                      <input
                        key={`${inputVersion}-${selectedKey}`}
                        type="file"
                        multiple
                        accept={accept}
                        onChange={e => handleFilesChange(requirementId, e.target.files)}
                      />
                      {selectedFiles[selectedKey]?.length > 0 && (
                        <span>{selectedFiles[selectedKey].length} file(s) selected</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="action-row">
              <button className="btn btn-primary" onClick={handleUpload} disabled={saving}>
                {saving ? 'Saving...' : 'SAVE PORTFOLIO'}
              </button>
            </div>
          </>
        ) : (
          <div className="feedback-empty">
            Select an assignment, enter the student number, then load the required document sections.
          </div>
        )}

        <div className="table-container">
          <table className="data-table" style={{ minWidth: 850 }}>
            <thead>
              <tr>
                <th>Student Number</th>
                <th>Primary File</th>
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
              ) : submissions.map(submissionRow => (
                <tr key={submissionRow.portfolio_id}>
                  <td>{submissionRow.student_no}</td>
                  <td style={{ fontSize: 12, color: '#555' }}>
                    {submissionRow.primary_file_name || fileNameFromPath(submissionRow.portfolio_link) || '-'}
                  </td>
                  <td>{submissionRow.active_file_count || (submissionRow.portfolio_link ? 1 : 0)}</td>
                  <td>{submissionRow.upload_date ? new Date(submissionRow.upload_date).toLocaleDateString() : '-'}</td>
                  <td>{submissionRow.submission_status || 'SUBMITTED'}</td>
                  <td>
                    {(submissionRow.primary_file_id || submissionRow.portfolio_link) ? (
                      <button className="btn btn-info btn-sm" onClick={() => handleOpenPortfolio(submissionRow)}>
                        View
                      </button>
                    ) : (
                      <span style={{ color: '#6c757d' }}>No file</span>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(submissionRow.portfolio_id)}>
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
