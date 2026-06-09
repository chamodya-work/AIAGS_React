import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/api';
import { useAuth } from '../components/AuthContext';
import { normalizeRole } from '../utils/roles';

const DEPTS = ['Medicine', 'Surgery', 'Pediatrics', 'Obstetrics', 'Community Medicine'];
const REQUIRED_DOC_TYPE_OPTIONS = [
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'DOCX' },
  { value: 'pdf_or_docx', label: 'PDF or DOCX' },
  { value: 'image', label: 'Image' },
  { value: 'excel', label: 'Excel' },
  { value: 'any_supported_document', label: 'Any supported document' },
];

const initialForm = {
  course_name: '',
  department: '',
  batch: '',
  assignment_name: '',
  remark: '',
  start_date: '',
  start_time: '',
  deadline_date: '',
  deadline_time: '',
};

const emptyRequiredDoc = () => ({
  document_name: '',
  allowed_file_type: 'pdf_or_docx',
  is_mandatory: true,
});

function formatDateTime(dateValue, timeValue) {
  if (!dateValue) return '-';

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '-';

  const dateText = date.toLocaleDateString();
  if (!timeValue) return dateText;

  const timeText = String(timeValue).slice(0, 5);
  return `${dateText} ${timeText}`;
}

function buildAssignmentFormData(form, guidelineFile, rubricFile, requiredDocs) {
  const fd = new FormData();
  Object.entries(form).forEach(([key, value]) => {
    fd.append(key, value || '');
  });

  const usedRequiredDocs = requiredDocs
    .filter((row) => row.document_name.trim())
    .map((row) => ({
      document_name: row.document_name.trim(),
      allowed_file_type: row.allowed_file_type,
      is_mandatory: Boolean(row.is_mandatory),
    }));

  fd.append('required_documents', JSON.stringify(usedRequiredDocs));
  if (guidelineFile) fd.append('guideline_file', guidelineFile);
  if (rubricFile) fd.append('rubric_file', rubricFile);
  return fd;
}

