import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  try {
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return new Response('Unauthorized', { status: 401 });

    // Verify the user sending the request
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user?.email) return new Response('Unauthorized', { status: 401 });
    const email = user.email.toLowerCase();

    // Restrict to you
    let ok = email === 'me@chrismcarthur.co.uk';
    if (!ok) {
      const { data: player } = await supabaseAdmin
        .from('players').select('display_name').eq('email', email).maybeSingle();
      ok = player?.display_name === 'Kinish';
    }
    if (!ok) return new Response('Forbidden', { status: 403 });

    const { year, week, home, away, home_score, away_score } = await req.json();

    const { error } = await supabaseAdmin.rpc('set_final_score', {
      p_year: year, p_week_number: week,
      p_home_short: home, p_away_short: away,
      p_home_score: home_score, p_away_score: away_score,
    });
    if (error) return new Response(error.message, { status: 400 });

    return new Response('ok');
  } catch (e: any) {
    return new Response(e?.message ?? 'Server error', { status: 500 });
  }
}
