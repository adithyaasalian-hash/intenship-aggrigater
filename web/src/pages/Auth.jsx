import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../store/auth.js';

/**
 * Two fields. No email confirmation, no captcha, no password rules beyond a
 * length minimum. Every extra step here is a step you perform on stage while a
 * judge watches, and a step that can fail on venue wifi.
 */
export default function Auth() {
  const { status, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState('register');
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (status === 'signedIn') {
    return <Navigate to={location.state?.from ?? '/onboarding'} replace />;
  }

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        await signUp({ email: form.email, password: form.password, name: form.name || undefined });
        navigate('/onboarding');
      } else {
        await signIn({ email: form.email, password: form.password });
        navigate(location.state?.from ?? '/feed');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-lg font-semibold">
        {mode === 'register' ? 'Create your account' : 'Welcome back'}
      </h1>
      <p className="mt-1 text-sm text-ink-soft">
        {mode === 'register'
          ? 'Two fields, then upload your résumé.'
          : 'Sign in to see your ranked feed.'}
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        {mode === 'register' && (
          <div>
            <label className="label" htmlFor="name">Name (optional)</label>
            <input id="name" className="input" value={form.name} onChange={update('name')}
              autoComplete="name" />
          </div>
        )}

        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" required className="input" value={form.email}
            onChange={update('email')} autoComplete="email" />
        </div>

        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" required minLength={8} className="input"
            value={form.password} onChange={update('password')}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
          {mode === 'register' && (
            <p className="mt-1 text-xs text-ink-muted">At least 8 characters.</p>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-chip bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Working…' : mode === 'register' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <button
        type="button"
        className="mt-4 text-sm text-brand hover:underline"
        onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(null); }}
      >
        {mode === 'register' ? 'I already have an account' : 'Create an account instead'}
      </button>
    </div>
  );
}
