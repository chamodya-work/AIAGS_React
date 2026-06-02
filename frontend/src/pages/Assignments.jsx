import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/api';

const DEPTS  = ['Medicine', 'Surgery', 'Pediatrics', 'Obstetrics', 'Community Medicine'];
const ATTACH = ['Attendance', 'Professionalism Index', 'Photos'];

export default function AssignmentsPage() {
  const navigate = useNavigate();
  const [courses, setCourses]  = useState([]);
  const [batches, setBatches]  = useState([]);
  const [list, setList]        = useState([]);
  const [loading, setLoading]  = useState(true);
  const [saving, setSaving]    = useState(false);
  const [error, setError]      = useState('');
  const [success, setSuccess]  = useState('');

  // Backend schema: assignment_name, batch, course_name, department, start_date, deadline_date, remark
  const [form, setForm] = useState({
    department: '', course_name: '', batch: '', assignment_name: '',
    remark: '', start_date: '', deadline_date: '',
  });

  useEffect(() => {
    Promise.all([api.courses.list(), api.assignments.list()])
      .then(([c, a]) => {
        setCourses(c.courses || []);
        setList(a.assignments || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const onCourseChange = async (course_name) => {
    setForm(f => ({ ...f, course_name, batch: '' }));
    if (course_name) {
      try { const d = await api.batches.list({ course_name }); setBatches(d.batches || []); }
      catch { setBatches([]); }
    } else { setBatches([]); }
  };

  const handleSubmit = async () => {
    if (!form.course_name || !form.batch || !form.assignment_name || !form.deadline_date) {
      setError('Course, Batch, Assignment name and Due Date are required.'); return;
    }
    setError(''); setSaving(true);
    try {
      await api.assignments.create(form);
      const updated = await api.assignments.list();
      setList(updated.assignments || []);
      setSuccess('Assignment added successfully!');
      setForm({ department:'', course_name:'', batch:'', assignment_name:'', remark:'', start_date:'', deadline_date:'' });
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this assignment?')) return;
    try {
      await api.assignments.remove(id);
      setList(list.filter(a => a.assignment_id !== id));
    } catch (err) { setError(err.message); }
  };

  return (
    <>
      <h1 className="page-title">Add Assignment</h1>
      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="content-card">
        <div className="form-row">
          <label className="form-label">Department:</label>
          <select className="form-select" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}>
            <option value="">Select Department</option>
            {DEPTS.map(d => <option key={d}>{d}</option>)}
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Course:</label>
          <select className="form-select" value={form.course_name} onChange={e => onCourseChange(e.target.value)}>
            <option value="">Select Course</option>
            {courses.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="form-label">Batch:</label>
          <select className="form-select" value={form.batch} onChange={e => setForm(f => ({ ...f, batch: e.target.value }))}>
            <option value="">Select Batch</option>
            {batches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        <div className="form-row">
          <label className="form-label">Assignment:</label>
          <input className="form-input" placeholder="Assignment name" value={form.assignment_name}
            onChange={e => setForm(f => ({ ...f, assignment_name: e.target.value }))} />
        </div>

        <div className="form-row">
          <label className="form-label">Remark:</label>
          <input className="form-input" placeholder="Optional remark" value={form.remark}
            onChange={e => setForm(f => ({ ...f, remark: e.target.value }))} />
        </div>

        <div className="form-row">
          <label className="form-label">Start Date:</label>
          <input type="date" className="form-input" value={form.start_date}
            onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
          <label className="form-label">Due Date:</label>
          <input type="date" className="form-input" value={form.deadline_date}
            onChange={e => setForm(f => ({ ...f, deadline_date: e.target.value }))} />
        </div>

        <div className="action-row">
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'ADD ASSIGNMENT'}
          </button>
        </div>

        {loading ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Course</th>
                  <th>Assignment</th>
                  <th>Due Date</th>
                  <th>Edit</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign:'center', color:'#999', padding:'32px' }}>No assignments yet.</td></tr>
                ) : list.map(a => (
                  <tr key={a.assignment_id}>
                    <td>{a.batch}</td>
                    <td>{a.course_name}</td>
                    <td>{a.assignment_name}</td>
                    <td>{a.deadline_date ? new Date(a.deadline_date).toLocaleDateString() : '—'}</td>
                    <td>
                      <button className="icon-btn" title="Edit" onClick={() => navigate(`/assignments/edit/${a.assignment_id}`)}>📝</button>
                    </td>
                    <td>
                      <button className="icon-btn" title="Delete" onClick={() => handleDelete(a.assignment_id)}>🗑️</button>
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
