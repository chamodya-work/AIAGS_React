import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/api';

const STATUS_BADGE = {
  SUBMITTED: 'badge-success',
  PENDING:   'badge-warning',
  OVERDUE:   'badge-danger',
};

function formatDateTime(dateValue, timeValue) {
  if (!dateValue) return '—';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '—';
  const dateText = date.toLocaleDateString();
  return timeValue ? `${dateText} ${String(timeValue).slice(0, 5)}` : dateText;
}

export default function StudentHome() {
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    api.student.dashboard()
      .then(d => setData(d))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const assignments = data?.assignments || [];
  const filtered = filterStatus
    ? assignments.filter(a => a.status === filterStatus)
    : assignments;

  const summary = data?.summary || {};
  const student = data?.student || {};

  return (
    <>
      <h1 className="page-title">My Assignments</h1>
      {error && <div className="alert alert-error">{error}</div>}

      {/* Student info bar */}
      {student.student_no && (
        <div style={{ background:'white', borderRadius:10, padding:'16px 24px', marginBottom:20, display:'flex', gap:32, flexWrap:'wrap', boxShadow:'0 2px 8px rgba(0,0,0,0.06)' }}>
          <div><span style={{ fontSize:12, color:'#999', textTransform:'uppercase' }}>Student No</span><br/><strong>{student.student_no}</strong></div>
          <div><span style={{ fontSize:12, color:'#999', textTransform:'uppercase' }}>Batch</span><br/><strong>{student.batch || '—'}</strong></div>
          <div><span style={{ fontSize:12, color:'#999', textTransform:'uppercase' }}>Course</span><br/><strong>{student.course_name || '—'}</strong></div>
          <div style={{ marginLeft:'auto', display:'flex', gap:24 }}>
            <div style={{ textAlign:'center' }}><div style={{ fontSize:22, fontWeight:700, color:'#27ae60' }}>{summary.submitted || 0}</div><div style={{ fontSize:11, color:'#999' }}>SUBMITTED</div></div>
            <div style={{ textAlign:'center' }}><div style={{ fontSize:22, fontWeight:700, color:'#f39c12' }}>{summary.pending || 0}</div><div style={{ fontSize:11, color:'#999' }}>PENDING</div></div>
            <div style={{ textAlign:'center' }}><div style={{ fontSize:22, fontWeight:700, color:'#e74c3c' }}>{summary.overdue || 0}</div><div style={{ fontSize:11, color:'#999' }}>OVERDUE</div></div>
          </div>
        </div>
      )}

      <div className="content-card">
        <div className="filters-section">
          <div className="filter-group">
            <label className="filter-label">Filter by Status</label>
            <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Status</option>
              <option value="PENDING">Pending</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="OVERDUE">Overdue</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Assignment</th>
                  <th>Course</th>
                  <th>Batch</th>
                  <th>Due Date/Time</th>
                  <th>Status</th>
                  <th>Uploaded File</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign:'center', color:'#999', padding:'40px' }}>No assignments found.</td></tr>
                ) : filtered.map(a => (
                  <tr key={a.assignment_id}>
                    <td>{a.assignment_name}</td>
                    <td>{a.course_name}</td>
                    <td>{a.batch}</td>
                    <td>{formatDateTime(a.deadline_date, a.deadline_time)}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[a.status] || 'badge-warning'}`}>
                        {a.status}
                      </span>
                    </td>
                    <td>
                      {a.portfolio_link ? (
                        <a href={a.portfolio_link} target="_blank" rel="noreferrer">
                          <button className="btn btn-info btn-sm">View Upload</button>
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {a.status !== 'SUBMITTED' && (
                        <button className="btn btn-primary btn-sm"
                          onClick={() => navigate('/student/upload', { state: { assignment_id: a.assignment_id } })}>
                          Upload
                        </button>
                      )}
                      {a.status === 'SUBMITTED' && (
                        <button className="btn btn-info btn-sm"
                          onClick={() => navigate('/student/results')}>
                          View Result
                        </button>
                      )}
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
