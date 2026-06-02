import { useState, useEffect, useRef } from 'react';
import { api } from '../api/api';

export default function RubricsPage() {
  const [courses, setCourses]         = useState([]);
  const [batches, setBatches]         = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [rubrics, setRubrics]         = useState([]);
  const [selCourse, setSelCourse]     = useState('');
  const [selBatch, setSelBatch]       = useState('');
  const [selAssignment, setSelAssignment] = useState('');
  const [loading, setLoading]         = useState(false);
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
    setSelCourse(cn); setSelBatch(''); setSelAssignment(''); setRubrics([]);
    if (cn) {
      try { const d = await api.batches.list({ course_name: cn }); setBatches(d.batches || []); }
      catch { setBatches([]); }
    }
  };

  const onBatchChange = async (batch) => {
    setSelBatch(batch); setSelAssignment(''); setRubrics([]);
    if (batch && selCourse) {
      try {
        const d = await api.assignments.list({ course_name: selCourse, batch });
        setAssignments(d.assignments || []);
      } catch { setAssignments([]); }
    }
  };

  const onAssignmentChange = async (aId) => {
    setSelAssignment(aId); setRubrics([]);
    if (aId) {
      setLoading(true);
      try { const d = await api.rubrics.byAssignment(aId); setRubrics(d.rubrics || []); }
      catch { setRubrics([]); }
      finally { setLoading(false); }
    }
  };

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!selAssignment) { setError('Please select an assignment first.'); return; }
    if (!file)          { setError('Please choose a file to upload.'); return; }
    setError(''); setSaving(true);
    try {
      await api.rubrics.upload({ assignment_id: selAssignment, rubric_name: file.name, file });
      const d = await api.rubrics.byAssignment(selAssignment);
      setRubrics(d.rubrics || []);
      setSuccess('Rubric uploaded successfully!');
      fileRef.current.value = '';
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (rId) => {
    if (!window.confirm('Delete this rubric?')) return;
    try {
      await api.rubrics.remove(rId);
      setRubrics(rubrics.filter(r => r.rubric_id !== rId));
    } catch (err) { setError(err.message); }
  };

  return (
    <>
      <h1 className="page-title">Add Rubric</h1>
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

        <div className="form-row" style={{ alignItems:'center', flexWrap:'wrap', gap:12 }}>
          <label className="form-label">Upload Rubric:</label>
          <input type="file" ref={fileRef} accept=".pdf,.doc,.docx,.txt" style={{ flex:1, minWidth:180 }} />
          <button className="btn btn-primary" onClick={handleUpload} disabled={saving}>
            {saving ? 'Uploading…' : 'UPLOAD RUBRIC'}
          </button>
        </div>

        {loading ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rubric Name</th>
                  <th>Created Date</th>
                  <th>View</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {rubrics.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign:'center', color:'#999', padding:'32px' }}>
                    {selAssignment ? 'No rubrics for this assignment.' : 'Select an assignment to view rubrics.'}
                  </td></tr>
                ) : rubrics.map(r => (
                  <tr key={r.rubric_id}>
                    <td>{r.rubric_name}</td>
                    <td>{r.create_date ? new Date(r.create_date).toLocaleDateString() : '—'}</td>
                    <td>
                      {r.rubric_file_path && (
                        <a href={r.rubric_file_path} target="_blank" rel="noreferrer">
                          <button className="icon-btn" title="View">🔍</button>
                        </a>
                      )}
                    </td>
                    <td>
                      <button className="icon-btn" title="Delete" onClick={() => handleDelete(r.rubric_id)}>🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
