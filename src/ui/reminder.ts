import { useEffect } from 'react';
import type { Day } from '../store/db';
import { dayKey } from '../store/db';
import { loadPref, savePref, useSettings } from '../store/settings';

/**
 * Practice reminder: at the chosen time, if today's goal isn't reached yet, a notification (or, when
 * notifications aren't allowed, a banner in the app). Browsers only allow this while Pianist is open
 * (a tab or the installed app); there is no server to send reminders when it is closed.
 */
export function useReminder(days: Day[]): void {
  const s = useSettings();
  useEffect(() => {
    if (!s.reminder.on) return;
    const check = () => {
      const today = dayKey();
      if (loadPref('reminded', '') === today) return;
      const [h, m] = s.reminder.time.split(':').map(Number);
      const now = new Date();
      if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
      const done = (days.find((d) => d.date === today)?.seconds ?? 0) / 60;
      if (done >= s.dailyGoalMin) return;
      savePref('reminded', today);
      const text = `Time to practise: ${Math.round(done)} of ${s.dailyGoalMin} minutes so far today.`;
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Pianist', { body: text, icon: '/icons/icon-192.png' });
      } else {
        window.dispatchEvent(new CustomEvent('pianist-reminder', { detail: text }));
      }
    };
    check();
    const t = window.setInterval(check, 60_000);
    return () => window.clearInterval(t);
  }, [s.reminder.on, s.reminder.time, s.dailyGoalMin, days]);
}
