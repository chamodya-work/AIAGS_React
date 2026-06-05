import { useState, useEffect } from 'react';
import { api } from '../api/api';

export default function ViewResult() {
  const [assignments, setAssignments] = useState([]);
  const [selAssignment, setSelAssignment] = useState('');
  const [result, setResult] = useState(null);
  const [notReleased, setNotReleased] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.assignments.list()
      .then(d => setAssignments(d.assignments || []))
      .catch(err => setError(err.message))
      .finally(() => setFetching(false));
  }, []);

  const handleView = async () => {
    if (!selAssignment) { setError('Please select an assignment.'); return; }
    setError(''); setLoading(true); setResult(null); setNotReleased(false);
    try {
      const d = await api.student.result(selAssignment);
      if (d.released && d.result) {
        setResult(d.result);
      } else {
        setNotReleased(true);
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const getGradeLetter = (score) => {
    if (score == null) return '-';
    if (score >= 85) return 'A+';
    if (score >= 75) return 'A';
    if (score >= 65) return 'B';
    if (score >= 55) return 'C';
    if (score >= 45) return 'D';
    return 'F';
  };

  return (
    <>
      <h1 className="page-title">View Results</h1>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="content-card">
        <div className="filters-section" style={{ alignItems:'flex-end' }}>
          <div className="filter-group">
            <label className="filter-label">Assignment</label>
            {fetching ? (
              <div className="spinner-wrap" style={{ padding:'10px 0' }}>
                <div className="spinner" style={{ width:20, height:20 }} />
              </div>
            ) : (
              <select className="filter-select" value={selAssignment} onChange={e => setSelAssignment(e.target.value)}>
                <option value="">Select Assignment</option>
                {assignments.map(a => (
                  <option key={a.assignment_id} value={a.assignment_id}>
                    {a.assignment_name} ({a.batch})
                  </option>
                ))}
              </select>
            )}
          </div>
          <button className="btn btn-info" onClick={handleView} disabled={loading || !selAssignment}>
            {loading ? 'Loading...' : 'VIEW RESULT'}
          </button>
        </div>

        {loading && <div className="spinner-wrap"><div className="spinner" /></div>}

        {!loading && notReleased && (
          <div style={{ textAlign:'center', padding:'48px 20px', background:'#fff8e1', borderRadius:10, border:'1px solid #ffc107', marginTop:20 }}>
            <div style={{ fontSize:20, fontWeight:700, marginTop:12, color:'#856404' }}>Results Not Released Yet</div>
            <div style={{ fontSize:14, marginTop:8, color:'#666' }}>
              Your final result has not been published for this assignment yet. Please check back later.
            </div>
          </div>
        )}

        {!loading && result && (
          <div style={{ marginTop:24 }}>
            <div style={{ background:'linear-gradient(135deg, #144573, #1e81af)', borderRadius:12, padding:28, color:'white', marginBottom:20, display:'flex', gap:40, flexWrap:'wrap', alignItems:'center' }}>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:12, opacity:0.8, textTransform:'uppercase' }}>Final Score</div>
                <div style={{ fontSize:42, fontWeight:700 }}>{result.final_grade ?? '-'}</div>
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:12, opacity:0.8, textTransform:'uppercase' }}>Grade</div>
                <div style={{ fontSize:42, fontWeight:700 }}>{getGradeLetter(result.final_grade)}</div>
              </div>
              <div style={{ marginLeft:'auto', textAlign:'right' }}>
                <div style={{ fontSize:12, opacity:0.8 }}>Student No</div>
                <div style={{ fontSize:18, fontWeight:600 }}>{result.student_no}</div>
                <div style={{ fontSize:12, opacity:0.8, marginTop:8 }}>Uploaded</div>
                <div style={{ fontSize:14 }}>{result.upload_date ? new Date(result.upload_date).toLocaleDateString() : '-'}</div>
              </div>
            </div>

            {result.remark && (
              <div className="result-remark-panel">
                <strong>Remark</strong>
                <p>{result.remark}</p>
              </div>
            )}

            <div style={{ textAlign:'center', marginTop:24 }}>
              <button className="btn btn-secondary" onClick={() => window.print()}>Print Result</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
