import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/api';
import { COURSE_OPTIONS, getAllBatchOptions, getBatchOptionsForCourse, normalizeCourseName } from '../utils/courseBatches';

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString();
}

function lecturerLabel(lecturer) {
  return lecturer?.label || lecturer?.full_name || lecturer?.display_name || lecturer?.email || '-';
}

function naturalStudentCompare(a, b) {
  const left = String(a.student_no || '');
  const right = String(b.student_no || '');
  const leftParts = left.split(/(\d+)/).filter(Boolean);
  const rightParts = right.split(/(\d+)/).filter(Boolean);
  const max = Math.max(leftParts.length, rightParts.length);

  for (let i = 0; i < max; i += 1) {
    const lp = leftParts[i] || '';
    const rp = rightParts[i] || '';
    const ln = /^\d+$/.test(lp) ? Number(lp) : null;
    const rn = /^\d+$/.test(rp) ? Number(rp) : null;
    if (ln !== null && rn !== null && ln !== rn) return ln - rn;
    if (lp !== rp) return lp.localeCompare(rp);
  }

  return left.localeCompare(right);
}

function shuffleRows(rows) {
  const next = [...rows];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function emptyGroups(lecturers) {
  return lecturers.map(lecturer => ({
    lecturer,
    assigned_count: 0,
    submissions: [],
  }));
}

function buildPreview({ mode, rows, lecturers }) {
  const groups = emptyGroups(lecturers);
  if (!rows.length || !lecturers.length) return groups;

  if (mode === 'random') {
    shuffleRows(rows).forEach((row, index) => {
      const group = groups[index % groups.length];
      group.submissions.push({ portfolio_id: row.portfolio_id, student_no: row.student_no });
      group.assigned_count += 1;
    });
    return groups.map(group => ({ ...group, submissions: group.submissions.sort(naturalStudentCompare) }));
  }

  const sortedRows = [...rows].sort(naturalStudentCompare);
  const base = Math.floor(sortedRows.length / groups.length);
  const remainder = sortedRows.length % groups.length;
  let cursor = 0;

  groups.forEach((group, index) => {
    const count = base + (index < remainder ? 1 : 0);
    const chunk = sortedRows.slice(cursor, cursor + count);
    group.submissions = chunk.map(row => ({ portfolio_id: row.portfolio_id, student_no: row.student_no }));
    group.assigned_count = group.submissions.length;
    cursor += count;
  });

  return groups;
}

function DistributionGroups({ title, groups, unassignedRemaining, note }) {
  return (
    <div className="distribution-preview">
      <div className="distribution-preview-header">
        <h3>{title}</h3>
        {typeof unassignedRemaining === 'number' && (
          <span>Unassigned remaining: {unassignedRemaining}</span>
        )}
      </div>
      {note && <div className="assign-mode-note">{note}</div>}
      <div className="assign-groups-grid">
        {groups.map(group => (
          <div className="assign-group" key={group.lecturer.user_id}>
            <h3>{lecturerLabel(group.lecturer)} ({group.assigned_count ?? group.submissions.length})</h3>
            {group.submissions.length === 0 ? (
              <div className="feedback-empty" style={{ padding: 0 }}>No submissions.</div>
            ) : (
              <ul>
                {group.submissions.map(submission => (
                  <li key={submission.portfolio_id}>{submission.student_no}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AssignLecturers() {
  const [assignments, setAssignments] = useState([]);
  const [lecturers, setLecturers] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [groups, setGroups] = useState([]);
  const [unassignedRemaining, setUnassignedRemaining] = useState(null);
  const [filters, setFilters] = useState({
    course_name: '',
    batch: '',
    assignment_id: '',
  });
  const [selected, setSelected] = useState(new Set());
  const [selectedLecturer, setSelectedLecturer] = useState('');
  const [assignmentMode, setAssignmentMode] = useState('manual');
  const [selectedLecturers, setSelectedLecturers] = useState(new Set());
  const [useAllUnassigned, setUseAllUnassigned] = useState(true);
  const [includeAssigned, setIncludeAssigned] = useState(false);
  const [previewGroups, setPreviewGroups] = useState(null);
  const [distributionResult, setDistributionResult] = useState(null);
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

  const courses = COURSE_OPTIONS;
  const batches = useMemo(() => (
    filters.course_name ? getBatchOptionsForCourse(filters.course_name) : getAllBatchOptions()
  ), [filters.course_name]);

  const filteredAssignments = assignments.filter((assignment) => {
    if (filters.course_name && normalizeCourseName(assignment.course_name) !== filters.course_name) return false;
    if (filters.batch && assignment.batch !== filters.batch) return false;
    return true;
  });

  const selectedIds = [...selected];
  const selectedLecturerIds = [...selectedLecturers].map(Number);
  const selectedDistributionLecturers = lecturers.filter(lecturer => selectedLecturers.has(String(lecturer.user_id)));

  const getDistributionRows = () => {
    const baseRows = useAllUnassigned
      ? submissions
      : submissions.filter(row => selected.has(row.portfolio_id));

    return includeAssigned
      ? baseRows
      : baseRows.filter(row => !row.assigned_lecturer);
  };

  const loadAssignmentData = async (assignmentId) => {
    if (!assignmentId) {
      setSubmissions([]);
      setGroups([]);
      setUnassignedRemaining(null);
      setSelected(new Set());
      setPreviewGroups(null);
      setDistributionResult(null);
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
      setUnassignedRemaining(groupData.unassigned_remaining ?? null);
      setSelected(new Set());
      setPreviewGroups(null);
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
      setUnassignedRemaining(null);
      setSelected(new Set());
      setPreviewGroups(null);
      setDistributionResult(null);
    }
    if (key === 'course_name') next.batch = '';
    setFilters(next);
  };

  const handleAssignmentChange = async (assignmentId) => {
    setFilters(prev => ({ ...prev, assignment_id: assignmentId }));
    setDistributionResult(null);
    await loadAssignmentData(assignmentId);
  };

  const handleModeChange = (mode) => {
    setAssignmentMode(mode);
    setError('');
    setSuccess('');
    setPreviewGroups(null);
    setDistributionResult(null);
  };

  const toggleSelected = (portfolioId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(portfolioId)) next.delete(portfolioId);
      else next.add(portfolioId);
      return next;
    });
    setPreviewGroups(null);
  };

  const toggleAll = () => {
    if (selected.size === submissions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(submissions.map(row => row.portfolio_id)));
    }
    setPreviewGroups(null);
  };

  const toggleDistributionLecturer = (value) => {
    setSelectedLecturers(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
    setPreviewGroups(null);
  };

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
      setDistributionResult(null);
      await refresh();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePreviewDistribution = () => {
    if (!filters.assignment_id) { setError('Select an assignment first.'); return; }
    if (assignmentMode === 'equal' && selectedLecturerIds.length < 2) {
      setError('Equal distribution requires at least two lecturers.');
      return;
    }
    if (assignmentMode === 'random' && selectedLecturerIds.length < 1) {
      setError('Select at least one lecturer.');
      return;
    }

    const targetRows = getDistributionRows();
    if (!targetRows.length) {
      setError(includeAssigned
        ? 'No student submissions are available for distribution.'
        : 'No unassigned student submissions are available for distribution.');
      return;
    }

    setError('');
    setPreviewGroups(buildPreview({
      mode: assignmentMode,
      rows: targetRows,
      lecturers: selectedDistributionLecturers,
    }));
    setDistributionResult(null);
  };

  const handleApplyDistribution = async () => {
    if (!filters.assignment_id) { setError('Select an assignment first.'); return; }
    if (assignmentMode === 'manual') { setError('Select Random or Equal Distribution mode.'); return; }
    if (assignmentMode === 'equal' && selectedLecturerIds.length < 2) {
      setError('Equal distribution requires at least two lecturers.');
      return;
    }
    if (assignmentMode === 'random' && selectedLecturerIds.length < 1) {
      setError('Select at least one lecturer.');
      return;
    }

    const targetRows = getDistributionRows();
    if (!targetRows.length) {
      setError(includeAssigned
        ? 'No student submissions are available for distribution.'
        : 'No unassigned student submissions are available for distribution.');
      return;
    }

    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const result = await api.lecturerAssignments.distribute({
        assignment_id: Number(filters.assignment_id),
        mode: assignmentMode,
        lecturer_user_ids: selectedLecturerIds,
        portfolio_ids: useAllUnassigned ? [] : selectedIds,
        use_all_filtered: useAllUnassigned,
        include_assigned: includeAssigned,
      });
      setDistributionResult(result);
      setSuccess(`Distribution applied. Assigned ${result.assigned_count || 0} submission(s).`);
      await refresh();
      setTimeout(() => setSuccess(''), 4000);
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

        <div className="assign-settings-card">
          <div className="assign-settings-header">
            <div>
              <h2>Assignment Distribution Settings</h2>
              <p>Choose how selected submissions should be assigned to lecturers.</p>
            </div>
          </div>

          <div className="assign-settings-row">
            <label className="filter-label">Assignment Mode</label>
            <select className="form-select assign-mode-select" value={assignmentMode} onChange={e => handleModeChange(e.target.value)}>
              <option value="manual">Manual</option>
              <option value="random">Random</option>
              <option value="equal">Equal Distribution</option>
            </select>
          </div>

          {assignmentMode === 'manual' ? (
            <>
              <div className="assign-section">
                <label className="assign-section-title">Lecturer</label>
                <select className="form-select assign-manual-select" value={selectedLecturer} onChange={e => setSelectedLecturer(e.target.value)}>
                  <option value="">Select Lecturer</option>
                  {lecturers.map(lecturer => (
                    <option key={lecturer.user_id} value={lecturer.user_id}>
                      {lecturerLabel(lecturer)}
                    </option>
                  ))}
                </select>
                <div className="assign-helper-text">Manual mode assigns the checked student submissions to one lecturer.</div>
              </div>

              <div className="assign-actions">
                <button className="btn btn-primary" onClick={handleAssign} disabled={saving || !selectedIds.length}>
                  Assign Selected
                </button>
                <button className="btn btn-secondary" onClick={handleUnassign} disabled={saving || !selectedIds.length}>
                  Clear Selected
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="assign-section">
                <div className="assign-section-title">Select Lecturers</div>
                {lecturers.length === 0 ? (
                  <div className="feedback-empty" style={{ padding: 0 }}>No lecturers found.</div>
                ) : (
                  <div className="assign-lecturer-grid">
                    {lecturers.map(lecturer => {
                      const value = String(lecturer.user_id);
                      const checked = selectedLecturers.has(value);
                      return (
                        <label className={`assign-checkbox-card${checked ? ' selected' : ''}`} key={lecturer.user_id}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDistributionLecturer(value)}
                          />
                          <span>{lecturerLabel(lecturer)}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="assign-section">
                <div className="assign-section-title">Options</div>
                <div className="assign-options-list">
                  <label className="assign-option-row">
                    <input
                      type="checkbox"
                      checked={useAllUnassigned}
                      onChange={e => {
                        setUseAllUnassigned(e.target.checked);
                        setPreviewGroups(null);
                      }}
                    />
                    <span>
                      <strong>Use all currently filtered unassigned students</strong>
                      <small>Uses all submissions matching the selected assignment/filter.</small>
                    </span>
                  </label>
                  <label className="assign-option-row">
                    <input
                      type="checkbox"
                      checked={includeAssigned}
                      onChange={e => {
                        setIncludeAssigned(e.target.checked);
                        setPreviewGroups(null);
                      }}
                    />
                    <span>
                      <strong>Include already assigned students / reassign existing assignments</strong>
                      <small>Allows existing lecturer assignments to be replaced.</small>
                    </span>
                  </label>
                </div>
                <div className="assign-helper-text">
                  {useAllUnassigned
                    ? 'The system will use all submissions for this assignment, skipping already assigned rows unless reassign is enabled.'
                    : 'The system will use only the checked submissions in the table.'}
                </div>
              </div>

              <div className="assign-actions">
                <button className="btn btn-secondary" onClick={handlePreviewDistribution} disabled={saving}>
                  Preview Distribution
                </button>
                <button className="btn btn-primary" onClick={handleApplyDistribution} disabled={saving}>
                  Apply Assignment
                </button>
                <button className="btn btn-secondary" onClick={handleUnassign} disabled={saving || !selectedIds.length}>
                  Clear Selected
                </button>
              </div>
            </>
          )}
        </div>

        {previewGroups && (
          <DistributionGroups
            title="Proposed Distribution"
            groups={previewGroups}
            note={assignmentMode === 'random' ? 'Random preview is generated locally; final assignment is randomized again when applied.' : ''}
          />
        )}

        {distributionResult && (
          <DistributionGroups
            title="Last Applied Distribution"
            groups={distributionResult.groups || []}
            unassignedRemaining={distributionResult.unassigned_remaining}
            note={`Assigned ${distributionResult.assigned_count || 0}; skipped ${distributionResult.skipped_count || 0}.`}
          />
        )}

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
          {typeof unassignedRemaining === 'number' && (
            <div className="assign-mode-note">Unassigned remaining: {unassignedRemaining}</div>
          )}
          {groups.length === 0 ? (
            <div className="feedback-empty">No lecturer groups assigned yet.</div>
          ) : (
            <div className="assign-groups-grid">
              {groups.map(group => (
                <div className="assign-group" key={group.lecturer.user_id}>
                  <h3>{lecturerLabel(group.lecturer)} ({group.assigned_count ?? group.submissions.length})</h3>
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
