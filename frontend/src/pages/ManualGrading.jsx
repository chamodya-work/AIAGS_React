import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../api/api';
import { useAuth } from '../components/AuthContext';
import { normalizeRole } from '../utils/roles';
import { COURSE_OPTIONS, getAllBatchOptions, getBatchOptionsForCourse, normalizeCourseName } from '../utils/courseBatches';

const AI_STATUS_BADGE = {
  pending: 'badge-warning',
  processing: 'badge-info',
  graded: 'badge-success',
  failed: 'badge-danger',
};

const PUBLISH_STATUS_LABEL = {
  draft: 'Draft',
  submitted_to_head: 'Submitted to Head',
  published_to_student: 'Published to Student',
};

const PUBLISH_STATUS_BADGE = {
  draft: 'badge-warning',
  submitted_to_head: 'badge-info',
  published_to_student: 'badge-success',
};

const TABLE_COLUMN_COUNT = 11;

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString();
}

function hasLargeAiDifference(aiScore, manualScore) {
  if (aiScore == null || manualScore === '' || manualScore == null) return false;
  const ai = Number(aiScore);
  const manual = Number(manualScore);
  return Number.isFinite(ai) && Number.isFinite(manual) && Math.abs(ai - manual) > 20;
}

function hasViewablePortfolioFile(row) {
  if (row.primary_file_id) return true;
  return !row.main_answer_document_name && Boolean(row.portfolio_link);
}

