import { useState, useEffect } from 'react';
import { api } from '../api/api';

const AI_STATUS_BADGE = {
  pending: 'badge-warning',
  processing: 'badge-info',
  graded: 'badge-success',
  failed: 'badge-danger',
};

export default function GradingPage() {
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
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    api.courses.list()
      .then(d => setCourses(d.courses || []))
      .catch(err => setError(err.message));
  }, []);

  const onCourseChange = async (cn) => {
    setSelCourse(cn); setSelBatch(''); setSelAssignment(''); setResults([]); setRubric(null); setReport(null);
    if (cn) {
      try { const d = await api.batches.list({ course_name: cn }); setBatches(d.batches || []); }
      catch { setBatches([]); }
    }
  };

  const onBatchChange = async (batch) => {
    setSelBatch(batch); setSelAssignment(''); setResults([]); setRubric(null); setReport(null);
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
    setSelAssignment(aId); setResults([]); setRubric(null); setFinalScores({}); setReport(null);
    if (aId) await loadResults(aId);
  };

  const handleGradeAll = async (forceRegrade = false) => {
    if (!selAssignment) { setError('Select an assignment first.'); return; }
    setError(''); setSuccess(''); setGrading(true); setReport(null);
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
    setError(''); setSuccess(''); setReport(null);
    try {
      const data = await api.grading.gradePortfolioAI(portfolioId, { forceRegrade });
      await loadResults(selAssignment);
      setSuccess(data.result?.error || data.result?.message || 'AI grading updated.');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) { setError(err.message); }
  };

  const handleViewReport = async (portfolioId) => {
    setReportLoading(true);
    setError('');
    try {
      const data = await api.grading.report(portfolioId);
      setReport(data.report || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setReportLoading(false);
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
            <table className="data-table">
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
                  <tr><td colSpan={10} style={{ textAlign:'center', color:'#999', padding:'32px' }}>
                    {selAssignment ? 'No submissions yet.' : 'Select an assignment.'}
                  </td></tr>
                ) : results.map(r => {
                  const aiStatus = r.ai_status || 'pending';
                  const canRerun = aiStatus === 'pending' || aiStatus === 'failed';
                  return (
                    <tr key={r.portfolio_id}>
                      <td>{r.student_no}</td>
                      <td>{r.upload_date ? new Date(r.upload_date).toLocaleDateString() : '-'}</td>
                      <td>
                        {r.portfolio_link && (
                          <a href={r.portfolio_link} target="_blank" rel="noreferrer">
                            <button className="icon-btn">View</button>
                          </a>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${AI_STATUS_BADGE[aiStatus] || 'badge-warning'}`}>
                          {aiStatus}
                        </span>
                      </td>
                      <td style={{ fontWeight:700, color:'#2196F3' }}>{r.ai_grade ?? '-'}</td>
                      <td>
                        {aiStatus === 'graded' ? (
                          <button className="btn btn-info btn-sm" onClick={() => handleViewReport(r.portfolio_id)} disabled={reportLoading}>
                            View Report
                          </button>
                        ) : '-'}
                      </td>
                      <td style={{ maxWidth:220, fontSize:12, color:'#b00020' }}>
                        {r.ai_grading_error || '-'}
                      </td>
                      <td>
                        <input
                          type="number" min="0" max="100"
                          className="form-input" style={{ width:90 }}
                          value={finalScores[r.portfolio_id] ?? ''}
                          onChange={e => setFinalScores(s => ({ ...s, [r.portfolio_id]: e.target.value }))}
                        />
                      </td>
                      <td>
                        <span className={`badge ${r.status === 'PUBLISHED' ? 'badge-success' : 'badge-warning'}`}>
                          {r.status || 'DRAFT'}
                        </span>
                      </td>
                      <td style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {report && (
          <div className="section-container" style={{ marginTop:24 }}>
            <div className="section-header">AI Assignment Evaluation Report</div>
            <div className="section-content">
              <div style={{ fontSize:13, color:'#555', marginBottom:12 }}>
                Student: <strong>{report.student_no}</strong> | AI Score: <strong>{report.ai_grade ?? '-'}</strong> | Model: <strong>{report.ai_model || '-'}</strong>
              </div>
              <pre style={{ whiteSpace:'pre-wrap', fontFamily:'inherit', lineHeight:1.7, color:'#333' }}>
                {report.ai_report_text}
              </pre>
            </div>
          </div>
        )}

        <div className="action-row">
          <button className="btn btn-primary" onClick={handlePublish} disabled={publishing || !selAssignment || results.length === 0}>
            {publishing ? 'Publishing...' : 'PUBLISH GRADES TO STUDENTS'}
          </button>
        </div>
      </div>
    </>
  );
}