export default function AssignmentsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = normalizeRole(user?.role) === 'admin';
  const [courses, setCourses] = useState([]);
  const [batches, setBatches] = useState([]);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState(initialForm);
  const [requiredDocs, setRequiredDocs] = useState([emptyRequiredDoc()]);
  const [guidelineFile, setGuidelineFile] = useState(null);
  const [rubricFile, setRubricFile] = useState(null);
  const guidelineRef = useRef(null);
  const rubricRef = useRef(null);

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
      try {
        const d = await api.batches.list({ course_name });
        setBatches(d.batches || []);
      } catch {
        setBatches([]);
      }
    } else {
      setBatches([]);
    }
  };

  const updateRequiredDoc = (index, patch) => {
    setRequiredDocs((rows) => rows.map((row, rowIndex) => (
      rowIndex === index ? { ...row, ...patch } : row
    )));
  };

  const addRequiredDocRow = () => {
    setRequiredDocs((rows) => [...rows, emptyRequiredDoc()]);
  };

  const removeRequiredDocRow = (index) => {
    setRequiredDocs((rows) => {
      const next = rows.filter((_, rowIndex) => rowIndex !== index);
      return next.length ? next : [emptyRequiredDoc()];
    });
  };

  const resetForm = () => {
    setForm(initialForm);
    setBatches([]);
    setRequiredDocs([emptyRequiredDoc()]);
    setGuidelineFile(null);
    setRubricFile(null);
    if (guidelineRef.current) guidelineRef.current.value = '';
    if (rubricRef.current) rubricRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!form.course_name || !form.batch || !form.assignment_name || !form.deadline_date) {
      setError('Course, Batch, Assignment name and Due Date are required.');
      return;
    }

    setError('');
    setSaving(true);
    try {
      await api.assignments.create(buildAssignmentFormData(form, guidelineFile, rubricFile, requiredDocs));
      const updated = await api.assignments.list();
      setList(updated.assignments || []);
      setSuccess('Assignment added successfully.');
      resetForm();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this assignment?')) return;
    try {
      await api.assignments.remove(id);
      setList(list.filter(a => a.assignment_id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleOpenGuideline = async (id) => {
    setError('');
    try {
      await api.assignments.openGuideline(id);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <h1 className="page-title">Add Assignment</h1>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="content-card assignment-form-card">
        <div className="assignment-form-grid">
          <div className="assignment-field">
            <label>Course</label>
            <select className="form-select" value={form.course_name} onChange={e => onCourseChange(e.target.value)}>
              <option value="">Select Course</option>
              {courses.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="assignment-field">
            <label>Department</label>
            <select className="form-select" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}>
              <option value="">Select Department</option>
              {DEPTS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>

          <div className="assignment-field assignment-field-full">
            <label>Batch</label>
            <select className="form-select" value={form.batch} onChange={e => setForm(f => ({ ...f, batch: e.target.value }))}>
              <option value="">Select Batch</option>
              {batches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div className="assignment-field assignment-field-full">
            <label>Assignment Name</label>
            <input className="form-input" placeholder="Assignment name" value={form.assignment_name}
              onChange={e => setForm(f => ({ ...f, assignment_name: e.target.value }))} />
          </div>

          <div className="assignment-field assignment-field-full">
            <label>Remark</label>
            <input className="form-input" placeholder="Optional remark" value={form.remark}
              onChange={e => setForm(f => ({ ...f, remark: e.target.value }))} />
          </div>

          <div className="assignment-field">
            <label>Start Date</label>
            <input type="date" className="form-input" value={form.start_date}
              onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
          </div>

          <div className="assignment-field">
            <label>Start Time</label>
            <input type="time" className="form-input" value={form.start_time}
              onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
          </div>

          <div className="assignment-field">
            <label>Due Date</label>
            <input type="date" className="form-input" value={form.deadline_date}
              onChange={e => setForm(f => ({ ...f, deadline_date: e.target.value }))} />
          </div>

          <div className="assignment-field">
            <label>Due Time</label>
            <input type="time" className="form-input" value={form.deadline_time}
              onChange={e => setForm(f => ({ ...f, deadline_time: e.target.value }))} />
          </div>

          <div className="assignment-field assignment-field-full assignment-file-field">
            <label>Guideline Document</label>
            <input
              type="file"
              ref={guidelineRef}
              className="form-input"
              accept=".pdf,.docx,.txt"
              onChange={e => setGuidelineFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className="assignment-field assignment-field-full assignment-file-field">
            <label>Rubric</label>
            <input
              type="file"
              ref={rubricRef}
              className="form-input"
              accept=".xlsx,.xls,.csv,.pdf,.docx"
              onChange={e => setRubricFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className="assignment-required-docs assignment-field-full">
            <div className="required-docs-header">
              <h2>Required Documents</h2>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addRequiredDocRow}>
                Add Row
              </button>
            </div>
            <div className="table-container compact-table-container">
              <table className="data-table required-docs-table">
                <thead>
                  <tr>
                    <th>Required Document Name</th>
                    <th>Allowed File Type</th>
                    <th>Mandatory</th>
                    <th>Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {requiredDocs.map((row, index) => (
                    <tr key={index}>
                      <td>
                        <input
                          className="form-input"
                          placeholder="Case Study Report"
                          value={row.document_name}
                          onChange={e => updateRequiredDoc(index, { document_name: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          className="form-select"
                          value={row.allowed_file_type}
                          onChange={e => updateRequiredDoc(index, { allowed_file_type: e.target.value })}
                        >
                          {REQUIRED_DOC_TYPE_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="form-select"
                          value={row.is_mandatory ? 'mandatory' : 'optional'}
                          onChange={e => updateRequiredDoc(index, { is_mandatory: e.target.value === 'mandatory' })}
                        >
                          <option value="mandatory">Mandatory</option>
                          <option value="optional">Optional</option>
                        </select>
                      </td>
                      <td>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => removeRequiredDocRow(index)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="action-row assignment-action-row">
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving...' : 'ADD ASSIGNMENT'}
          </button>
        </div>
      </div>

      <div className="content-card assignment-list-card">
        {loading ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : (
          <div className="table-container">
            <table className="data-table assignments-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Course</th>
                  <th>Department</th>
                  <th>Assignment</th>
                  <th>Due Date/Time</th>
                  <th>Guideline</th>
                  <th>Edit</th>
                  {isAdmin && <th>Delete</th>}
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 8 : 7} style={{ textAlign: 'center', color: '#999', padding: '32px' }}>
                      No assignments yet.
                    </td>
                  </tr>
                ) : list.map(a => (
                  <tr key={a.assignment_id}>
                    <td>{a.batch}</td>
                    <td>{a.course_name}</td>
                    <td>{a.department || '-'}</td>
                    <td>{a.assignment_name}</td>
                    <td>{formatDateTime(a.deadline_date, a.deadline_time)}</td>
                    <td>
                      {a.has_guideline ? (
                        <button className="btn btn-info btn-sm" onClick={() => handleOpenGuideline(a.assignment_id)}>
                          View
                        </button>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/assignments/edit/${a.assignment_id}`)}>
                        Edit
                      </button>
                    </td>
                    {isAdmin && (
                      <td>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(a.assignment_id)}>
                          Delete
                        </button>
                      </td>
                    )}
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
