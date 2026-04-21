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
      const sub = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        ),
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

  // Auto-subscribe if permission already granted
  useEffect(() => {
    if (!supported || !playerName) return;
    if (Notification.permission === 'granted') subscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, playerName]);

  return { supported, subscribed, subscribing, subscribe };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}
