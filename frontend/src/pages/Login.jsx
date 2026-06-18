import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import { homeForRole } from '../utils/roles';

export default function LoginPage() {
  const { user, login, universityLogin } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('university');
  const [email, setEmail] = useState('');
  const [netId, setNetId] = useState('');
  const [userType, setUserType] = useState('student');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (mode === 'local' && (!email || !password)) {
      setError('Please fill in all fields.');
      return;
    }
    if (mode === 'university' && (!netId || !password)) {
      setError('Please enter your Net ID and password.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const data = mode === 'university'
        ? await universityLogin({ userType, netId, password })
        : await login(email, password);
      const role = data?.user?.role || data?.role;
      navigate(homeForRole(role));
    } catch (err) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-brand-logo">
            <img src="/images/logo.png" alt="Logo" />
          </div>
          <h2>AI Assignment Grading System</h2>
          <p>Faculty of Medicine<br />University of Kelaniya, Sri Lanka</p>
        </div>

        <div className="login-form-side">
          <h3>Welcome Back</h3>
          <p>Sign in to your account to continue</p>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="login-tabs">
            <button
              type="button"
              className={`login-tab${mode === 'university' ? ' active' : ''}`}
              onClick={() => { setMode('university'); setError(''); }}
            >
              University Login
            </button>
            <button
              type="button"
              className={`login-tab${mode === 'local' ? ' active' : ''}`}
              onClick={() => { setMode('local'); setError(''); }}
            >
              Local Login
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {mode === 'university' ? (
              <>
                <div className="login-field">
                  <label htmlFor="userType">User Type</label>
                  <select
                    id="userType"
                    className="login-input"
                    value={userType}
                    onChange={e => setUserType(e.target.value)}
                  >
                    <option value="student">Student</option>
                    <option value="staff">Staff / Lecturer / Head</option>
                  </select>
                </div>
                <div className="login-field">
                  <label htmlFor="netId">Net ID</label>
                  <input
                    id="netId"
                    type="text"
                    className="login-input"
                    placeholder="e.g. mf_fw_test or rmcra261"
                    value={netId}
                    onChange={e => setNetId(e.target.value)}
                    autoComplete="username"
                  />
                  <div className="login-help">Use your university Net ID, not full email address.</div>
                </div>
              </>
            ) : (
              <div className="login-field">
                <label htmlFor="email">Email Address</label>
                <input
                  id="email"
                  type="email"
                  className="login-input"
                  placeholder="Enter your local account email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
            )}

            <div className="login-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="login-input"
                placeholder="Enter your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading
                ? 'Signing in...'
                : mode === 'university'
                  ? 'Login with University Account'
                  : 'Sign In Locally'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
