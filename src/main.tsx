import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support and installing as an app (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // Registered once the page is idle, so caching the app for offline use doesn't slow down the first visit.
  window.addEventListener('load', () => {
    const register = () => navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service worker not registered', err));
    if ('requestIdleCallback' in window) requestIdleCallback(register, { timeout: 4000 });
    else setTimeout(register, 2000);
  });
}
