import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Landing from './pages/Landing.jsx';
import Dashboard from './pages/Dashboard.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(u => { setUser(u); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0a0a' }}>
      <div style={{ width: 32, height: 32, border: '2px solid #333', borderTop: '2px solid #c8ff00', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/dashboard" /> : <Landing />} />
      <Route path="/dashboard" element={user ? <Dashboard user={user} setUser={setUser} /> : <Navigate to="/" />} />
    </Routes>
  );
}
