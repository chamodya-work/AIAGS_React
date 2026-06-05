import { useState, useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { api } from '../api/api';
import { useAuth } from '../components/AuthContext';

const ACCEPT_BY_TYPE = {
  pdf: '.pdf',
  docx: '.docx',
  pdf_or_docx: '.pdf,.docx',
  image: '.jpg,.jpeg,.png,.gif,.webp',
  excel: '.xlsx,.xls,.csv',
  any_supported_document: '.pdf,.docx,.jpg,.jpeg,.png,.gif,.webp,.xlsx,.xls,.csv',
};

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
      },
      files: [],
    },
  ];
}

export default function UploadAssignment() {
  const { user } = useAuth();
  const location = useLocation();
  const { assignmentId } = useParams();
  const initialAssignment = assignmentId || location.state?.assignment_id || '';
  const isEditRoute = Boolean(assignmentId);
  const [assignments, setAssignments] = useState([]);
  const [selAssignment, setSelAssignment] = useState(initialAssignment);
  const [submission, setSubmission] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState({});
  const [inputVersion, setInputVersion] = useState(0);
  const [loadingSubmission, setLoadingSubmission] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.assignments.list()
      .then(d => setAssignments(d.assignments || []))
      .catch(err => setError(err.message));
  }, []);

  useEffect(() => {
    if (selAssignment) {
      loadSubmission(selAssignment);
    } else {
      setSubmission(null);
    }
  }, [selAssignment]);

  const getStudentNo = () => {
    return user?.student_no || user?.stdNo || user?.email || '';
  };

  const loadSubmission = async (id) => {
    setError('');
    setLoadingSubmission(true);
    try {
      const data = await api.student.submission(id);
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

  const handleFilesChange = (requirementId, files) => {
    const key = requirementId ?? 'general';
    setSelectedFiles(prev => ({ ...prev, [key]: Array.from(files || []) }));
  };

  const hasSelectedFiles = Object.values(selectedFiles).some(files => files?.length);

  const handleSubmit = async () => {
    if (!selAssignment) { setError('Select an assignment first.'); return; }
    if (!hasSelectedFiles && !submission?.files?.length) { setError('Choose at least one file to upload.'); return; }

    const fd = new FormData();
    for (const [key, files] of Object.entries(selectedFiles)) {
      const fieldName = key === 'general' ? 'files_general' : `files_${key}`;
      (files || []).forEach(file => fd.append(fieldName, file));
    }

    setError('');
    setSuccess('');
    setUploading(true);
    try {
      const data = submission?.portfolio?.portfolio_id
        ? await api.student.updateSubmission(selAssignment, fd)
        : await api.student.saveSubmission(selAssignment, fd);
      setSubmission(data);
      setSelectedFiles({});
      setInputVersion(v => v + 1);
      setSuccess('Submission saved successfully.');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
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

  const handleOpenFile = async (fileId) => {
    setError('');
    try {
      await api.student.openSubmissionFile(fileId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRemoveFile = async (fileId) => {
    if (!window.confirm('Remove this uploaded file?')) return;
    setError('');
    try {
      const data = await api.student.removeSubmissionFile(fileId);
      setSubmission(data.submission);
      setSuccess('File removed.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    }
  };

  const selectedAssignment = submission?.assignment || assignments.find(a => String(a.assignment_id) === String(selAssignment));
  const groups = buildGroups(submission);

  return (
    <>
      <h1 className="page-title">{isEditRoute ? 'Edit Submission' : 'Upload Assignment'}</h1>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="content-card submission-editor-card">
        <div className="student-upload-bar">
          Submitting as: <strong>{getStudentNo() || user?.email || '-'}</strong>
        </div>

        {!isEditRoute && (
          <div className="form-row">
            <label className="form-label">Assignment:</label>
            <select className="form-select" value={selAssignment}
              onChange={e => setSelAssignment(e.target.value)}>
              <option value="">Select Assignment</option>
              {assignments.map(a => (
                <option key={a.assignment_id} value={a.assignment_id}>
                  {a.assignment_name} - {a.batch} ({a.course_name})
                </option>
              ))}
            </select>
          </div>
        )}

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
                      <span className={`badge ${group.requirement.is_mandatory ? 'badge-danger' : 'badge-info'}`}>
                        {group.requirement.is_mandatory ? 'Mandatory' : 'Optional'}
                      </span>
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
                              <button className="btn btn-danger btn-sm" onClick={() => handleRemoveFile(file.file_id)}>Remove</button>
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
              <button className="btn btn-primary" onClick={handleSubmit} disabled={uploading}>
                {uploading ? 'Saving...' : 'SAVE SUBMISSION'}
              </button>
            </div>
          </>
        ) : (
          <div className="feedback-empty">Select an assignment to see required documents.</div>
        )}
      </div>
    </>
  );
}