export default function ManualGrading() {
  const { user } = useAuth();
  const role = normalizeRole(user?.role);
  const isAdmin = role === 'admin';

  const [assignments, setAssignments] = useState([]);
  const [results, setResults] = useState([]);
  const [filters, setFilters] = useState({
    course_name: '',
    batch: '',
    assignment_id: '',
  });
  const [manualScores, setManualScores] = useState({});
  const [remarks, setRemarks] = useState({});
  const [openReportId, setOpenReportId] = useState(null);
  const [reportsByPortfolio, setReportsByPortfolio] = useState({});
  const [reportErrorsByPortfolio, setReportErrorsByPortfolio] = useState({});
  const [reportLoadingByPortfolio, setReportLoadingByPortfolio] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingResults, setLoadingResults] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.assignments.list()
      .then(data => setAssignments(data.assignments || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const courses = COURSE_OPTIONS;
  const batches = useMemo(() => (
    filters.course_name ? getBatchOptionsForCourse(filters.course_name) : getAllBatchOptions()
  ), [filters.course_name]);

  const filteredAssignments = assignments.filter((assignment) => {
    if (filters.course_name && normalizeCourseName(assignment.course_name) !== filters.course_name) return false;
    if (filters.batch && assignment.batch !== filters.batch) return false;
    return true;
  });

  const resetResults = () => {
    setResults([]);
    setManualScores({});
    setRemarks({});
    setOpenReportId(null);
    setReportsByPortfolio({});
    setReportErrorsByPortfolio({});
    setReportLoadingByPortfolio({});
  };

  const loadResults = async (assignmentId) => {
    if (!assignmentId) {
      resetResults();
      return;
    }

    setLoadingResults(true);
    setError('');
    try {
      const data = await api.manualGrading.resultsByAssignment(assignmentId);
      const rows = data.results || [];
      setResults(rows);
      const nextScores = {};
      const nextRemarks = {};
      rows.forEach((row) => {
        nextScores[row.portfolio_id] = row.manual_score ?? row.teacher_score ?? '';
        nextRemarks[row.portfolio_id] = row.manual_remark || '';
      });
      setManualScores(nextScores);
      setRemarks(nextRemarks);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingResults(false);
    }
  };

  const updateFilter = (key, value) => {
    const next = { ...filters, [key]: value };
    if (key !== 'assignment_id') {
      next.assignment_id = '';
      resetResults();
    }
    if (key === 'course_name') next.batch = '';
    setFilters(next);
  };

  const handleAssignmentChange = async (assignmentId) => {
    setFilters(prev => ({ ...prev, assignment_id: assignmentId }));
    resetResults();
    await loadResults(assignmentId);
  };

  const handleOpenPortfolioFile = async (row) => {
    setError('');
    try {
      if (row.primary_file_id) {
        await api.portfolios.openFile(row.primary_file_id);
      } else if (!row.main_answer_document_name && row.portfolio_link) {
        window.open(row.portfolio_link, '_blank', 'noopener,noreferrer');
      } else {
        setError(row.main_answer_document_name
          ? 'No Main Answer Document file is available for this student.'
          : 'No viewable submission file is available for this student.');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleViewReport = async (portfolioId) => {
    if (openReportId === portfolioId) {
      setOpenReportId(null);
      return;
    }

    setOpenReportId(portfolioId);
    setError('');
    setReportErrorsByPortfolio(prev => ({ ...prev, [portfolioId]: '' }));

    if (reportsByPortfolio[portfolioId]) return;

    setReportLoadingByPortfolio(prev => ({ ...prev, [portfolioId]: true }));
    try {
      const data = await api.grading.report(portfolioId);
      setReportsByPortfolio(prev => ({ ...prev, [portfolioId]: data.report || null }));
    } catch (err) {
      setReportErrorsByPortfolio(prev => ({ ...prev, [portfolioId]: err.message }));
    } finally {
      setReportLoadingByPortfolio(prev => ({ ...prev, [portfolioId]: false }));
    }
  };

  const handleSave = async (row) => {
    const score = manualScores[row.portfolio_id];
    const scoreIsEmpty = score === '' || score == null;
    const scoreNumber = scoreIsEmpty ? null : Number(score);
    if (!scoreIsEmpty && (!Number.isFinite(scoreNumber) || scoreNumber < 0 || scoreNumber > 100)) {
      setError('Teacher/manual score must be between 0 and 100.');
      return;
    }

    const requiresWarning = scoreNumber != null && hasLargeAiDifference(row.ai_grade, scoreNumber);
    if (requiresWarning) {
      const confirmed = window.confirm('The teacher score differs from the AI score by more than 20 marks. Please confirm before saving.');
      if (!confirmed) return;
    }

    setError('');
    setSuccess('');
    setSavingId(row.portfolio_id);
    try {
      await api.manualGrading.save(row.portfolio_id, {
        manual_score: scoreNumber,
        manual_remark: remarks[row.portfolio_id] || '',
        confirm_large_difference: requiresWarning,
      });
      setSuccess('Manual grade saved.');
      await loadResults(filters.assignment_id);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  };

  const handlePublishAction = async () => {
    if (!filters.assignment_id) return;
    setPublishing(true);
    setError('');
    setSuccess('');
    try {
      const data = isAdmin
        ? await api.manualGrading.publishToStudents(filters.assignment_id)
        : await api.manualGrading.submitToHead(filters.assignment_id);
      await loadResults(filters.assignment_id);
      setSuccess(isAdmin
        ? `Published grades to students. Count: ${data.published_count || 0}.`
        : `Submitted grades to head. Count: ${data.submitted_count || 0}.`);
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  };

  const handleDownloadExcel = async () => {
    if (!filters.assignment_id) {
      setError('Select an assignment before downloading Excel.');
      return;
    }

    setExporting(true);
    setError('');
    try {
      await api.manualGrading.downloadExcel(filters.assignment_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const hasPublishableGrades = results.some((row) => {
    const score = row.manual_score ?? row.teacher_score ?? row.final_grade;
    return score != null
      && !row.manual_draft_hidden
      && (
        row.publish_status === 'submitted_to_head'
        || row.publish_status === 'published_to_student'
        || row.saved_by_role === 'admin'
      );
  });
  const publishDisabled = publishing
    || !filters.assignment_id
    || results.length === 0
    || (isAdmin && !hasPublishableGrades);

  return (
    <>
      <h1 className="page-title">Manual Grading</h1>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="content-card manual-grading-card">
        <div className="filters-section">
          <div className="filter-group">
            <label className="filter-label">Course</label>
            <select className="filter-select" value={filters.course_name} onChange={e => updateFilter('course_name', e.target.value)}>
              <option value="">All Courses</option>
              {courses.map(course => <option key={course} value={course}>{course}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-label">Batch</label>
            <select className="filter-select" value={filters.batch} onChange={e => updateFilter('batch', e.target.value)}>
              <option value="">All Batches</option>
              {batches.map(batch => <option key={batch} value={batch}>{batch}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-label">Assignment</label>
            <select className="filter-select" value={filters.assignment_id} onChange={e => handleAssignmentChange(e.target.value)}>
              <option value="">Select Assignment</option>
              {filteredAssignments.map(assignment => (
                <option key={assignment.assignment_id} value={assignment.assignment_id}>
                  {assignment.assignment_name} ({assignment.batch})
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading || loadingResults ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : (
          <div className="table-container">
            <table className="data-table manual-grading-table">
              <thead>
                <tr>
                  <th>Student No</th>
                  <th>Uploaded Date</th>
                  <th>View Portfolio</th>
                  <th>AI Status</th>
                  {/* <th>AI Score</th> */}
                  <th>AI Report</th>
                  <th>Manual/Teacher Score</th>
                  <th>Lecturer Remark</th>
                  <th>Submitted By</th>
                  <th>Publish Status</th>
                  <th>Save</th>
                </tr>
              </thead>
              <tbody>
                {!filters.assignment_id ? (
                  <tr><td colSpan={TABLE_COLUMN_COUNT} style={{ textAlign: 'center', color: '#999', padding: '32px' }}>Select an assignment.</td></tr>
                ) : results.length === 0 ? (
                  <tr><td colSpan={TABLE_COLUMN_COUNT} style={{ textAlign: 'center', color: '#999', padding: '32px' }}>No submissions available.</td></tr>
                ) : results.map(row => {
                  const aiStatus = row.ai_status || 'pending';
                  const isReportOpen = openReportId === row.portfolio_id;
                  const isReportLoading = Boolean(reportLoadingByPortfolio[row.portfolio_id]);
                  const rowReport = reportsByPortfolio[row.portfolio_id];
                  const rowReportError = reportErrorsByPortfolio[row.portfolio_id];
                  const publishStatus = row.publish_status || 'draft';
                  const scoreWarning = hasLargeAiDifference(row.ai_grade, manualScores[row.portfolio_id]);
                  const draftHidden = isAdmin && row.manual_draft_hidden;
                  const saveDisabled = savingId === row.portfolio_id
                    || draftHidden
                    || (!isAdmin && publishStatus === 'published_to_student');

                  return (
                    <Fragment key={row.portfolio_id}>
                      <tr>
                        <td>{row.student_no}</td>
                        <td>{formatDate(row.upload_date)}</td>
                        <td>
                          {hasViewablePortfolioFile(row) ? (
                            <div className="grading-button-group">
                              <button className="btn btn-info btn-sm" onClick={() => handleOpenPortfolioFile(row)}>View</button>
                              {/* <span className="manual-view-file-name">
                                {row.ai_grading_file_names || row.main_answer_uploaded_files || row.primary_file_name || ''}
                              </span> */}
                            </div>
                          ) : '-'}
                        </td>
                        <td>
                          <span className={`badge ${AI_STATUS_BADGE[aiStatus] || 'badge-warning'}`}>
                            {aiStatus}
                          </span>
                        </td>
                        {/* <td>{row.ai_grade ?? '-'}</td> */}
                        <td>
                          {aiStatus === 'graded' ? (
                            <button className="btn btn-info btn-sm" onClick={() => handleViewReport(row.portfolio_id)}>
                              {isReportOpen ? 'Hide Report' : 'View Report'}
                            </button>
                          ) : '-'}
                        </td>
                        <td>
                          {draftHidden ? (
                            <span className="manual-not-submitted">{row.manual_remark_display || 'Not submitted by lecturer yet'}</span>
                          ) : (
                            <>
                              <input
                                className={`form-input manual-score-input${scoreWarning ? ' manual-score-warning' : ''}`}
                                type="number"
                                min="0"
                                max="100"
                                value={manualScores[row.portfolio_id] ?? ''}
                                onChange={e => setManualScores(prev => ({ ...prev, [row.portfolio_id]: e.target.value }))}
                              />
                              {scoreWarning && <div className="manual-warning-text">Differs from AI by more than 20.</div>}
                            </>
                          )}
                        </td>
                        <td>
                          {draftHidden ? (
                            <span className="manual-not-submitted">{row.manual_remark_display || 'Not submitted by lecturer yet'}</span>
                          ) : (
                            <>
                              <textarea
                                className="form-input manual-remark-input"
                                value={remarks[row.portfolio_id] ?? ''}
                                onChange={e => setRemarks(prev => ({ ...prev, [row.portfolio_id]: e.target.value }))}
                                aria-label="Lecturer Remark / Manual Review Note"
                                placeholder="Example: AI detected, Turnitin checked, Needs manual review"
                              />
                              <div className="manual-remark-label">Lecturer Remark / Manual Review Note</div>
                              {row.manual_remark && (
                                <div className="manual-remark-saved">{row.manual_remark}</div>
                              )}
                            </>
                          )}
                        </td>
                        <td>
                          {row.saved_by_label ? (
                            <div className="manual-saved-by">
                              <strong>{row.saved_by_label}</strong>
                              {row.saved_at && <span>{new Date(row.saved_at).toLocaleString()}</span>}
                            </div>
                          ) : '-'}
                        </td>
                        <td>
                          <span className={`badge ${PUBLISH_STATUS_BADGE[publishStatus] || 'badge-warning'}`}>
                            {PUBLISH_STATUS_LABEL[publishStatus] || publishStatus}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn btn-success btn-sm"
                            onClick={() => handleSave(row)}
                            disabled={saveDisabled}
                            title={draftHidden ? 'Lecturer draft is not submitted to head yet' : saveDisabled && publishStatus === 'published_to_student' ? 'Published grades can only be changed by admin/head' : ''}
                          >
                            {savingId === row.portfolio_id ? 'Saving...' : 'Save'}
                          </button>
                        </td>
                      </tr>
                      {isReportOpen && (
                        <tr className="grading-report-row">
                          <td colSpan={TABLE_COLUMN_COUNT} className="grading-report-cell">
                            <div className="grading-report-panel">
                              <div className="grading-report-title">AI Assignment Evaluation Report</div>
                              {isReportLoading ? (
                                <div className="grading-report-state">Loading report...</div>
                              ) : rowReportError ? (
                                <div className="alert alert-error grading-inline-alert">{rowReportError}</div>
                              ) : rowReport ? (
                                <>
                                  <div className="grading-report-meta">
                                    <span>Student Number: <strong>{rowReport.student_no}</strong></span>
                                    {/* <span>AI Score: <strong>{rowReport.ai_grade ?? '-'}</strong></span> */}
                                    {/* <span>Model: <strong>{rowReport.ai_model || '-'}</strong></span> */}
                                  </div>
                                  <pre className="grading-report-text">{rowReport.ai_report_text}</pre>
                                </>
                              ) : (
                                <div className="grading-report-state">No report content available.</div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="action-row">
          <button
            className="btn btn-secondary"
            onClick={handleDownloadExcel}
            disabled={exporting || !filters.assignment_id}
          >
            {exporting ? 'Downloading...' : 'Download Excel'}
          </button>
          <button
            className="btn btn-primary"
            onClick={handlePublishAction}
            disabled={publishDisabled}
            title={isAdmin && !hasPublishableGrades ? 'No submitted manual grades are ready to publish.' : ''}
          >
            {publishing
              ? 'Processing...'
              : isAdmin
                ? 'Publish Grades to Students'
                : 'Submit Grades to Head'}
          </button>
        </div>
      </div>
    </>
  );
}
