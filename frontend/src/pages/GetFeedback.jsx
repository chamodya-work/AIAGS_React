import { useState, useEffect, useRef } from 'react';
import { api } from '../api/api';
import { useAuth } from '../components/AuthContext';

export default function GetFeedback() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState([]);
  const [selAssignment, setSelAssignment] = useState('');
  const [feedback, setFeedback]       = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const fileRef = useRef();

  useEffect(() => {
    api.assignments.list()
      .then(d => setAssignments(d.assignments || []))
      .catch(err => setError(err.message));
  }, []);

  const handleGetFeedback = async () => {
    if (!selAssignment) { setError('Select an assignment first.'); return; }
    setError(''); setLoading(true); setFeedback(null);
    try {
      const file = fileRef.current?.files?.[0];

      // If user uploaded a new file, upload it first then grade
      if (file) {
        const student_no = user?.student_no || user?.stdNo || user?.email || '';
        const p = await api.portfolios.upload({ student_no, assignment_id: selAssignment, file });
        const portfolioId = p.portfolio?.portfolio_id;
        if (portfolioId) {
          const gradeRes = await api.grading.gradePortfolioAI(portfolioId);
          setFeedback(gradeRes.ai || gradeRes);
        }
      } else {
        // Get existing grading results
        const d = await api.grading.resultsByAssignment(selAssignment);
        const rows = d.results || [];
        setFeedback(rows[0] || null);
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <>
      <h1 className="page-title">Get Feedback</h1>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="content-card">
        <div className="form-row" style={{ flexWrap:'wrap', gap:12, alignItems:'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, flex:1, minWidth:220 }}>
            <label className="form-label">Assignment:</label>
            <select className="form-select" value={selAssignment} onChange={e => setSelAssignment(e.target.value)}>
              <option value="">Select Assignment</option>
              {assignments.map(a => (
                <option key={a.assignment_id} value={a.assignment_id}>
                  {a.assignment_name} ({a.batch})
                </option>
              ))}
            </select>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8, flex:1, minWidth:200 }}>
            <label className="form-label" style={{ minWidth:80 }}>Upload new:</label>
            <input type="file" ref={fileRef} accept=".pdf,.doc,.docx" style={{ flex:1 }} />
          </div>
          <button className="btn btn-primary" onClick={handleGetFeedback} disabled={loading}>
            {loading ? 'Processing…' : '🤖 GET AI FEEDBACK'}
          </button>
        </div>

        {loading && (
          <div className="spinner-wrap">
            <div style={{ textAlign:'center' }}>
              <div className="spinner" style={{ margin:'0 auto 12px' }} />
              <div style={{ fontSize:14, color:'#666' }}>AI is analysing your portfolio…</div>
            </div>
          </div>
        )}

        {!loading && feedback === null && selAssignment && (
          <div style={{ textAlign:'center', padding:'40px 20px', color:'#999', marginTop:16 }}>
            Click "GET AI FEEDBACK" to load feedback for this assignment.
          </div>
        )}

        {!loading && feedback && (
          <div style={{ marginTop:24 }}>
            {/* Score summary */}
            <div style={{ background:'#f0f7ff', border:'1px solid #2196F3', borderRadius:10, padding:'20px 24px', marginBottom:20, display:'flex', gap:40, flexWrap:'wrap' }}>
              {feedback.ai_grade !== undefined && (
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:'#999', textTransform:'uppercase' }}>AI Grade</div>
                  <div style={{ fontSize:36, fontWeight:700, color:'#2196F3' }}>{feedback.ai_grade ?? '—'}</div>
                </div>
              )}
              {feedback.final_grade !== undefined && (
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:'#999', textTransform:'uppercase' }}>Final Grade</div>
                  <div style={{ fontSize:36, fontWeight:700, color:'#27ae60' }}>{feedback.final_grade ?? '—'}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:'#999', textTransform:'uppercase' }}>Student No</div>
                <div style={{ fontSize:18, fontWeight:600, color:'#333' }}>{feedback.student_no || '—'}</div>
              </div>
            </div>

            {/* AI report */}
            {(feedback.ai_review_report || feedback.ai_review) && (
              <div className="section-container">
                <div className="section-header">AI Review Report</div>
                <div className="section-content">
                  <p style={{ fontSize:14, lineHeight:1.8, color:'#444', whiteSpace:'pre-wrap' }}>
                    {feedback.ai_review_report || feedback.ai_review}
                  </p>
                </div>
              </div>
            )}

            <div style={{ textAlign:'center', marginTop:24 }}>
              <button className="btn btn-secondary" onClick={() => window.print()}>🖨️ Print Feedback</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
