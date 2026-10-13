import react from '@vitejs/plugin-react';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** This build: an id and the time it was made (shown in the app, and in /version.json to spot newer builds). */
const BUILT_AT = new Date().toISOString();
const BUILD_ID = Date.now().toString(36);

/** Writes /version.json so a running copy of the app can tell when a newer version is online. */
function versionFile(): Plugin {
  return {
    name: 'pianist-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID, builtAt: BUILT_AT }) });
    },
  };
}

/** Files in public/ (copied as-is), as site paths. */
function publicFiles(dir = 'public', base = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? publicFiles(full, `${base}/${name}`) : [`${base}/${name}`];
  });
}

/**
 * Writes sw.js with the exact list of built files, so the whole app (including the note
 * detector model) works offline after the first visit.
 */
function serviceWorker(): Plugin {
  return {
    name: 'pianist-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = [
        '/',
        ...Object.keys(bundle)
          .filter((f) => f !== 'version.json')
          .map((f) => `/${f}`),
        ...publicFiles().filter((f) => !f.endsWith('LICENSE') && !f.endsWith('NOTICE')),
      ];
      const version = BUILD_ID;
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `// Generated at build time.
const VERSION = '${version}';
const APP = 'pianist-app-' + VERSION;
const SAMPLES = 'pianist-samples-v1';
const PRECACHE = ${JSON.stringify([...new Set(files)])};

// The page asks a waiting new version to take over straight away.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP).then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url)))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pianist-app-') && k !== APP).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Always ask the server which version is newest.
  if (url.pathname === '/version.json') return;
  // Piano samples: keep them once downloaded.
  if (url.hostname === 'tonejs.github.io') {
    event.respondWith(
      caches.open(SAMPLES).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Pages: network first so updates arrive, the cached app when offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/').then((r) => r || caches.match('/index.html'))));
    return;
  }
  // Built files have hashed names: cache first.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(APP).then((cache) => cache.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker(), versionFile()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __BUILT_AT__: JSON.stringify(BUILT_AT),
  },
  server: { host: true, port: 5180, strictPort: true },
  preview: { host: true, port: 4180, strictPort: true },
  build: { chunkSizeWarningLimit: 4000 },
  // Lazily imported libraries, pre-bundled so the dev server doesn't reload the page on first use.
  optimizeDeps: { include: ['@spotify/basic-pitch', '@tensorflow/tfjs', 'opensheetmusicdisplay', '@tonejs/midi'] },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
