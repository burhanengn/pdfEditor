import { useState, type FormEvent } from 'react';
import { Lock, X } from 'lucide-react';
import { submitPasswordUnlock } from '@/engine/documentController';
import { useEditorStore } from '@/store/useEditorStore';

export function PasswordModal() {
  const passwordPrompt = useEditorStore((s) => s.passwordPrompt);
  const setPasswordPrompt = useEditorStore((s) => s.setPasswordPrompt);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!passwordPrompt) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    try {
      await submitPasswordUnlock(password);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="password-modal-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="password-modal-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                Password Required
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {passwordPrompt.fileName} is encrypted
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setPassword('');
              setPasswordPrompt(null);
            }}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Close password modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="pdf-password-input"
              className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Document Password
            </label>
            <input
              id="pdf-password-input"
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter PDF password…"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            {passwordPrompt.invalidAttempt && (
              <p className="mt-1.5 text-xs font-medium text-red-500" data-testid="password-error">
                Incorrect password. Please try again.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setPassword('');
                setPasswordPrompt(null);
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!password || submitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {submitting ? 'Decrypting…' : 'Unlock PDF'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
