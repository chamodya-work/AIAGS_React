import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('aigs_token');
    if (token) {
      api.auth.me()
        .then(data => {
          // Backend /me returns { user: { user_id, role, email, display_name, stdNo? } }
          setUser(data.user || data);
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
    // Backend returns { token, user: { user_id, role, email, display_name, stdNo? } }
    const u = data.user || data;
    setUser(u);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('aigs_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
