'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then((s) => setMe(s.data.session?.user.email ?? null));
  }, []);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) alert(error.message);
    else setSent(true);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setMe(null);
  }

  if (me) {
    return (
      <div className="max-w-sm mx-auto p-6 space-y-4">
        <p>
          Signed in as <b>{me}</b>
        </p>
        <Link className="underline" href="/">Go to draft</Link>
        <button onClick={signOut} className="block px-3 py-2 rounded border mt-3">
          Sign out
        </button>
      </div>
    );
  }

  if (sent) return <div className="max-w-sm mx-auto p-6">Check your email for the login link.</div>;

  return (
    <form onSubmit={sendLink} className="max-w-sm mx-auto p-6 space-y-3">
      <h1 className="text-xl font-semibold">Login</h1>
      <input
        type="email"
        className="w-full border rounded p-2"
        placeholder="you@domain"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <button className="px-4 py-2 rounded bg-black text-white">Send magic link</button>
    </form>
  );
}
