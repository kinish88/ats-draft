import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Admin trigger — just calls poll-scores directly
export async function POST(req: NextRequest) {
  try {
    const base = `https://${req.headers.get('host')}`;
    const resp = await fetch(`${base}/api/poll-scores`, { cache: 'no-store' });
    const data = await resp.json();
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
