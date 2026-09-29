/**
 * Live telemetry feed.
 *
 * Recent passes that volunteer SatNOGS ground stations recorded, that the
 * network rated good and that carried decoded frames, each with its frames.
 * SatNOGS' API sends no CORS headers, so a browser can't read it directly;
 * this function reads it once and the edge keeps the answer for 90 seconds,
 * so SatNOGS sees about one request a minute however many people watch.
 *
 * Frames are returned as hex. Decoding (AX.25 addresses, text payloads)
 * happens in the client, in src/data/telemetry.ts.
 */
const API = 'https://network.satnogs.org/api/observations/';
const UA = 'orbital-works (+https://github.com/maxmoneycash/orbital-works)';
const MAX_OBS = 10;
const MAX_FRAMES = 6;
const MAX_BYTES = 256;

interface Observation {
  id: number;
  status: string;
  start: string;
  end: string;
  norad_cat_id: number;
  tle0: string | null;
  tle1: string | null;
  tle2: string | null;
  station_name: string;
  station_lat: number;
  station_lng: number;
  station_alt: number;
  max_altitude: number | null;
  transmitter_mode: string | null;
  transmitter_baud: number | null;
  transmitter_description: string | null;
  transmitter_downlink_low: number | null;
  observation_frequency: number | null;
  demoddata: { payload_demod: string }[];
}

/** "data_15075590_2026-09-29T07-03-06" → the time the frame was received. */
function frameTime(url: string, fallback: string): string {
  const m = url.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z` : fallback;
}

async function frame(url: string, fallback: string) {
  if (/\.(png|jpe?g|gif|wav|ogg)$/i.test(url)) return null;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
  if (!r.ok || /^(image|audio)\//.test(r.headers.get('content-type') || '')) return null;
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!bytes.length) return null;
  const hex = Array.from(bytes.subarray(0, MAX_BYTES), (b) => b.toString(16).padStart(2, '0')).join('');
  return { t: frameTime(url, fallback), hex, length: bytes.length };
}

const json = (body: unknown, status: number, cache: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache, 'Access-Control-Allow-Origin': '*' },
  });

export default {
  async fetch() {
    try {
      const r = await fetch(`${API}?status=good&format=json`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`satnogs ${r.status}`);
      const list = (await r.json()) as Observation[];
      const picked = list
        .filter((o) => o.status === 'good' && o.demoddata?.length && o.tle1 && o.tle2)
        .slice(0, MAX_OBS);

      const observations = await Promise.all(picked.map(async (o) => {
        // Spread the frames across the pass rather than taking one end of it.
        const all = o.demoddata;
        const step = Math.max(1, Math.floor(all.length / MAX_FRAMES));
        const files = all.filter((_, i) => i % step === 0).slice(0, MAX_FRAMES);
        const frames = (await Promise.all(files.map((d) => frame(d.payload_demod, o.end).catch(() => null))))
          .filter((f): f is NonNullable<typeof f> => !!f)
          .sort((a, b) => a.t.localeCompare(b.t));
        return {
          id: o.id,
          satellite: (o.tle0 || '').replace(/^0 /, '').trim() || `NORAD ${o.norad_cat_id}`,
          norad: o.norad_cat_id,
          station: { name: o.station_name, lat: o.station_lat, lon: o.station_lng, alt: o.station_alt },
          start: o.start,
          end: o.end,
          maxElevation: o.max_altitude,
          mode: o.transmitter_mode,
          baud: o.transmitter_baud,
          transmitter: o.transmitter_description,
          frequencyHz: o.observation_frequency ?? o.transmitter_downlink_low,
          tle: [o.tle1, o.tle2],
          frameCount: all.length,
          frames,
          link: `https://network.satnogs.org/observations/${o.id}/`,
        };
      }));

      return json(
        { generatedAt: new Date().toISOString(), source: 'SatNOGS Network', observations: observations.filter((o) => o.frames.length) },
        200,
        'public, s-maxage=90, stale-while-revalidate=600',
      );
    } catch (e) {
      return json({ error: 'The SatNOGS network didn’t answer.' }, 502, 'no-store');
    }
  },
};
