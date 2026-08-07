/**
 * Local design history.
 *
 * Generated designs used to vanish on reload, which meant every visit started
 * from nothing and there was no reason to come back. This keeps the last few in
 * localStorage so a returning visitor finds their spacecraft where they left
 * them — no account, no database, no network.
 *
 * Stored as plain JSON rather than through the share codec: localStorage has
 * megabytes to spare, so compression buys nothing here and would make the
 * entries opaque to anyone inspecting their own storage.
 */
import type { Design } from './design-parts';

const KEY = 'orbital_designs';

/** Ten is roughly a session's worth of exploring, and stays well inside quota. */
const LIMIT = 10;

export interface HistoryEntry {
  id: string;
  savedAt: number;
  design: Design;
}

function isDesign(d: unknown): d is Design {
  if (!d || typeof d !== 'object') return false;
  const x = d as Record<string, unknown>;
  return typeof x.name === 'string'
    && Array.isArray(x.libraryParts)
    && Array.isArray(x.customParts);
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Anything hand-edited, half-written, or from an older shape is dropped
    // rather than allowed to reach the renderer.
    return parsed
      .filter((e) => e && typeof e.id === 'string' && isDesign(e.design))
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}

/**
 * Saves a design, newest first, and de-duplicates by name so that revising a
 * vehicle repeatedly leaves one entry rather than ten near-identical ones.
 */
export function saveDesign(design: Design): HistoryEntry[] {
  const entry: HistoryEntry = {
    id: `${design.name}-${Date.now()}`,
    savedAt: Date.now(),
    design,
  };
  const next = [entry, ...loadHistory().filter((e) => e.design.name !== design.name)].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded or storage disabled (private mode, embedded webview).
    // History is a convenience, never a precondition for designing.
  }
  return next;
}

export function removeDesign(id: string): HistoryEntry[] {
  const next = loadHistory().filter((e) => e.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* see saveDesign */
  }
  return next;
}
