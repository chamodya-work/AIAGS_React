import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

const ADMIN_LINKS = [
  { to: '/portfolio/list',   label: 'View Portfolio List' },
  { to: '/portfolio/upload', label: 'Upload Portfolio' },
  { to: '/assignments',      label: 'Create Assignments' },
  { to: '/rubrics',          label: 'Add Rubrics' },
  { to: '/grading',          label: 'Grading' },
  { to: '/users',            label: 'Manage Users' },
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

  const isStudent = user?.role === 'student';
  const links = isStudent ? STUDENT_LINKS : ADMIN_LINKS;
  // display_name comes from JWT payload (backend signToken includes display_name)
  const displayName = user?.display_name || user?.email || 'User';

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
          {user?.role && <span style={{ opacity:0.7, fontSize:11, marginLeft:8 }}>({user.role})</span>}
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
          <span>▶</span>
        </button>
      </div>

      <div className="sidebar-copyright">
        © 2025 Faculty of Medicine<br />
        University of Kelaniya, Sri Lanka.<br />
        All rights reserved.
      </div>
    </div>
  );
}
