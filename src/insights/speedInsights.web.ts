/**
 * Vercel Speed Insights for the web build (https://vercel.com/docs/speed-insights).
 *
 * Loads Vercel's own script from /_vercel/speed-insights/script.js, which Vercel serves on
 * every deployment where Speed Insights is enabled in the project dashboard. This is the
 * plain-HTML setup from Vercel's docs, so no extra npm package is needed. It reports page
 * load and interaction timings only; nothing about the user's fields or photos.
 */
declare global {
  interface Window {
    si?: (...args: unknown[]) => void;
    siq?: unknown[][];
  }
}

let started = false;

export function startSpeedInsights(): void {
  if (started || typeof window === 'undefined' || typeof document === 'undefined') return;
  started = true;
  // Queue calls made before the script arrives, as in Vercel's snippet.
  window.si =
    window.si ||
    function (...args: unknown[]) {
      (window.siq = window.siq || []).push(args);
    };
  const script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/speed-insights/script.js';
  document.head.appendChild(script);
}
