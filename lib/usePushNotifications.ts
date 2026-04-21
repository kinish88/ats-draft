'use client';

import { useEffect, useState } from 'react';

export function usePushNotifications(playerName: string | null) {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    setSupported('serviceWorker' in navigator && 'PushManager' in window);
  }, []);

  async function subscribe() {
    if (!supported || !playerName) return;
    setSubscribing(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
      const sub = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });

      await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), player_name: playerName }),
      });
      setSubscribed(true);
    } catch (err) {
      console.error('Push subscribe failed:', err);
    }
    setSubscribing(false);
  }

  useEffect(() => {
    if (!supported || !playerName) return;
    if (Notification.permission === 'granted') subscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, playerName]);

  return { supported, subscribed, subscribing, subscribe };
}