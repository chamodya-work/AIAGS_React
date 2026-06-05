import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { normalizeRole, roleLabel } from '../utils/roles';

const ADMIN_LINKS = [
  { to: '/portfolio/list',   label: 'View Portfolio List' },
  { to: '/portfolio/upload', label: 'Upload Portfolio' },
  { to: '/assignments',      label: 'Create Assignments' },
  { to: '/assign-lecturers', label: 'Assign Lecturers' },
  { to: '/rubrics',          label: 'Add Rubrics' },
  { to: '/grading',          label: 'AI Grading' },
  { to: '/manual-grading',   label: 'Manual Grading' },
  { to: '/users',            label: 'Manage Users' },
];

const LECTURER_LINKS = [
  { to: '/portfolio/list',   label: 'View Portfolio List' },
  { to: '/assignments',      label: 'Create Assignments' },
  { to: '/rubrics',          label: 'Add Rubrics' },
  { to: '/grading',          label: 'AI Grading' },
  { to: '/manual-grading',   label: 'Manual Grading' },
];

const STUDENT_LINKS = [
  { to: '/student/home',     label: 'My Assignments' },
  { to: '/student/upload',   label: 'Upload Assignment' },
  { to: '/student/feedback', label: 'Get Feedback' },
  { to: '/student/results',  label: 'View Results' },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const role = normalizeRole(user?.role);
  const links = role === 'student'
    ? STUDENT_LINKS
    : role === 'admin'
      ? ADMIN_LINKS
      : LECTURER_LINKS;

  const displayName = user?.display_name || user?.email || 'User';
  const displayRole = user?.role_label || roleLabel(role);

  const handleSignOut = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="logo-section">
          <img src="/images/logo.png" alt="Faculty Logo" className="logo-image" />
          <div className="logo-text">
            <strong>Faculty of Medicine</strong>
            <span>University of Kelaniya</span>
          </div>
        </div>
        <div className="welcome-bar">
          Welcome, {displayName}
          {role && <span style={{ opacity:0.7, fontSize:11, marginLeft:8 }}>({displayRole})</span>}
        </div>
      </div>

      <nav className="sidebar-nav">
        {links.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `nav-button${isActive ? ' active' : ''}`}
          >
            <span className="nav-bullet" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="sign-out-button" onClick={handleSignOut}>
          <span>Sign Out</span>
          <span>&gt;</span>
        </button>
      </div>

      <div className="sidebar-copyright">
        (c) 2025 Faculty of Medicine<br />
        University of Kelaniya, Sri Lanka.<br />
        All rights reserved.
      </div>
    </div>
  );
}
