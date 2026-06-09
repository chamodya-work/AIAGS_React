import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { hasRole } from '../utils/roles';

export default function ProtectedRoute({ roles }) {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;
  if (roles?.length && !hasRole(user, roles)) {
    return <Navigate to="/access-denied" replace />;
  }

  return <Outlet />;
}
