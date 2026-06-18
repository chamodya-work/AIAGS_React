import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api/api';
import { normalizeRole, roleLabel } from '../utils/roles';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  const normalizeUser = (data) => {
    const u = data?.user || data;
    if (!u) return null;
    const role = normalizeRole(u.role);
    return { ...u, role, role_label: u.role_label || roleLabel(role) };
  };

  useEffect(() => {
    const token = localStorage.getItem('aigs_token');
    if (token) {
      api.auth.me()
        .then(data => {
          setUser(normalizeUser(data));
        })
        .catch(() => {
          localStorage.removeItem('aigs_token');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const data = await api.auth.login(email, password);
    localStorage.setItem('aigs_token', data.token);
    const u = normalizeUser(data);
    setUser(u);
    return data;
  };

  const universityLogin = async ({ userType, netId, password }) => {
    const data = await api.auth.universityLogin({ userType, netId, password });
    localStorage.setItem('aigs_token', data.token);
    const u = normalizeUser(data);
    setUser(u);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('aigs_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, universityLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
