import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client.js';
import { useAuth } from '../store/auth.js';
import { prettySkill } from '../components/Fit.jsx';

/**
 * The magic moment.
 *
 * Drop a PDF, watch your own skills appear as editable pills, fix the two the
 * parser got wrong, set three preferences, done. This is the thirty seconds
 * that sells the product, so it gets no spinner-only states and no dead ends.
 *
 * The pills are editable on purpose. Parsing is good, not perfect, and letting
 * the student correct it in two clicks is both a better product and the honest
 * answer when a judge's own résumé parses badly on stage.
 */
export default function Onboarding() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const fileInput = useRef(null);

  const [stage, setStage] = useState(user?.profile?.hasResume ? 'review' : 'upload');
  const [skills, setSkills] = useState(() => (user?.profile?.skills ?? []).map((s) => s.name));
  const [prefs, setPrefs] = useState({
    locations: (user?.profile?.preferences?.locations ?? []).join(', '),
    remoteOk: user?.profile?.preferences?.remoteOk ?? true,
    minStipend: user?.profile?.preferences?.minStipend ?? '',
  });
  const [newSkill, setNewSkill] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [summary, setSummary] = useState(null);

  const handleFile = async (file) => {
    if (!file) return;
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Upload a PDF, JPG, PNG, or WEBP résumé.');
      return;
    }

    setBusy(true);
    setError(null);
    setStage('parsing');
    try {
      const result = await api.uploadResume(file);
      setUser(result.user);
      setSkills(result.user.profile.skills.map((s) => s.name));
      setSummary(result.parsed);
      setStage('review');
    } catch (err) {
      setError(err.status === 503
        ? 'Résumé scanning is unavailable right now. Enter your skills manually below.'
        : err.message);
      setStage('review');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { user: updated } = await api.updateProfile({
        skills,
        preferences: {
          locations: prefs.locations.split(',').map((s) => s.trim()).filter(Boolean),
          remoteOk: prefs.remoteOk,
          minStipend: prefs.minStipend === '' ? null : Number(prefs.minStipend),
        },
      });
      setUser(updated);
      navigate('/feed');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------- upload */
  if (stage === 'upload' || stage === 'parsing') {
    return (
      <div className="mx-auto max-w-xl py-10">
        <h1 className="text-lg font-semibold">Upload your résumé</h1>
        <p className="mt-1 text-sm text-ink-soft">
          We read it once to find your skills. You can edit everything on the next screen.
        </p>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
          className={`mt-6 rounded-card border-2 border-dashed p-10 text-center transition-colors ${
            dragging ? 'border-brand bg-brand-soft' : 'border-paper-rule bg-paper-card'
          }`}
        >
          {stage === 'parsing' ? (
            <div>
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-paper-rule border-t-brand" />
              <p className="mt-4 text-sm font-medium">Reading your résumé…</p>
              <p className="mt-1 text-xs text-ink-muted">
                Extracting skills, education and experience. About five seconds.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm font-medium">Drop your résumé here</p>
              <p className="mt-1 text-xs text-ink-muted">or</p>
              <button type="button" className="btn-primary mt-3"
                onClick={() => fileInput.current?.click()}>
                Choose a file
              </button>
              <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])} />
              <p className="mt-4 text-xs text-ink-muted">PDF, JPG, PNG, or WEBP, up to 8&nbsp;MB.</p>
            </>
          )}
        </div>

        {error && (
          <div className="card mt-4 border-amber-300/60 bg-amber-50 p-4">
            <p className="text-sm text-amber-900">{error}</p>
            <button type="button" className="mt-2 text-sm text-brand hover:underline"
              onClick={() => { setError(null); setStage('review'); }}>
              Enter my skills manually instead
            </button>
          </div>
        )}

        <button type="button" className="mt-4 text-sm text-ink-muted hover:text-ink"
          onClick={() => setStage('review')}>
          Skip &mdash; I&rsquo;ll type my skills
        </button>
      </div>
    );
  }

  /* ------------------------------------------------------------- review */
  return (
    <div className="mx-auto max-w-xl py-10">
      <h1 className="text-lg font-semibold">Check what we found</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {summary
          ? `Found ${summary.skillCount} skills in ${summary.charCount.toLocaleString()} characters. Remove anything wrong, add anything missing.`
          : 'Add the skills you have. Remove anything that does not belong.'}
      </p>

      {summary?.degraded && (
        <p className="mt-3 rounded-chip bg-amber-50 px-3 py-2 text-xs text-amber-900">
          The semantic model is offline, so matching is running on keywords only.
          Scores will be less accurate until it is back.
        </p>
      )}

      <section className="mt-6">
        <p className="label">Your skills</p>
        <div className="flex flex-wrap gap-1.5">
          {skills.map((skill) => (
            <button
              key={skill}
              type="button"
              onClick={() => setSkills(skills.filter((s) => s !== skill))}
              className="chip border-brand/25 bg-brand-soft text-brand-dark hover:border-brand/60"
              title={`Remove ${prettySkill(skill)}`}
            >
              {prettySkill(skill)}
              <span aria-hidden="true" className="opacity-50">&times;</span>
              <span className="sr-only">Remove</span>
            </button>
          ))}
          {!skills.length && (
            <p className="text-sm text-ink-muted">
              Nothing yet &mdash; add your first skill below.
            </p>
          )}
        </div>

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = newSkill.trim().toLowerCase();
            if (value && !skills.includes(value)) setSkills([...skills, value]);
            setNewSkill('');
          }}
        >
          <input className="input" placeholder="Add a skill, e.g. docker" value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)} />
          <button type="submit" className="btn-ghost shrink-0">Add</button>
        </form>
      </section>

      <section className="mt-8 space-y-4">
        <p className="label">Where you want to work</p>

        <div>
          <input className="input" placeholder="Bengaluru, Pune, Hyderabad"
            value={prefs.locations}
            onChange={(e) => setPrefs({ ...prefs, locations: e.target.value })} />
          <p className="mt-1 text-xs text-ink-muted">Comma separated. Leave blank for anywhere.</p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={prefs.remoteOk}
            onChange={(e) => setPrefs({ ...prefs, remoteOk: e.target.checked })} />
          Include remote roles
        </label>

        <div>
          <label className="label" htmlFor="stipend">Minimum stipend (₹/month)</label>
          <input id="stipend" type="number" min="0" step="1000" className="input"
            placeholder="No minimum" value={prefs.minStipend}
            onChange={(e) => setPrefs({ ...prefs, minStipend: e.target.value })} />
        </div>
      </section>

      {error && (
        <p role="alert" className="mt-4 rounded-chip bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {error}
        </p>
      )}

      <div className="mt-8 flex gap-3">
        <button type="button" className="btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Show my matches'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setStage('upload')}>
          Upload a different résumé
        </button>
      </div>
    </div>
  );
}
