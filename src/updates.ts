import { useEffect, useState } from 'react';

declare const __BUILD_ID__: string;
declare const __BUILT_AT__: string;

export interface Version {
  id: string;
  builtAt: string; // ISO time
}

/** The version of the app running now. */
export const CURRENT: Version = { id: __BUILD_ID__, builtAt: __BUILT_AT__ };

/** The newest version on the server (null offline, or in development). */
export async function fetchLatest(): Promise<Version | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const v = (await res.json()) as Partial<Version>;
    return v.id && v.builtAt ? { id: v.id, builtAt: v.builtAt } : null;
  } catch {
    return null;
  }
}

const isNewer = (v: Version | null): v is Version => !!v && v.id !== CURRENT.id && Date.parse(v.builtAt) > Date.parse(CURRENT.builtAt);

/** Switches to the newest version: the new service worker takes over, the old cached app is dropped, and the page reloads. */
export async function applyUpdate(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    reg?.waiting?.postMessage('skipWaiting');
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('pianist-app-')).map((k) => caches.delete(k)));
    }
  } catch {
    // A plain reload still fetches the new page.
  }
  location.reload();
}

const RELOADED_KEY = 'pianist.reloadedFor';

/**
 * On opening the app: when a newer version is online, switch to it right away (once per version, so a
 * server that's mid-deploy can't cause a reload loop).
 */
export async function updateOnOpen(): Promise<void> {
  if (import.meta.env.DEV) return;
  const latest = await fetchLatest();
  if (!isNewer(latest)) return;
  try {
    if (sessionStorage.getItem(RELOADED_KEY) === latest.id) return;
    sessionStorage.setItem(RELOADED_KEY, latest.id);
  } catch {
    return;
  }
  await applyUpdate();
}

const CHECK_EVERY_MS = 5 * 60 * 1000;

/** Watches for a newer version while the app stays open (every 5 minutes and whenever it comes back into view). */
export function useLatestVersion(): Version | null {
  const [latest, setLatest] = useState<Version | null>(null);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let alive = true;
    const check = async () => {
      const v = await fetchLatest();
      if (alive && isNewer(v)) setLatest(v);
      // The service worker checks for its own update too.
      navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    const onShow = () => document.visibilityState === 'visible' && void check();
    const onFocus = () => void check();
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  return latest;
}

/** "13 Oct 2026, 18:42" in the viewer's own time zone. */
export function formatBuildTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
