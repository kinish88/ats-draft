// Supabase Edge Function — fires when a pick is inserted
// Deploy with: supabase functions deploy send-pick-notification

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = 'mailto:me@chrismcarthur.co.uk';

async function sendWebPush(subscription: PushSubscription, payload: object) {
  // Use web-push via npm CDN
  const webpush = await import('https://esm.sh/web-push@3.6.7');
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}

Deno.serve(async (req) => {
  const { record, next_player } = await req.json();

  if (!next_player) {
    return new Response('No next_player', { status: 200 });
  }

  // Fetch push subscription for next player
  const { data } = await supabase
    .from('push_subscriptions')
    .select('subscription')
    .eq('player_name', next_player)
    .maybeSingle();

  if (!data?.subscription) {
    return new Response('No subscription found', { status: 200 });
  }

  const sub = JSON.parse(data.subscription);
  const pickedBy = record?.player_display_name ?? 'Someone';
  const team = record?.team_short ?? 'a team';

  await sendWebPush(sub, {
    title: '🏈 Your pick!',
    body: `${pickedBy} just picked ${team} — you're on the clock!`,
    url: '/draft',
  });

  return new Response('Sent', { status: 200 });
});
