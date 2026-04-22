import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// This route is called by Vercel Cron — it just proxies to poll-scores
// Vercel sets the CRON_SECRET env var automatically
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? `https://${req.headers.get('host')}`
    : 'http://localhost:3000';

  const resp = await fetch(`${base}/api/poll-scores`, { cache: 'no-store' });
  const data = await resp.json();
  return NextResponse.json(data);
}
