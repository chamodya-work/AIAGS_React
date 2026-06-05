import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/api';

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString();
}

function lecturerLabel(lecturer) {
  return lecturer?.label || lecturer?.full_name || lecturer?.display_name || lecturer?.email || '-';
}

export default function AssignLecturers() {
  const [assignments, setAssignments] = useState([]);
  const [lecturers, setLecturers] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [groups, setGroups] = useState([]);
  const [filters, setFilters] = useState({
    course_name: '',
    department: '',
    batch: '',
    assignment_id: '',
  });
  const [selected, setSelected] = useState(new Set());
  const [selectedLecturer, setSelectedLecturer] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    Promise.all([
      api.assignments.list(),
      api.lecturerAssignments.lecturers(),
    ])
      .then(([assignmentData, lecturerData]) => {
        setAssignments(assignmentData.assignments || []);
        setLecturers(lecturerData.lecturers || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const courses = useMemo(() => unique(assignments.map(a => a.course_name)), [assignments]);
  const departments = useMemo(() => unique(assignments.map(a => a.department)), [assignments]);
  const batches = useMemo(() => {
    const filtered = filters.course_name
      ? assignments.filter(a => a.course_name === filters.course_name)
      : assignments;
    return unique(filtered.map(a => a.batch));
  }, [assignments, filters.course_name]);

  const filteredAssignments = assignments.filter((assignment) => {
    if (filters.course_name && assignment.course_name !== filters.course_name) return false;
    if (filters.department && assignment.department !== filters.department) return false;
    if (filters.batch && assignment.batch !== filters.batch) return false;
    return true;
  });

  const loadAssignmentData = async (assignmentId) => {
    if (!assignmentId) {
      setSubmissions([]);
      setGroups([]);
      setSelected(new Set());
      return;
    }

    setError('');
    setLoadingSubmissions(true);
    try {
      const [submissionData, groupData] = await Promise.all([
        api.lecturerAssignments.submissions(assignmentId),
        api.lecturerAssignments.groups(assignmentId),
      ]);
      setSubmissions(submissionData.submissions || []);
      setGroups(groupData.groups || []);
      setSelected(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingSubmissions(false);
    }
  };

  const updateFilter = (key, value) => {
    const next = { ...filters, [key]: value };
    if (key !== 'assignment_id') {
      next.assignment_id = '';
      setSubmissions([]);
      setGroups([]);
      setSelected(new Set());
    }
    if (key === 'course_name') next.batch = '';
    setFilters(next);
  };

  const handleAssignmentChange = async (assignmentId) => {
    setFilters(prev => ({ ...prev, assignment_id: assignmentId }));
    await loadAssignmentData(assignmentId);
  };

  const toggleSelected = (portfolioId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(portfolioId)) next.delete(portfolioId);
      else next.add(portfolioId);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === submissions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(submissions.map(row => row.portfolio_id)));
    }
  };

  const selectedIds = [...selected];

  const refresh = async () => {
    await loadAssignmentData(filters.assignment_id);
  };

  const handleAssign = async () => {
    if (!filters.assignment_id) { setError('Select an assignment first.'); return; }
    if (!selectedIds.length) { setError('Select at least one student submission.'); return; }
    if (!selectedLecturer) { setError('Select a lecturer.'); return; }

    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api.lecturerAssignments.assign({
        assignment_id: Number(filters.assignment_id),
        lecturer_user_id: Number(selectedLecturer),
        portfolio_ids: selectedIds,
      });
      setSuccess('Selected submissions assigned.');
      await refresh();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUnassign = async () => {
    if (!filters.assignment_id) { setError('Select an assignment first.'); return; }
    if (!selectedIds.length) { setError('Select at least one student submission.'); return; }

    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api.lecturerAssignments.unassign({
        assignment_id: Number(filters.assignment_id),
        portfolio_ids: selectedIds,
      });
      setSuccess('Selected submissions unassigned.');
      await refresh();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenSubmission = async (row) => {
    if (!row.primary_file_id) {
      setError('No viewable submission file is available for this student.');
      return;
    }

    setError('');
    try {
      await api.portfolios.openFile(row.primary_file_id);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <h1 className="page-title">Assign Lecturers</h1>
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="content-card assign-lecturers-card">
        <div className="filters-section">
          <div className="filter-group">
            <label className="filter-label">Course</label>
            <select className="filter-select" value={filters.course_name} onChange={e => updateFilter('course_name', e.target.value)}>
              <option value="">All Courses</option>
              {courses.map(course => <option key={course} value={course}>{course}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-label">Department</label>
            <select className="filter-select" value={filters.department} onChange={e => updateFilter('department', e.target.value)}>
              <option value="">All Departments</option>
              {departments.map(dept => <option key={dept} value={dept}>{dept}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-label">Batch</label>
            <select className="filter-select" value={filters.batch} onChange={e => updateFilter('batch', e.target.value)}>
              <option value="">All Batches</option>
              {batches.map(batch => <option key={batch} value={batch}>{batch}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label className="filter-label">Assignment</label>
            <select className="filter-select" value={filters.assignment_id} onChange={e => handleAssignmentChange(e.target.value)}>
              <option value="">Select Assignment</option>
              {filteredAssignments.map(assignment => (
                <option key={assignment.assignment_id} value={assignment.assignment_id}>
                  {assignment.assignment_name} ({assignment.batch})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="assign-toolbar">
          <select className="form-select" value={selectedLecturer} onChange={e => setSelectedLecturer(e.target.value)}>
            <option value="">Select Lecturer</option>
            {lecturers.map(lecturer => (
              <option key={lecturer.user_id} value={lecturer.user_id}>
                {lecturerLabel(lecturer)}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={handleAssign} disabled={saving || !selectedIds.length}>
            Assign Selected
          </button>
          <button className="btn btn-secondary" onClick={handleUnassign} disabled={saving || !selectedIds.length}>
            Clear Selected
          </button>
        </div>

        <div className="assign-mode-note">
          Manual assignment is active. Random/equal distribution can be added on top of this assignment API later.
        </div>

        {loading || loadingSubmissions ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : (
          <div className="table-container">
            <table className="data-table assign-lecturers-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={submissions.length > 0 && selected.size === submissions.length}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>Student Number</th>
                  <th>Uploaded Date</th>
                  <th>Submission Status</th>
                  <th>Currently Assigned Lecturer</th>
                  <th>View Submission</th>
                </tr>
              </thead>
              <tbody>
                {!filters.assignment_id ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: '#999', padding: '32px' }}>Select an assignment.</td></tr>
                ) : submissions.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: '#999', padding: '32px' }}>No submitted portfolios found.</td></tr>
                ) : submissions.map(row => (
                  <tr key={row.portfolio_id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(row.portfolio_id)}
                        onChange={() => toggleSelected(row.portfolio_id)}
                      />
                    </td>
                    <td>{row.student_no}</td>
                    <td>{formatDate(row.upload_date)}</td>
                    <td>
                      <span className={`badge ${row.submission_status === 'SUBMITTED' ? 'badge-success' : row.submission_status === 'INCOMPLETE' ? 'badge-warning' : 'badge-danger'}`}>
                        {row.submission_status}
                      </span>
                    </td>
                    <td>{row.assigned_lecturer ? lecturerLabel(row.assigned_lecturer) : '-'}</td>
                    <td>
                      <button className="btn btn-info btn-sm" onClick={() => handleOpenSubmission(row)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {filters.assignment_id && (
        <div className="content-card assign-groups-card">
          <h2 className="section-title">Assigned Groups</h2>
          {groups.length === 0 ? (
            <div className="feedback-empty">No lecturer groups assigned yet.</div>
          ) : (
            <div className="assign-groups-grid">
              {groups.map(group => (
                <div className="assign-group" key={group.lecturer.user_id}>
                  <h3>{lecturerLabel(group.lecturer)}</h3>
                  <ul>
                    {group.submissions.map(submission => (
                      <li key={submission.portfolio_id}>{submission.student_no}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
