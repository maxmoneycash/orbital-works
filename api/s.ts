/**
 * Share landing page.
 *
 * A static SPA can't vary its og: tags per design, so a share link points here
 * instead of at the app. This returns a small HTML document carrying the tags a
 * crawler needs, then sends a human straight on to the app with the design
 * still encoded in the URL.
 *
 * The redirect is a <meta refresh> plus a script rather than a 302 because a
 * 302 would bounce the crawler too, and it would never read the tags.
 */
import { decodeDesign } from '../src/data/design-share.js';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    const encoded = url.searchParams.get('d') || '';
    const origin = url.origin;

    const design = encoded ? await decodeDesign(encoded) : null;
    const title = design ? `${design.name} — Orbital Works` : 'Orbital Works';
    const description = design
      ? `${design.operator} · ${design.missionClass} · ${Math.round(design.altKm)} km. ${design.blurb}`.slice(0, 300)
      : 'Describe a mission and get a spacecraft that closes its own mass and power budgets.';
    const image = `${origin}/api/og${encoded ? `?d=${encodeURIComponent(encoded)}` : ''}`;
    const target = `${origin}/${encoded ? `?d=${encodeURIComponent(encoded)}` : ''}`;

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(`${origin}/s${encoded ? `?d=${encodeURIComponent(encoded)}` : ''}`)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<link rel="canonical" href="${esc(target)}">
<style>
  html,body{height:100%;margin:0;background:#0a0d10;color:#7d8f9c;
    font-family:'Overpass Mono',ui-monospace,monospace;
    display:flex;align-items:center;justify-content:center}
</style>
</head>
<body>
<p>Opening ${esc(design ? design.name : 'Orbital Works')}… <a href="${esc(target)}" style="color:#4ec07a">continue</a></p>
<script>location.replace(${JSON.stringify(target)})</script>
</body>
</html>`;

    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Shared links are immutable — the design is in the URL — so let the
        // CDN and crawlers keep them.
        'cache-control': 'public, max-age=3600, s-maxage=86400',
      },
    });
  },
};
