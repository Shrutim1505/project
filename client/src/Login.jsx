import React, { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('student');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [demoKey, setDemoKey] = useState('');

  const demoAccounts = [
    { key: 'alice', label: 'Alice (student)', email: 'alice@example.com', password: 'password' },
    { key: 'bob', label: 'Bob (student)', email: 'bob@example.com', password: 'password' },
    { key: 'ta', label: 'TA Tim', email: 'ta@example.com', password: 'password' },
    { key: 'admin', label: 'Admin Ada', email: 'admin@example.com', password: 'admin' }
  ];

  function validateLogin(emailVal, passwordVal) {
    if (!emailVal) return 'Email is required';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailVal)) return 'Enter a valid email';
    if (!passwordVal) return 'Password is required';
    // Be flexible for demo accounts (some use short passwords)
    if (passwordVal.length < 4) return 'Password must be at least 4 characters';
    return '';
  }

  function validateRegister(nameVal, emailVal, passwordVal) {
    if (!nameVal) return 'Name is required';
    if (!emailVal) return 'Email is required';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailVal)) return 'Enter a valid email';
    if (!passwordVal) return 'Password is required';
    if (passwordVal.length < 4) return 'Password must be at least 4 characters';
    return '';
  }

  async function doLogin(emailArg, passwordArg) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailArg, password: passwordArg })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Login failed');
        setLoading(false);
        return false;
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      onLogin({ token: data.token, user: data.user });
      return true;
    } catch (err) {
      setError('Network error');
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function doRegister(nameArg, emailArg, passwordArg, roleArg) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameArg, email: emailArg, password: passwordArg, role: roleArg })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Register failed');
        setLoading(false);
        return false;
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      onLogin({ token: data.token, user: data.user });
      return true;
    } catch (err) {
      setError('Network error');
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (mode === 'login') {
      const v = validateLogin(email, password);
      if (v) return setError(v);
      await doLogin(email, password);
    } else {
      const v = validateRegister(name, email, password);
      if (v) return setError(v);
      await doRegister(name, email, password, role);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="logo-mark" />
          <div className="brand-text">Lab Resource Scheduler</div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button className={`btn ${mode === 'login' ? 'primary' : ''}`} onClick={() => setMode('login')}>Sign in</button>
          <button className={`btn ${mode === 'register' ? 'primary' : ''}`} onClick={() => setMode('register')}>Register</button>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && <div className="form-error">{error}</div>}

          {mode === 'register' && (
            <div className="form-group">
              <label>Name</label>
              <input className="input" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
            </div>
          )}

          <div className="form-group">
            <label>Email</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@school.edu" />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
          </div>

          {mode === 'register' && (
            <div className="form-group">
              <label>Role</label>
              <select className="select" value={role} onChange={e => setRole(e.target.value)}>
                <option value="student">Student</option>
                <option value="ta">TA</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button className="btn primary" type="submit" disabled={loading}>
              {loading ? (mode === 'login' ? 'Signing in...' : 'Registering...') : (mode === 'login' ? 'Sign in' : 'Create account')}
            </button>
            <button type="button" className="btn" onClick={() => {
              // quick clear inputs
              setError('');
              setEmail('');
              setPassword('');
              setName('');
            }}>Clear</button>
          </div>

          {/* Demo quick-login - useful for local testing */}
          <div style={{ marginTop: 12 }}>
            <label style={{ display: 'block', marginBottom: 6 }}>Quick demo accounts</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={demoKey} onChange={e => setDemoKey(e.target.value)} className="select">
                <option value="">Choose demo...</option>
                {demoAccounts.map(d => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const d = demoAccounts.find(x => x.key === demoKey);
                  if (!d) return alert('Select a demo account');
                  setEmail(d.email);
                  setPassword(d.password);
                  setMode('login');
                }}
              >
                Use demo
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={async () => {
                  const d = demoAccounts.find(x => x.key === demoKey);
                  if (!d) return alert('Select a demo account');
                  await doLogin(d.email, d.password);
                }}
              >
                Sign in demo
              </button>
            </div>
          </div>
        </form>

        <div className="login-foot">Don't have an account? Use Register or ask your admin.</div>
      </div>
    </div>
  );
}
