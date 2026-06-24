import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/api';
import { useAuth } from '../components/AuthContext';
import { normalizeRole } from '../utils/roles';
import { COURSE_OPTIONS, getAllBatchOptions, getBatchOptionsForCourse, normalizeCourseName } from '../utils/courseBatches';

function uniqueAssignments(rows) {
  const byId = new Map();
  rows.forEach(row => {
    if (row?.assignment_id && !byId.has(row.assignment_id)) {
      byId.set(row.assignment_id, row);
    }
  });
  return [...byId.values()].sort((a, b) => (
    String(a.assignment_name || '').localeCompare(String(b.assignment_name || ''), undefined, { numeric: true })
  ));
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString();
}

function cleanParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value));
}

export default function RubricsPage() {
  const { user } = useAuth();
  const isAdmin = normalizeRole(user?.role) === 'admin';
  const [assignments, setAssignments] = useState([]);
  const [rubrics, setRubrics] = useState([]);
  const [filters, setFilters] = useState({
    course_name: '',
    batch: '',
    assignment_id: '',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const courseOptions = COURSE_OPTIONS;
  const batchOptions = useMemo(() => (
    filters.course_name ? getBatchOptionsForCourse(filters.course_name) : getAllBatchOptions()
  ), [filters.course_name]);

  const assignmentOptions = useMemo(() => (
    uniqueAssignments(assignments.filter(row => (
      (!filters.course_name || normalizeCourseName(row.course_name) === filters.course_name) &&
      (!filters.batch || row.batch === filters.batch)
    )))
  ), [assignments, filters.course_name, filters.batch]);

  const loadRubrics = async (nextFilters = filters) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.rubrics.list(cleanParams(nextFilters));
      setRubrics(data.rubrics || []);
    } catch (err) {
      setRubrics([]);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;

    Promise.all([api.assignments.list(), api.rubrics.list()])
      .then(([assignmentData, rubricData]) => {
        if (ignore) return;
        const nextRubrics = rubricData.rubrics || [];
        setRubrics(nextRubrics);
        setAssignments(isAdmin
          ? (assignmentData.assignments || [])
          : nextRubrics.map(rubric => ({
              assignment_id: rubric.assignment_id,
              assignment_name: rubric.assignment_name,
              course_name: rubric.course_name,
              batch: rubric.batch,
            }))
        );
      })
      .catch(err => {
        if (!ignore) setError(err.message);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => { ignore = true; };
  }, [isAdmin]);

  const updateFilter = (patch) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    loadRubrics(next);
  };

  const clearFilters = () => {
    const next = { course_name: '', batch: '', assignment_id: '' };
    setFilters(next);
    loadRubrics(next);
  };

  const handleViewRubric = async (rubricId) => {
    setError('');
    try {
      await api.rubrics.openFile(rubricId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (rubricId) => {
    if (!window.confirm('Delete this rubric?')) return;
    setError('');
    try {
      await api.rubrics.remove(rubricId);
      setRubrics(prev => prev.filter(row => row.rubric_id !== rubricId));
      setSuccess('Rubric deleted.');
      setTimeout(() => setSuccess(''), 2500);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <h1 className="page-title">Rubrics</h1>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="content-card">
        <div className="form-row">
          <label className="form-label">Course:</label>
          <select
            className="form-select"
            value={filters.course_name}
            onChange={e => updateFilter({
              course_name: e.target.value,
              batch: '',
              assignment_id: '',
            })}
          >
            <option value="">All Courses</option>
            {courseOptions.map(course => <option key={course} value={course}>{course}</option>)}
          </select>

          <label className="form-label">Batch:</label>
          <select
            className="form-select"
            value={filters.batch}
            onChange={e => updateFilter({ batch: e.target.value, assignment_id: '' })}
          >
            <option value="">All Batches</option>
            {batchOptions.map(batch => <option key={batch} value={batch}>{batch}</option>)}
          </select>

          <label className="form-label">Assignment:</label>
          <select
            className="form-select"
            value={filters.assignment_id}
            onChange={e => updateFilter({ assignment_id: e.target.value })}
          >
            <option value="">All Assignments</option>
            {assignmentOptions.map(assignment => (
              <option key={assignment.assignment_id} value={assignment.assignment_id}>
                {assignment.assignment_name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#6c757d', fontSize: 13 }}>
            Rubrics uploaded during assignment creation appear here.
          </div>
          <button className="btn btn-secondary btn-sm" type="button" onClick={clearFilters}>
            Clear Filters
          </button>
        </div>

        {loading ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : (
          <div className="table-container">
            <table className="data-table" style={{ minWidth: 1000 }}>
              <thead>
                <tr>
                  <th>Rubric</th>
                  <th>Assignment</th>
                  <th>Course</th>
                  <th>Batch</th>
                  <th>File Type</th>
                  <th>Uploaded Date</th>
                  <th>View / Download</th>
                  <th>Manage</th>
                </tr>
              </thead>
              <tbody>
                {rubrics.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: '#999', padding: '32px' }}>
                      No rubrics found.
                    </td>
                  </tr>
                ) : rubrics.map(rubric => (
                  <tr key={rubric.rubric_id}>
                    <td>
                      <strong>{rubric.rubric_file_original_name || rubric.rubric_name || '-'}</strong>
                      {rubric.rubric_name && rubric.rubric_file_original_name && rubric.rubric_name !== rubric.rubric_file_original_name && (
                        <div style={{ fontSize: 12, color: '#6c757d' }}>{rubric.rubric_name}</div>
                      )}
                    </td>
                    <td>{rubric.assignment_name || '-'}</td>
                    <td>{rubric.course_name || '-'}</td>
                    <td>{rubric.batch || '-'}</td>
                    <td>{rubric.file_type || '-'}</td>
                    <td>{formatDate(rubric.create_date)}</td>
                    <td>
                      {rubric.has_file ? (
                        <button className="btn btn-info btn-sm" onClick={() => handleViewRubric(rubric.rubric_id)}>
                          View
                        </button>
                      ) : (
                        <span style={{ color: '#6c757d' }}>No file</span>
                      )}
                    </td>
                    <td>
                      {rubric.can_delete ? (
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(rubric.rubric_id)}>
                          Delete
                        </button>
                      ) : (
                        <span style={{ color: '#6c757d' }}>Protected</span>
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
