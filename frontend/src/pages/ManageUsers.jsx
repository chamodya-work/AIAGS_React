import { useState, useEffect } from 'react';
import { api } from '../api/api';

const ROLES = ['admin', 'teacher', 'student'];
const EMPTY = { display_name: '', email: '', password: '', role: 'student', student_no: '', teacher_id: '', department: '' };

export default function ManageUsers() {
  const [users, setUsers]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser]   = useState(null);
  const [form, setForm]           = useState(EMPTY);
  const [search, setSearch]       = useState('');
  const [filterRole, setFilterRole] = useState('');

  useEffect(() => { load(); }, []);

  const load = () => {
    setLoading(true);
    api.users.list()
      .then(d => setUsers(d.users || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  const openAdd = () => {
    setEditUser(null);
    setForm(EMPTY);
    setError('');
    setShowModal(true);
  };

  const openEdit = (u) => {
    setEditUser(u);
    setError('');
    setForm({
      display_name: u.display_name || u.full_name || '',
      email:        u.email || '',
      password:     '',
      role:         u.role || 'student',
      student_no:   u.student_no || '',
      teacher_id:   u.teacher_id || '',
      department:   u.department || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.email) { setError('Email is required.'); return; }
    if (!editUser && !form.password) { setError('Password is required for new users.'); return; }
    if (!editUser && form.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (form.role === 'student' && !form.student_no) { setError('Student number is required for students.'); return; }
    if (form.role === 'teacher' && !form.teacher_id) { setError('Teacher ID is required for teachers.'); return; }
    setError(''); setSaving(true);
    try {
      if (editUser) {
        // Backend PUT /api/auth/users/:id accepts { display_name, role }
        await api.users.update(editUser.user_id, {
          display_name: form.display_name,
          role: form.role,
        });
      } else {
        // Backend POST /api/auth/users - full createUserSchema
        await api.users.create({
          email:        form.email,
          password:     form.password,
          role:         form.role,
          display_name: form.display_name || undefined,
          student_no:   form.role === 'student' ? form.student_no : undefined,
          teacher_id:   form.role === 'teacher' ? form.teacher_id : undefined,
          department:   form.department || undefined,
        });
      }
      setShowModal(false);
      setSuccess(editUser ? 'User updated!' : 'User created!');
      setTimeout(() => setSuccess(''), 3000);
      load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this user?')) return;
    try { await api.users.remove(id); load(); }
    catch (err) { setError(err.message); }
  };

  const filtered = users.filter(u => {
    const matchSearch = !search ||
      (u.display_name + ' ' + u.full_name + ' ' + u.email + ' ' + (u.student_no||'')).toLowerCase().includes(search.toLowerCase());
    const matchRole = !filterRole || u.role === filterRole;
    return matchSearch && matchRole;
  });

  return (
    <>
      <h1 className="page-title">Manage Users</h1>
      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="content-card">
        <div className="filters-section">
          <div className="filter-group">
            <label className="filter-label">Search</label>
            <input className="search-input" placeholder="Name, email, student no…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="filter-group">
            <label className="filter-label">Role</label>
            <select className="filter-select" value={filterRole} onChange={e => setFilterRole(e.target.value)}>
              <option value="">All Roles</option>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div style={{ display:'flex', alignItems:'flex-end' }}>
            <button className="btn btn-primary" onClick={openAdd}>+ ADD USER</button>
          </div>
        </div>

        {loading ? (
          <div className="spinner-wrap"><div className="spinner" /></div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Student No</th>
                  <th>Edit</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign:'center', color:'#999', padding:'32px' }}>No users found.</td></tr>
                ) : filtered.map((u, i) => (
                  <tr key={u.user_id}>
                    <td>{i + 1}</td>
                    <td>{u.display_name || u.full_name || '—'}</td>
                    <td>{u.email}</td>
                    <td>
                      <span className={`badge ${u.role==='admin' ? 'badge-info' : u.role==='teacher' ? 'badge-success' : 'badge-warning'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td>{u.student_no || '—'}</td>
                    <td><button className="icon-btn" onClick={() => openEdit(u)}>📝</button></td>
                    <td><button className="icon-btn" onClick={() => handleDelete(u.user_id)}>🗑️</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editUser ? 'Edit User' : 'Add New User'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            {error && <div className="alert alert-error" style={{ marginBottom:12 }}>{error}</div>}

            <div className="form-row">
              <label className="form-label">Full Name:</label>
              <input className="form-input" placeholder="Display name"
                value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
            </div>
            <div className="form-row">
              <label className="form-label">Email:</label>
              <input type="email" className="form-input" placeholder="user@example.com"
                disabled={!!editUser}
                value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="form-row">
              <label className="form-label">Password:</label>
              <input type="password" className="form-input"
                placeholder={editUser ? '(cannot change here)' : 'Min 6 characters'}
                disabled={!!editUser}
                value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            </div>
            <div className="form-row">
              <label className="form-label">Role:</label>
              <select className="form-select" value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            {form.role === 'student' && (
              <div className="form-row">
                <label className="form-label">Student No:</label>
                <input className="form-input" placeholder="e.g. ME/2020/001"
                  disabled={!!editUser}
                  value={form.student_no} onChange={e => setForm(f => ({ ...f, student_no: e.target.value }))} />
              </div>
            )}
            {form.role === 'teacher' && (
              <div className="form-row">
                <label className="form-label">Teacher ID:</label>
                <input className="form-input" placeholder="e.g. T001"
                  disabled={!!editUser}
                  value={form.teacher_id} onChange={e => setForm(f => ({ ...f, teacher_id: e.target.value }))} />
              </div>
            )}
            <div className="form-row">
              <label className="form-label">Department:</label>
              <input className="form-input" placeholder="Optional"
                value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
            </div>
            <div className="action-row">
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editUser ? 'SAVE CHANGES' : 'CREATE USER'}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>CANCEL</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
