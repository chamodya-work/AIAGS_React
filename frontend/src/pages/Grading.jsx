import { Fragment, useState, useEffect } from 'react';
import { api } from '../api/api';
import { useAuth } from '../components/AuthContext';
import { normalizeRole } from '../utils/roles';

const AI_STATUS_BADGE = {
  pending: 'badge-warning',
  processing: 'badge-info',
  graded: 'badge-success',
  failed: 'badge-danger',
};

const TABLE_COLUMN_COUNT = 10;

export default function GradingPage() {
  const { user } = useAuth();
  const isAdmin = normalizeRole(user?.role) === 'admin';
  const [courses, setCourses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [results, setResults] = useState([]);
  const [rubric, setRubric] = useState(null);
  const [selCourse, setSelCourse] = useState('');
  const [selBatch, setSelBatch] = useState('');
  const [selAssignment, setSelAssignment] = useState('');
  const [grading, setGrading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [finalScores, setFinalScores] = useState({});
  const [openReportId, setOpenReportId] = useState(null);
  const [reportsByPortfolio, setReportsByPortfolio] = useState({});
  const [reportErrorsByPortfolio, setReportErrorsByPortfolio] = useState({});
  const [reportLoadingByPortfolio, setReportLoadingByPortfolio] = useState({});
  const [pdfDownloading, setPdfDownloading] = useState(null);

  useEffect(() => {
    api.courses.list()
      .then(d => setCourses(d.courses || []))
      .catch(err => setError(err.message));
  }, []);

  const onCourseChange = async (cn) => {
    setSelCourse(cn); setSelBatch(''); setSelAssignment(''); setResults([]); setRubric(null); setOpenReportId(null); setReportsByPortfolio({}); setReportErrorsByPortfolio({}); setReportLoadingByPortfolio({});
    if (cn) {
      try { const d = await api.batches.list({ course_name: cn }); setBatches(d.batches || []); }
      catch { setBatches([]); }
    }
  };

  const onBatchChange = async (batch) => {
    setSelBatch(batch); setSelAssignment(''); setResults([]); setRubric(null); setOpenReportId(null); setReportsByPortfolio({}); setReportErrorsByPortfolio({}); setReportLoadingByPortfolio({});
    if (batch && selCourse) {
      try {
        const d = await api.assignments.list({ course_name: selCourse, batch });
        setAssignments(d.assignments || []);
      } catch { setAssignments([]); }
    }
  };

  const loadResults = async (aId) => {
    setLoading(true);
    try {
      const [res, rub] = await Promise.all([
        api.grading.resultsByAssignment(aId),
        api.rubrics.byAssignment(aId),
      ]);
      const rows = res.results || [];
      setResults(rows);
      const rList = rub.rubrics || [];
      setRubric(rList[0] || null);
      const scores = {};
      rows.forEach(r => { scores[r.portfolio_id] = r.final_grade ?? ''; });
      setFinalScores(scores);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const onAssignmentChange = async (aId) => {
    setSelAssignment(aId); setResults([]); setRubric(null); setFinalScores({}); setOpenReportId(null); setReportsByPortfolio({}); setReportErrorsByPortfolio({}); setReportLoadingByPortfolio({});
    if (aId) await loadResults(aId);
  };

  const handleGradeAll = async (forceRegrade = false) => {
    if (!selAssignment) { setError('Select an assignment first.'); return; }
    setError(''); setSuccess(''); setGrading(true); setOpenReportId(null); setReportsByPortfolio({}); setReportErrorsByPortfolio({}); setReportLoadingByPortfolio({});
    try {
      const data = await api.grading.gradeAssignmentAI(selAssignment, { forceRegrade });
      await loadResults(selAssignment);
      const failed = (data.results || []).filter(r => !r.ok).length;
      const graded = (data.results || []).filter(r => r.status === 'graded').length;
      setSuccess(`AI grading finished. Graded: ${graded}. Failed/skipped: ${failed}.`);
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) { setError(err.message); }
    finally { setGrading(false); }
  };

  const handleGradeOne = async (portfolioId, forceRegrade = false) => {
    setError(''); setSuccess(''); setOpenReportId(null); setReportsByPortfolio({}); setReportErrorsByPortfolio({}); setReportLoadingByPortfolio({});
    try {
      const data = await api.grading.gradePortfolioAI(portfolioId, { forceRegrade });
      await loadResults(selAssignment);
      setSuccess(data.result?.error || data.result?.message || 'AI grading updated.');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) { setError(err.message); }
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

  const handleDownloadReportPdf = async (portfolioId) => {
    setPdfDownloading(portfolioId);
    setError('');
    try {
      await api.grading.downloadReportPdf(portfolioId);
    } catch (err) {
      setError(err.message);
    } finally {
      setPdfDownloading(null);
    }
  };

  const handleOpenPortfolioFile = async (row) => {
    setError('');
    try {
      if (row.primary_file_id) {
        await api.portfolios.openFile(row.primary_file_id);
      } else if (row.portfolio_link) {
        window.open(row.portfolio_link, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSetFinal = async (portfolioId) => {
    const score = finalScores[portfolioId];
    if (score === '' || score === undefined) { setError('Enter a score first.'); return; }
    setError('');
    try {
      await api.grading.setFinal(portfolioId, { final_grade: Number(score), status: 'DRAFT' });
      setSuccess('Score saved.');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) { setError(err.message); }
  };

  const handlePublish = async () => {
    if (!selAssignment) return;
    setPublishing(true);
    try {
      await api.grading.publishAssignment(selAssignment);
      setSuccess('Grades published to students.');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) { setError(err.message); }
    finally { setPublishing(false); }
  };

  return (
    <>
      <h1 className="page-title">Grading</h1>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="content-card">
        <div className="form-row">
          <label className="form-label">Course:</label>
          <select className="form-select" value={selCourse} onChange={e => onCourseChange(e.target.value)}>
            <option value="">Select Course</option>
            {courses.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="form-label">Batch:</label>
          <select className="form-select" value={selBatch} onChange={e => onBatchChange(e.target.value)}>
            <option value="">Select Batch</option>
            {batches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Assignment:</label>
          <select className="form-select" value={selAssignment} onChange={e => onAssignmentChange(e.target.value)}>
            <option value="">Select Assignment</option>
            {assignments.map(a => <option key={a.assignment_id} value={a.assignment_id}>{a.assignment_name}</option>)}
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Submissions:</label>
          <input className="form-input" readOnly value={results.length} style={{ maxWidth:80 }} />
          <label className="form-label">Rubric:</label>
          <input className="form-input" readOnly value={rubric ? rubric.rubric_name : 'No rubric attached'} />
        </div>

        <div className="action-row">
          <button className="btn btn-primary" onClick={() => handleGradeAll(false)} disabled={grading || !selAssignment}>
            {grading ? 'Grading...' : 'GRADE PENDING/FAILED WITH AI'}
          </button>
          <button className="btn btn-secondary" onClick={() => handleGradeAll(true)} disabled={grading || !selAssignment}>
            FORCE REGRADE ALL
          </button>
        </div>

        {loading ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : (
          <div className="table-container">
            <table className="data-table grading-table">
              <thead>
                <tr>
                  <th>Student No</th>
                  <th>Uploaded</th>
                  <th>View Portfolio</th>
                  <th>AI Status</th>
                  <th>AI Score</th>
                  <th>AI Report</th>
                  <th>Error</th>
                  <th>Final Score (0-100)</th>
                  <th>Publish Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr><td colSpan={TABLE_COLUMN_COUNT} style={{ textAlign:'center', color:'#999', padding:'32px' }}>
                    {selAssignment ? 'No submissions yet.' : 'Select an assignment.'}
                  </td></tr>
                ) : results.map(r => {
                  const aiStatus = r.ai_status || 'pending';
                  const canRerun = aiStatus === 'pending' || aiStatus === 'failed';
                  const isReportOpen = openReportId === r.portfolio_id;
                  const isReportLoading = Boolean(reportLoadingByPortfolio[r.portfolio_id]);
                  const rowReport = reportsByPortfolio[r.portfolio_id];
                  const rowReportError = reportErrorsByPortfolio[r.portfolio_id];
                  return (
                    <Fragment key={r.portfolio_id}>
                      <tr>
                        <td>{r.student_no}</td>
                        <td>{r.upload_date ? new Date(r.upload_date).toLocaleDateString() : '-'}</td>
                        <td>
                          {(r.primary_file_id || r.portfolio_link) && (
                            <button className="btn btn-info btn-sm" onClick={() => handleOpenPortfolioFile(r)}>
                              View
                            </button>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${AI_STATUS_BADGE[aiStatus] || 'badge-warning'}`}>
                            {aiStatus}
                          </span>
                        </td>
                        <td className="grading-score-cell">{r.ai_grade ?? '-'}</td>
                        <td>
                          {aiStatus === 'graded' ? (
                            <div className="grading-button-group">
                              <button
                                className="btn btn-info btn-sm"
                                onClick={() => handleViewReport(r.portfolio_id)}
                              >
                                {isReportOpen ? 'Hide Report' : 'View Report'}
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleDownloadReportPdf(r.portfolio_id)}
                                disabled={pdfDownloading === r.portfolio_id}
                              >
                                {pdfDownloading === r.portfolio_id ? 'Downloading...' : 'Download PDF'}
                              </button>
                            </div>
                          ) : '-'}
                        </td>
                        <td className="grading-error-cell">
                          {r.ai_grading_error || '-'}
                        </td>
                        <td>
                          <input
                            type="number" min="0" max="100"
                            className="form-input grading-score-input"
                            value={finalScores[r.portfolio_id] ?? ''}
                            onChange={e => setFinalScores(s => ({ ...s, [r.portfolio_id]: e.target.value }))}
                          />
                        </td>
                        <td>
                          <span className={`badge ${r.status === 'PUBLISHED' ? 'badge-success' : 'badge-warning'}`}>
                            {r.status || 'DRAFT'}
                          </span>
                        </td>
                        <td>
                          <div className="grading-action-group">
                            {canRerun && (
                              <button className="btn btn-secondary btn-sm" onClick={() => handleGradeOne(r.portfolio_id)}>
                                Run AI
                              </button>
                            )}
                            {aiStatus === 'graded' && (
                              <button className="btn btn-secondary btn-sm" onClick={() => handleGradeOne(r.portfolio_id, true)}>
                                Force AI
                              </button>
                            )}
                            <button className="btn btn-success btn-sm" onClick={() => handleSetFinal(r.portfolio_id)}>
                              Save
                            </button>
                          </div>
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
                                    {/* <span>Student Number: <strong>{rowReport.student_no}</strong></span>
                                    <span>AI Score: <strong>{rowReport.ai_grade ?? '-'}</strong></span>
                                    <span>Model: <strong>{rowReport.ai_model || '-'}</strong></span> */}
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

        {isAdmin && (
          <div className="action-row">
            <button className="btn btn-primary" onClick={handlePublish} disabled={publishing || !selAssignment || results.length === 0}>
              {publishing ? 'Publishing...' : 'PUBLISH GRADES TO STUDENTS'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
