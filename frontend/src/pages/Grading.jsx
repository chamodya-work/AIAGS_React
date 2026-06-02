import { useState, useEffect } from 'react';
import { api } from '../api/api';

export default function GradingPage() {
  const [courses, setCourses]         = useState([]);
  const [batches, setBatches]         = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [results, setResults]         = useState([]);
  const [rubric, setRubric]           = useState(null);
  const [selCourse, setSelCourse]     = useState('');
  const [selBatch, setSelBatch]       = useState('');
  const [selAssignment, setSelAssignment] = useState('');
  const [grading, setGrading]         = useState(false);
  const [publishing, setPublishing]   = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [success, setSuccess]         = useState('');
  // key: portfolio_id -> teacher final_grade string
  const [finalScores, setFinalScores] = useState({});

  useEffect(() => {
    api.courses.list()
      .then(d => setCourses(d.courses || []))
      .catch(err => setError(err.message));
  }, []);

  const onCourseChange = async (cn) => {
    setSelCourse(cn); setSelBatch(''); setSelAssignment(''); setResults([]); setRubric(null);
    if (cn) {
      try { const d = await api.batches.list({ course_name: cn }); setBatches(d.batches || []); }
      catch { setBatches([]); }
    }
  };

  const onBatchChange = async (batch) => {
    setSelBatch(batch); setSelAssignment(''); setResults([]); setRubric(null);
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
      // pre-fill teacher score inputs with existing final_grade
      const scores = {};
      rows.forEach(r => { scores[r.portfolio_id] = r.final_grade ?? ''; });
      setFinalScores(scores);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const onAssignmentChange = async (aId) => {
    setSelAssignment(aId); setResults([]); setRubric(null); setFinalScores({});
    if (aId) await loadResults(aId);
  };

  const handleGradeAll = async () => {
    if (!selAssignment) { setError('Select an assignment first.'); return; }
    setError(''); setGrading(true);
    try {
      await api.grading.gradeAssignmentAI(selAssignment);
      await loadResults(selAssignment);
      setSuccess('AI grading complete!');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) { setError(err.message); }
    finally { setGrading(false); }
  };

  const handleSetFinal = async (portfolioId) => {
    const score = finalScores[portfolioId];
    if (score === '' || score === undefined) { setError('Enter a score first.'); return; }
    setError('');
    try {
      // Backend expects: { final_grade: number, status?: 'DRAFT'|'PUBLISHED' }
      await api.grading.setFinal(portfolioId, { final_grade: Number(score), status: 'DRAFT' });
      setSuccess(`Score saved!`);
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) { setError(err.message); }
  };

  const handlePublish = async () => {
    if (!selAssignment) return;
    setPublishing(true);
    try {
      await api.grading.publishAssignment(selAssignment);
      setSuccess('Grades published to students!');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) { setError(err.message); }
    finally { setPublishing(false); }
  };

  return (
    <>
      <h1 className="page-title">Grading</h1>
      {error   && <div className="alert alert-error">{error}</div>}
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
          <button className="btn btn-primary" onClick={handleGradeAll} disabled={grading || !selAssignment}>
            {grading ? 'Grading…' : '🤖 GRADE ALL WITH AI'}
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
                  <th>AI Grade</th>
                  <th>AI Report</th>
                  <th>Teacher's Score (0-100)</th>
                  <th>Status</th>
                  <th>Save</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign:'center', color:'#999', padding:'32px' }}>
                    {selAssignment ? 'No submissions yet.' : 'Select an assignment.'}
                  </td></tr>
                ) : results.map(r => (
                  <tr key={r.portfolio_id}>
                    <td>{r.student_no}</td>
                    <td>{r.upload_date ? new Date(r.upload_date).toLocaleDateString() : '—'}</td>
                    <td>
                      {r.portfolio_link && (
                        <a href={r.portfolio_link} target="_blank" rel="noreferrer">
                          <button className="icon-btn">👁</button>
                        </a>
                      )}
                    </td>
                    <td style={{ fontWeight:700, color:'#2196F3' }}>{r.ai_grade ?? '—'}</td>
                    <td style={{ maxWidth:200, fontSize:12, color:'#666' }}>
                      {r.ai_review_report ? r.ai_review_report.slice(0, 80) + '…' : '—'}
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
                    <td>
                      <button className="btn btn-success btn-sm" onClick={() => handleSetFinal(r.portfolio_id)}>
                        Save
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="action-row">
          <button className="btn btn-primary" onClick={handlePublish} disabled={publishing || !selAssignment || results.length === 0}>
            {publishing ? 'Publishing…' : '📢 PUBLISH GRADES TO STUDENTS'}
          </button>
        </div>
      </div>
    </>
  );
}
