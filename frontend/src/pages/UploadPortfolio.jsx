import { useState, useEffect, useRef } from 'react';
import { api } from '../api/api';

export default function UploadPortfolio() {
  const [courses, setCourses]         = useState([]);
  const [batches, setBatches]         = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [selCourse, setSelCourse]     = useState('');
  const [selBatch, setSelBatch]       = useState('');
  const [selAssignment, setSelAssignment] = useState('');
  const [studentNo, setStudentNo]     = useState('');
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [success, setSuccess]         = useState('');
  const fileRef = useRef();

  useEffect(() => {
    api.courses.list()
      .then(d => setCourses(d.courses || []))
      .catch(err => setError(err.message));
  }, []);

  const onCourseChange = async (cn) => {
    setSelCourse(cn); setSelBatch(''); setSelAssignment(''); setSubmissions([]);
    if (cn) {
      try { const d = await api.batches.list({ course_name: cn }); setBatches(d.batches || []); }
      catch { setBatches([]); }
    }
  };

  const onBatchChange = async (batch) => {
    setSelBatch(batch); setSelAssignment(''); setSubmissions([]);
    if (batch && selCourse) {
      try {
        const d = await api.assignments.list({ course_name: selCourse, batch });
        setAssignments(d.assignments || []);
      } catch { setAssignments([]); }
    }
  };

  const onAssignmentChange = async (aId) => {
    setSelAssignment(aId); setSubmissions([]);
    if (aId) {
      try { const d = await api.portfolios.list({ assignment_id: aId }); setSubmissions(d.portfolios || []); }
      catch { setSubmissions([]); }
    }
  };

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!selAssignment)    { setError('Select an assignment first.'); return; }
    if (!studentNo.trim()) { setError('Enter the student number.'); return; }
    if (!file)             { setError('Choose a file to upload.'); return; }
    setError(''); setSaving(true);
    try {
      // Backend requires: student_no (string), assignment_id (coerced number), file
      await api.portfolios.upload({
        student_no: studentNo.trim(),
        assignment_id: selAssignment,
        file,
      });
      const d = await api.portfolios.list({ assignment_id: selAssignment });
      setSubmissions(d.portfolios || []);
      setSuccess('Portfolio uploaded successfully!');
      fileRef.current.value = '';
      setStudentNo('');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <>
      <h1 className="page-title">Upload Portfolio</h1>
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
          <label className="form-label">Student No:</label>
          <input
            className="form-input"
            placeholder="e.g. ME/2020/001"
            value={studentNo}
            onChange={e => setStudentNo(e.target.value)}
            style={{ maxWidth: 220 }}
          />
        </div>

        <div className="form-row" style={{ alignItems:'center', flexWrap:'wrap', gap:12 }}>
          <label className="form-label">File:</label>
          <input type="file" ref={fileRef} accept=".pdf,.doc,.docx,.zip" style={{ flex:1 }} />
          <button className="btn btn-primary" onClick={handleUpload} disabled={saving}>
            {saving ? 'Uploading…' : 'UPLOAD PORTFOLIO'}
          </button>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Student Number</th>
                <th>File</th>
                <th>Uploaded</th>
                <th>View</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              {submissions.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign:'center', color:'#999', padding:'32px' }}>
                  {selAssignment ? 'No submissions yet.' : 'Select an assignment to see submissions.'}
                </td></tr>
              ) : submissions.map(s => (
                <tr key={s.portfolio_id}>
                  <td>{s.student_no}</td>
                  <td style={{ fontSize:12, color:'#555' }}>{s.portfolio_link?.split('/').pop() || '—'}</td>
                  <td>{s.upload_date ? new Date(s.upload_date).toLocaleDateString() : '—'}</td>
                  <td>
                    {s.portfolio_link && (
                      <a href={s.portfolio_link} target="_blank" rel="noreferrer">
                        <button className="icon-btn">📄</button>
                      </a>
                    )}
                  </td>
                  <td>
                    <button className="icon-btn" onClick={async () => {
                      if (!window.confirm('Delete this portfolio?')) return;
                      try {
                        await api.portfolios.remove(s.portfolio_id);
                        setSubmissions(prev => prev.filter(x => x.portfolio_id !== s.portfolio_id));
                      } catch (err) { setError(err.message); }
                    }}>🗑️</button>
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
