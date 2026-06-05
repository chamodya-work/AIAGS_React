import { useState, useEffect } from 'react';
import { api } from '../api/api';

const STATUSES = ['PUBLISHED', 'DRAFT'];

export default function ViewPortfolioList() {
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

  const [results, setResults] = useState({});

  const loadGradingForAssignment = async (aId) => {
    if (!aId) return;
    try {
      const d = await api.grading.resultsByAssignment(aId);
      const map = {};
      (d.results || []).forEach(r => { map[r.portfolio_id] = r; });
      setResults(map);
    } catch {
      setResults({});
    }
  };

  const handleAssignmentChange = async (aId) => {
    await onAssignmentChange(aId);
    await loadGradingForAssignment(aId);
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
    const grading = results[p.portfolio_id];
    const status = grading?.status || '';
    const matchStatus = !filterStatus || status === filterStatus;
    const searchable = `${p.student_no || ''} ${p.portfolio_link || ''} ${p.assignment_name || ''}`.toLowerCase();
    const matchSearch = !search || searchable.includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

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
              {STATUSES.map(s => <option key={s}>{s}</option>)}
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
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student No</th>
                  <th>Assignment</th>
                  <th>Batch</th>
                  <th>Uploaded</th>
                  <th>AI Grade</th>
                  <th>Final Grade</th>
                  <th>Status</th>
                  <th>View File</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: '#999', padding: '32px' }}>No portfolios found.</td></tr>
                ) : filtered.map(p => {
                  const grading = results[p.portfolio_id];
                  return (
                    <tr key={p.portfolio_id}>
                      <td>{p.student_no}</td>
                      <td>{p.assignment_name || '-'}</td>
                      <td>{p.batch || '-'}</td>
                      <td>{p.upload_date ? new Date(p.upload_date).toLocaleDateString() : '-'}</td>
                      <td style={{ fontWeight: 700, color: '#2196F3' }}>{grading?.ai_grade ?? '-'}</td>
                      <td style={{ fontWeight: 700, color: '#27ae60' }}>{grading?.final_grade ?? '-'}</td>
                      <td>
                        <span className={`badge ${grading?.status === 'PUBLISHED' ? 'badge-success' : 'badge-warning'}`}>
                          {grading?.status || 'NOT GRADED'}
                        </span>
                      </td>
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
