import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client.js';
import { useAuth } from '../store/auth.js';
import { prettySkill } from '../components/Fit.jsx';

export default function Profile() {
  const { user, setUser } = useAuth();
  const [skills, setSkills] = useState(() => (user?.profile?.skills ?? []).map((s) => s.name));
  const [newSkill, setNewSkill] = useState('');
  const [experienceMonths, setExperienceMonths] = useState(user?.profile?.experienceMonths ?? 0);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const { user: updated } = await api.updateProfile({
        skills,
        experienceMonths: Number(experienceMonths),
      });
      setUser(updated);
      setStatus({ kind: 'ok', message: 'Saved. Your feed will re-rank on the next load.' });
    } catch (err) {
      setStatus({ kind: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl py-6">
      <h1 className="text-lg font-semibold">Your profile</h1>
      <p className="mt-1 text-sm text-ink-soft">{user?.email}</p>

      <section className="mt-6">
        <p className="label">
          Skills
          {user?.profile?.resumeFilename && (
            <span className="ml-2 normal-case tracking-normal text-ink-muted">
              from {user.profile.resumeFilename}
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {skills.map((skill) => (
            <button key={skill} type="button"
              onClick={() => setSkills(skills.filter((s) => s !== skill))}
              className="chip border-brand/25 bg-brand-soft text-brand-dark hover:border-brand/60">
              {prettySkill(skill)} <span aria-hidden="true" className="opacity-50">&times;</span>
            </button>
          ))}
        </div>

        <form className="mt-3 flex gap-2" onSubmit={(e) => {
          e.preventDefault();
          const value = newSkill.trim().toLowerCase();
          if (value && !skills.includes(value)) setSkills([...skills, value]);
          setNewSkill('');
        }}>
          <input className="input" placeholder="Add a skill" value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)} />
          <button type="submit" className="btn-ghost shrink-0">Add</button>
        </form>
      </section>

      <section className="mt-6">
        <label className="label" htmlFor="exp">Months of experience</label>
        <input id="exp" type="number" min="0" max="120" className="input w-32"
          value={experienceMonths} onChange={(e) => setExperienceMonths(e.target.value)} />
      </section>

      {status && (
        <p className={`mt-4 rounded-chip px-3 py-2 text-sm ${
          status.kind === 'ok' ? 'bg-brand-soft text-brand-dark' : 'bg-amber-50 text-amber-900'
        }`}>
          {status.message}
        </p>
      )}

      <div className="mt-6 flex gap-3">
        <button type="button" className="btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <Link to="/onboarding" className="btn-ghost">Re-upload résumé</Link>
      </div>
    </div>
  );
}
