/**
 * Share-link codec for generated designs.
 *
 * A design is small — a name, an orbit, a list of catalogue ids, and one or two
 * custom parts — so the whole thing fits in a URL once gzipped. That means a
 * share link needs no database and no account: the link *is* the storage.
 * Anyone who opens it re-renders the same spacecraft from the same parts list.
 *
 * Only the fields that reconstruct the vehicle travel. The streamed display
 * text is dropped, and `libraryParts` are just ids — the catalogue lives in the
 * app, so a 15-part design costs about as many bytes as its name.
 *
 * Framework-free, isomorphic: the browser encodes, and the OG-image function
 * decodes on the server.
 */
import type { Design } from './design-parts';

/** Bump when the payload shape changes so old links fail loudly rather than half-render. */
const VERSION = 1;

/** URL-safe base64 — the standard alphabet's +/= are all unsafe in a query string. */
function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  // btoa/atob are global in browsers and in Node 16+, so one path covers both.
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The wire shape. Deliberately short keys — this is the one place where a few
 * bytes per field is worth the loss in readability, because it rides in a URL
 * that people paste into chat clients with length limits.
 */
interface Wire {
  v: number;
  n: string;  // name
  o: string;  // operator
  m: string;  // missionClass
  a: number;  // altKm
  i: number;  // incDeg
  b: string;  // blurb
  r: string;  // rationale
  l: string[]; // libraryParts
  c: unknown[]; // customParts
}

export async function encodeDesign(d: Design): Promise<string> {
  const wire: Wire = {
    v: VERSION,
    n: d.name, o: d.operator, m: d.missionClass,
    a: d.altKm, i: d.incDeg, b: d.blurb, r: d.rationale,
    l: d.libraryParts, c: d.customParts,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(wire));
  return toBase64Url(await gzip(bytes));
}

/** Returns null rather than throwing — a mangled link is a normal thing to receive. */
export async function decodeDesign(s: string): Promise<Design | null> {
  try {
    const json = new TextDecoder().decode(await gunzip(fromBase64Url(s)));
    const w = JSON.parse(json) as Wire;
    if (w.v !== VERSION) return null;
    return {
      name: w.n, operator: w.o, missionClass: w.m,
      altKm: w.a, incDeg: w.i, blurb: w.b, rationale: w.r,
      libraryParts: Array.isArray(w.l) ? w.l : [],
      customParts: (Array.isArray(w.c) ? w.c : []) as Design['customParts'],
    };
  } catch {
    return null;
  }
}
