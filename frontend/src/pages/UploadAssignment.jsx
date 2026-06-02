import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/api';
import { useAuth } from '../components/AuthContext';

export default function UploadAssignment() {
  const { user } = useAuth();
  const location = useLocation();
  const [assignments, setAssignments]   = useState([]);
  const [selAssignment, setSelAssignment] = useState(location.state?.assignment_id || '');
  const [uploading, setUploading]       = useState(false);
  const [error, setError]               = useState('');
  const [success, setSuccess]           = useState('');
  const fileRef = useRef();

  useEffect(() => {
    api.assignments.list()
      .then(d => setAssignments(d.assignments || []))
      .catch(err => setError(err.message));
  }, []);

  // Derive student_no from the JWT user object
  const getStudentNo = () => {
    return user?.student_no || user?.stdNo || user?.email || '';
  };

  const handleSubmit = async () => {
    const file = fileRef.current?.files?.[0];
    if (!selAssignment) { setError('Select an assignment first.'); return; }
    if (!file)          { setError('Choose a file to submit.'); return; }
    const student_no = getStudentNo();
    if (!student_no)    { setError('Could not determine your student number. Please contact admin.'); return; }

    setError(''); setUploading(true);
    try {
      // Backend: student_no (string), assignment_id (coerced number), file (multipart)
      await api.portfolios.upload({
        student_no,
        assignment_id: selAssignment,
        file,
      });
      setSuccess('Assignment submitted successfully!');
      fileRef.current.value = '';
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) { setError(err.message); }
    finally { setUploading(false); }
  };

  return (
    <>
      <h1 className="page-title">Upload Assignment</h1>
      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="content-card">
        <div style={{ background:'#f0f7ff', border:'1px solid #2196F3', borderRadius:8, padding:'12px 16px', marginBottom:20, fontSize:14 }}>
          Submitting as: <strong>{getStudentNo() || user?.email || '—'}</strong>
        </div>

        <div className="form-row">
          <label className="form-label">Assignment:</label>
          <select className="form-select" value={selAssignment}
            onChange={e => setSelAssignment(e.target.value)}>
            <option value="">Select Assignment</option>
            {assignments.map(a => (
              <option key={a.assignment_id} value={a.assignment_id}>
                {a.assignment_name} — {a.batch} ({a.course_name})
              </option>
            ))}
          </select>
        </div>

        {selAssignment && (() => {
          const asgn = assignments.find(a => String(a.assignment_id) === String(selAssignment));
          return asgn?.deadline_date ? (
            <div style={{ marginBottom:16, fontSize:14, color:'#666' }}>
              📅 Due: <strong>{new Date(asgn.deadline_date).toLocaleDateString()}</strong>
              {asgn.remark && <span style={{ marginLeft:16 }}>📝 {asgn.remark}</span>}
            </div>
          ) : null;
        })()}

        <div className="form-row" style={{ alignItems:'center', flexWrap:'wrap', gap:12 }}>
          <label className="form-label">File:</label>
          <input type="file" ref={fileRef} accept=".pdf,.doc,.docx,.zip"
            style={{ flex:1, minWidth:200 }} />
        </div>

        <div style={{ fontSize:12, color:'#999', marginBottom:20 }}>
          Accepted formats: PDF, DOC, DOCX, ZIP (max 25 MB)
        </div>

        <div className="action-row">
          <button className="btn btn-primary" onClick={handleSubmit} disabled={uploading}>
            {uploading ? 'Submitting…' : '📤 SUBMIT ASSIGNMENT'}
          </button>
        </div>
      </div>
    </>
  );
}
