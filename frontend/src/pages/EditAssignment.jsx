import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/api';

const DEPTS = ['Medicine', 'Surgery', 'Pediatrics', 'Obstetrics', 'Community Medicine'];

export default function EditAssignment() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [courses, setCourses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [saving, setSaving]   = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({
    department: '', course_name: '', batch: '', assignment_name: '',
    remark: '', start_date: '', deadline_date: '',
  });

  useEffect(() => {
    Promise.all([api.courses.list(), api.assignments.get(id)])
      .then(async ([c, a]) => {
        setCourses(c.courses || []);
        const asgn = a.assignment || a;
        setForm({
          department:      asgn.department || '',
          course_name:     asgn.course_name || '',
          batch:           asgn.batch || '',
          assignment_name: asgn.assignment_name || '',
          remark:          asgn.remark || '',
          start_date:      asgn.start_date   ? asgn.start_date.slice(0,10)   : '',
          deadline_date:   asgn.deadline_date ? asgn.deadline_date.slice(0,10) : '',
        });
        if (asgn.course_name) {
          const d = await api.batches.list({ course_name: asgn.course_name });
          setBatches(d.batches || []);
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const onCourseChange = async (course_name) => {
    setForm(f => ({ ...f, course_name, batch: '' }));
    if (course_name) {
      try { const d = await api.batches.list({ course_name }); setBatches(d.batches || []); }
      catch { setBatches([]); }
    }
  };

  const handleSave = async () => {
    if (!form.assignment_name || !form.deadline_date) {
      setError('Assignment name and Due Date are required.'); return;
    }
    setError(''); setSaving(true);
    try {
      await api.assignments.update(id, form);
      setSuccess('Changes saved!');
      setTimeout(() => navigate('/assignments'), 1500);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="spinner-wrap"><div className="spinner" /></div>;

  return (
    <>
      <h1 className="page-title">Edit Assignment</h1>
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
          <input className="form-input" value={form.assignment_name}
            onChange={e => setForm(f => ({ ...f, assignment_name: e.target.value }))} />
        </div>
        <div className="form-row">
          <label className="form-label">Remark:</label>
          <input className="form-input" value={form.remark}
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
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'SAVE CHANGES'}
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/assignments')}>CANCEL</button>
        </div>
      </div>
    </>
  );
}
