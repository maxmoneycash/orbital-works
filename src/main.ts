import './styles/global.css';
import { mount } from 'svelte';
import { inject } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';
import Overlay from './ui/Overlay.svelte';
import { App } from './app';
import { initTheme } from './ui/shared/theme';

/**
 * Analytics. Without this there is no way to tell whether the share loop
 * actually turns — whether a shared link brings anyone in, and whether they
 * design something of their own once they arrive. Both no-op on localhost and
 * on any deployment where the feature is switched off.
 */
inject();
injectSpeedInsights();

// Initialize theme palette (reads CSS custom properties for canvas code)
initTheme();

// Mount Svelte UI overlay
mount(Overlay, { target: document.getElementById('svelte-ui')! });

// Start Three.js engine
const app = new App();
app.init();

// ── Service Worker registration ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' });
  });
}
