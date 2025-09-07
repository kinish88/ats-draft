import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

type SetSpreadBody = {
  pick_id: number;
  home: string;
  away: string;
  team: string;
  spread: number;
};

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

export async function POST(req: Request): Promise<Response> {
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

    const body = (await req.json()) as SetSpreadBody;

    const { error } = await supabaseAdmin.rpc('admin_replace_spread_pick_by_id', {
      p_pick_id: body.pick_id,
      p_home_short: body.home,
      p_away_short: body.away,
      p_team_short: body.team,
      p_spread: body.spread,
    });
    if (error) return new Response(error.message, { status: 400 });

    return new Response('ok');
  } catch (e: unknown) {
    return new Response(errMsg(e) || 'Server error', { status: 500 });
  }
}
