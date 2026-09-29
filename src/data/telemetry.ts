/**
 * Live telemetry from the SatNOGS ground-station network, via api/telemetry.
 *
 * Each observation is one satellite pass one volunteer station recorded,
 * with the frames it decoded. Most amateur satellites frame their downlink in
 * AX.25, so frames are decoded here to "SOURCE → DEST" callsigns and a
 * payload, which is often plain text (beacons, CSV housekeeping) and
 * otherwise shown as bytes.
 */

export interface TelemetryFrame {
  /** Reception time, ISO UTC. */
  t: string;
  hex: string;
  /** Full frame length; hex may be truncated. */
  length: number;
}

export interface TelemetryObservation {
  id: number;
  satellite: string;
  norad: number;
  station: { name: string; lat: number; lon: number; alt: number };
  start: string;
  end: string;
  maxElevation: number | null;
  mode: string | null;
  baud: number | null;
  transmitter: string | null;
  frequencyHz: number | null;
  tle: [string, string];
  frameCount: number;
  frames: TelemetryFrame[];
  link: string;
}

export interface TelemetryFeed {
  generatedAt: string;
  source: string;
  observations: TelemetryObservation[];
}

export async function fetchTelemetry(signal?: AbortSignal): Promise<TelemetryFeed> {
  const r = await fetch(`${import.meta.env.BASE_URL}api/telemetry`, { signal });
  if (!r.ok) throw new Error(`telemetry ${r.status}`);
  return r.json();
}

export interface DecodedFrame {
  bytes: Uint8Array;
  /** AX.25 source and destination callsigns, when the frame is AX.25. */
  src: string | null;
  dst: string | null;
  /** Bytes after the AX.25 header (or the whole frame). */
  headerLen: number;
  /** The payload as text, when it is mostly printable. */
  text: string | null;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** One 7-byte AX.25 address: six characters shifted left a bit, then the SSID. */
function address(b: Uint8Array, at: number): string | null {
  let call = '';
  for (let i = 0; i < 6; i++) {
    // Callsigns pad with spaces; some satellites pad with zero bytes instead.
    const c = (b[at + i] >> 1) || 32;
    if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || c === 32)) return null;
    call += String.fromCharCode(c);
  }
  call = call.trim();
  if (!call) return null;
  const ssid = (b[at + 6] >> 1) & 0x0f;
  return ssid ? `${call}-${ssid}` : call;
}

function printable(raw: Uint8Array): string | null {
  // Trailing zero padding is not text; count what is left.
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 0) end--;
  const b = raw.subarray(0, end);
  if (b.length < 4) return null;
  let ok = 0, word = 0;
  for (const c of b) {
    if ((c >= 32 && c < 127) || c === 10 || c === 13) ok++;
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) word++;
  }
  if (ok / b.length < 0.85 || word < 4) return null;
  const s = new TextDecoder('latin1').decode(b).replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, '·').trim();
  return s.length >= 4 ? s : null;
}

export function decodeFrame(hex: string): DecodedFrame {
  const bytes = hexToBytes(hex);
  let src: string | null = null, dst: string | null = null, headerLen = 0;
  if (bytes.length >= 16) {
    const d = address(bytes, 0), s = address(bytes, 7);
    if (d && s) {
      dst = d; src = s;
      // Repeater addresses follow until one ends with the extension bit set.
      let at = 13;
      while (!(bytes[at] & 1) && at + 7 < bytes.length) at += 7;
      headerLen = Math.min(bytes.length, at + 1 + 2); // + control + PID
    }
  }
  return { bytes, src, dst, headerLen, text: printable(bytes.subarray(headerLen)) };
}

/** "2 min ago" / "1 h 5 min ago", from now. */
export function ago(iso: string, nowMs = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min ago`;
}
