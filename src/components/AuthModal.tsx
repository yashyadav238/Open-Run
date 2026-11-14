import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ open, onClose }) => {
  const { signInWithGoogle, signInWithEmail, registerWithEmail, resetPassword } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleGoogle = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await signInWithGoogle();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'reset') {
        await resetPassword(email.trim());
        setMessage('Password reset email sent. Check your inbox.');
      } else if (mode === 'register') {
        if (!name.trim()) {
          setError('Please enter your display name.');
          setSubmitting(false);
          return;
        }
        if (password.length < 6) {
          setError('Password must be at least 6 characters.');
          setSubmitting(false);
          return;
        }
        await registerWithEmail(name.trim(), email.trim(), password);
        setMessage('Account created. Verification email sent—please verify your email to sync data.');
      } else {
        await signInWithEmail(email.trim(), password);
        onClose();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('operation-not-allowed')) {
        setError(
          'Email/Password sign-in is not yet enabled in the Firebase Console. Use Google Sign-In below or enable Email/Password under Authentication > Sign-in method.'
        );
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-[#E5E3DC] bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-[#141F1B]">
              {mode === 'login' ? 'Sign in to TRICITY RUN' : mode === 'register' ? 'Create Runner Account' : 'Reset Password'}
            </h2>
            <p className="mt-0.5 text-xs text-[#5B6B64]">Save routes, track GPS runs, and unlock challenges.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sign in dialog"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-[#5B6B64] hover:bg-[#F6F5F0]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <button
          type="button"
          disabled={submitting}
          onClick={handleGoogle}
          className="mt-5 flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-xl bg-[#172D27] px-4 text-sm font-semibold text-white transition hover:bg-[#30483E] disabled:opacity-60"
        >
          <span>Continue with Google</span>
        </button>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-[#E5E3DC]" />
          <span className="text-xs text-[#5B6B64]">or email</span>
          <div className="h-px flex-1 bg-[#E5E3DC]" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'register' && (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
              className="min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3.5 text-sm focus:border-[#172D27] focus:outline-none"
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            className="min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3.5 text-sm focus:border-[#172D27] focus:outline-none"
          />
          {mode !== 'reset' && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (6+ chars)"
              className="min-h-[44px] w-full rounded-xl border border-[#D9D7CE] px-3.5 text-sm focus:border-[#172D27] focus:outline-none"
            />
          )}

          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>
          )}
          {message && (
            <p className="rounded-xl border border-[#B8E8C7] bg-[#F1FAF4] px-3 py-2 text-xs text-[#172D27]">{message}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] w-full rounded-xl border border-[#172D27] bg-white text-sm font-semibold text-[#172D27] hover:bg-[#F6F5F0] disabled:opacity-60"
          >
            {submitting ? 'Please wait...' : mode === 'login' ? 'Sign in with Email' : mode === 'register' ? 'Create Account' : 'Send Reset Link'}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-xs text-[#5B6B64]">
          {mode !== 'register' ? (
            <button type="button" onClick={() => setMode('register')} className="font-semibold text-[#172D27] hover:underline">
              Create account
            </button>
          ) : (
            <button type="button" onClick={() => setMode('login')} className="font-semibold text-[#172D27] hover:underline">
              Back to sign in
            </button>
          )}
          {mode !== 'reset' && (
            <button type="button" onClick={() => setMode('reset')} className="hover:underline">
              Forgot password?
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
