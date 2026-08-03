import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { InlineMessage, Spinner } from '../components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Login failed. Try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue via-cyan to-emerald text-2xl text-ink shadow-[0_4px_24px_rgba(34,211,238,0.4)]">
            ✦
          </span>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-gradient">
            Intellix
          </h1>
          <p className="mt-1 text-sm text-muted">
            Sign in to the AI orchestration console
          </p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-line bg-surface p-6"
        >
          <label className="mb-1.5 block text-sm font-semibold text-muted">
            Email
          </label>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mb-4 w-full rounded-lg border border-line bg-ink px-3 py-2.5 text-sm outline-none focus:border-blue"
            placeholder="admin@example.com"
          />
          <label className="mb-1.5 block text-sm font-semibold text-muted">
            Password
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mb-5 w-full rounded-lg border border-line bg-ink px-3 py-2.5 text-sm outline-none focus:border-blue"
            placeholder="••••••••"
          />
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue px-4 py-2.5 text-sm font-bold text-inktext transition-colors hover:bg-blue/80 disabled:opacity-60"
          >
            {loading && <Spinner className="h-4 w-4" />}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <InlineMessage message={error} tone="error" />
        </form>
      </div>
    </div>
  );
}
