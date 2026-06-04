import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { homeForRole } from '../utils/roles';

export default function AccessDenied() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <>
      <h1 className="page-title">Access Denied</h1>
      <div className="content-card">
        <div className="alert alert-error">
          You do not have permission to access this page.
        </div>
        <button className="btn btn-primary" onClick={() => navigate(homeForRole(user?.role))}>
          Go to Dashboard
        </button>
      </div>
    </>
  );
}
