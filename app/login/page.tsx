'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then((s) => {
      const em = s.data.session?.user.email ?? null;
      setMe(em);
      if (em) router.replace('/');
    });
  }, [router]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError('Incorrect email or password');
      setLoading(false);
    } else {
      router.replace('/');
    }
  }

  if (me) return null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="text-4xl">🏈</div>
          <h1 className="text-2xl font-bold tracking-tight">Against The Spread</h1>
          <p className="text-sm text-zinc-400">BD · PuD · K</p>
        </div>

        <form onSubmit={signIn} className="space-y-3">
          <input
            type="email"
            className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            type="password"
            className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          {error && (
            <p className="text-sm text-rose-400 text-center">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}