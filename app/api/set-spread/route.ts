import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return new Response('Unauthorized', { status: 401 });

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user?.email) return new Response('Unauthorized', { status: 401 });
    const email = user.email.toLowerCase();

    let ok = email === 'me@chrismcarthur.co.uk';
    if (!ok) {
      const { data: player } = await supabaseAdmin
        .from('players').select('display_name').eq('email', email).maybeSingle();
      ok = player?.display_name === 'Kinish';
    }
    if (!ok) return new Response('Forbidden', { status: 403 });

    const { pick_id, home, away, team, spread } = await req.json();

    const { error } = await supabaseAdmin.rpc('admin_replace_spread_pick_by_id', {
      p_pick_id: pick_id,
      p_home_short: home, p_away_short: away,
      p_team_short: team, p_spread: spread,
    });
    if (error) return new Response(error.message, { status: 400 });

    return new Response('ok');
  } catch (e: any) {
    return new Response(e?.message ?? 'Server error', { status: 500 });
  }
}
