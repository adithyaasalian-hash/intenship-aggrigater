import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import Layout from './components/Layout.jsx';
import { useAuth } from './store/auth.js';

import Auth from './pages/Auth.jsx';
import Detail from './pages/Detail.jsx';
import Feed from './pages/Feed.jsx';
import Insights from './pages/Insights.jsx';
import Landing from './pages/Landing.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Profile from './pages/Profile.jsx';
import Tracker from './pages/Tracker.jsx';

function Protected({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <div className="py-20 text-center text-sm text-ink-muted">Loading…</div>;
  }
  if (status === 'signedOut') {
    // Remember where they were headed so sign-in can send them back.
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }
  return children;
}

export default function App() {
  const bootstrap = useAuth((state) => state.bootstrap);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="auth" element={<Auth />} />
        <Route path="opportunity/:id" element={<Detail />} />

        <Route path="onboarding" element={<Protected><Onboarding /></Protected>} />
        <Route path="feed" element={<Protected><Feed /></Protected>} />
        <Route path="insights" element={<Protected><Insights /></Protected>} />
        <Route path="tracker" element={<Protected><Tracker /></Protected>} />
        <Route path="profile" element={<Protected><Profile /></Protected>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
