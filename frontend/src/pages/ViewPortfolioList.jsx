import { useState, useEffect } from 'react';
import { api } from '../api/api';
import { useAuth } from '../components/AuthContext';
import { normalizeRole } from '../utils/roles';

const PUBLISH_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'submitted_to_head', label: 'Submitted to Head' },
  { value: 'published_to_student', label: 'Published to Student' },
];

const STATUS_BADGE = {
  SUBMITTED: 'badge-success',
  INCOMPLETE: 'badge-warning',
  'NO FILES': 'badge-danger',
  pending: 'badge-warning',
  processing: 'badge-info',
  graded: 'badge-success',
  failed: 'badge-danger',
  draft: 'badge-warning',
  submitted_to_head: 'badge-info',
  published_to_student: 'badge-success',
};

export default function ViewPortfolioList() {
  const { user } = useAuth();
  const isAdmin = normalizeRole(user?.role) === 'admin';
  const [portfolios, setPortfolios] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [selAssignment, setSelAssignment] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.portfolios.list(), api.assignments.list()])
      .then(([p, a]) => {
        setPortfolios(p.portfolios || []);
        setAssignments(a.assignments || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const onAssignmentChange = async (aId) => {
    setSelAssignment(aId);
    setLoading(true);
    try {
      const d = await api.portfolios.list(aId ? { assignment_id: aId } : {});
      setPortfolios(d.portfolios || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignmentChange = async (aId) => {
    await onAssignmentChange(aId);
  };

  const handleOpenFile = async (portfolio) => {
    setError('');
    try {
      if (portfolio.primary_file_id) {
        await api.portfolios.openFile(portfolio.primary_file_id);
      } else if (portfolio.portfolio_link) {
        window.open(portfolio.portfolio_link, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const filtered = portfolios.filter(p => {
    const status = p.publish_status || 'draft';
    const matchStatus = !filterStatus || status === filterStatus;
    const searchable = `${p.student_no || ''} ${p.portfolio_link || ''} ${p.assignment_name || ''} ${p.course_name || ''} ${p.batch || ''} ${p.lecturer_remark || ''} ${p.manual_remark_display || ''}`.toLowerCase();
    const matchSearch = !search || searchable.includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const columnCount = isAdmin ? 15 : 14;

  return (
    <>
      <h1 className="page-title">View Portfolio</h1>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="content-card">
        <div className="filters-section">
          <div className="filter-group">
            <label className="filter-label">Assignment</label>
            <select className="filter-select" value={selAssignment} onChange={e => handleAssignmentChange(e.target.value)}>
              <option value="">All Assignments</option>
              {assignments.map(a => <option key={a.assignment_id} value={a.assignment_id}>{a.assignment_name} ({a.batch})</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-label">Status</label>
            <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All</option>
              {PUBLISH_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-label">Search Student</label>
            <input className="search-input" placeholder="Student number..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>Print</button>
          </div>
        </div>

        {loading ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : (
          <div className="table-container">
            <table className="data-table portfolio-list-table">
              <thead>
                <tr>
                  <th>Student No</th>
                  <th>Assignment</th>
                  <th>Course</th>
                  <th>Batch</th>
                  <th>Uploaded</th>
                  <th>Submission Status</th>
                  <th>Main Answer</th>
                  <th>AI Status</th>
                  <th>AI Score</th>
                  <th>Manual/Teacher Score</th>
                  <th>Lecturer Remark</th>
                  <th>Final Published Score</th>
                  <th>Publish Status</th>
                  {isAdmin && <th>Assigned Lecturer</th>}
                  <th>View Submission</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={columnCount} style={{ textAlign: 'center', color: '#999', padding: '32px' }}>No portfolios found.</td></tr>
                ) : filtered.map(p => {
                  const draftHidden = isAdmin && p.manual_draft_hidden;
                  return (
                    <tr key={p.portfolio_id}>
                      <td>{p.student_no}</td>
                      <td>{p.assignment_name || '-'}</td>
                      <td>{p.course_name || '-'}</td>
                      <td>{p.batch || '-'}</td>
                      <td>{p.upload_date ? new Date(p.upload_date).toLocaleDateString() : '-'}</td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[p.submission_status] || 'badge-warning'}`}>
                          {p.submission_status || '-'}
                        </span>
                      </td>
                      <td className="grading-document-cell">
                        {p.main_answer_document_name || 'Fallback'}
                        <span>{p.ai_grading_file_names || p.main_answer_uploaded_files || '-'}</span>
                      </td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[p.ai_status] || 'badge-warning'}`}>
                          {p.ai_status || 'pending'}
                        </span>
                      </td>
                      <td style={{ fontWeight: 700, color: '#2196F3' }}>{p.ai_grade ?? '-'}</td>
                      <td style={{ fontWeight: 700, color: draftHidden ? '#777' : '#27ae60' }}>
                        {draftHidden ? (
                          <span className="manual-not-submitted">{p.manual_remark_display || 'Not submitted by lecturer yet'}</span>
                        ) : (p.teacher_score ?? '-')}
                      </td>
                      <td className="portfolio-remark-cell">
                        {draftHidden ? (
                          <span className="manual-not-submitted">{p.manual_remark_display || 'Not submitted by lecturer yet'}</span>
                        ) : p.lecturer_remark ? (
                          <span className="portfolio-remark-note">{p.lecturer_remark}</span>
                        ) : '-'}
                      </td>
                      <td style={{ fontWeight: 700, color: '#144573' }}>{p.final_published_score ?? '-'}</td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[p.publish_status || 'draft'] || 'badge-warning'}`}>
                          {p.publish_status_label || 'Draft'}
                        </span>
                      </td>
                      {isAdmin && <td>{p.assigned_lecturer?.label || '-'}</td>}
                      <td>
                        {(p.primary_file_id || p.portfolio_link) && (
                          <button className="btn btn-info btn-sm" onClick={() => handleOpenFile(p)}>
                            View
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
