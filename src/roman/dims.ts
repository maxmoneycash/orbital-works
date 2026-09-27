/**
 * The Roman dimension store, as the explorer reads it.
 *
 * roman-dims.json is generated from scripts/roman/roman_dims.py by
 * export_dims.py, so every number on screen is the number the model was built
 * from, carrying the provenance it was built with. Nothing here restates a
 * value by hand.
 */
import RAW from '../data/roman-dims.json';

export type Tag = 'PUB' | 'DER' | 'EST';

interface RawDim { value: number | number[]; tag: string; note: string }

const DIMS = RAW.dims as Record<string, RawDim>;

/** EST_INF (inferred, unpublished) displays as EST: both are accuracy debt. */
function tagOf(t: string): Tag {
  return t === 'PUB' || t === 'DER' ? t : 'EST';
}

export function dim(name: string): { value: number | number[]; tag: Tag; note: string } {
  const d = DIMS[name];
  if (!d) throw new Error(`roman-dims.json has no ${name}`);
  return { value: d.value, tag: tagOf(d.tag), note: d.note };
}

export function num(name: string): number {
  const v = dim(name).value;
  return Array.isArray(v) ? v[0] : v;
}

export interface Fact { label: string; value: string; tag: Tag; note?: string }

const trim = (n: number, digits: number) =>
  n.toFixed(digits).replace(/\.?0+$/, '') || '0';

/** A fact straight from the store: `fact('Mirror diameter', 'PM_DIA', 'm', 2)`. */
export function fact(label: string, name: string, unit = '', digits = 2, scale = 1): Fact {
  const d = dim(name);
  const fmt = (n: number) => (unit === '' && Number.isInteger(n) ? String(n) : trim(n * scale, digits));
  const value = Array.isArray(d.value)
    ? d.value.map(fmt).join(' × ')
    : typeof d.value === 'number' && (name.endsWith('_GIMBALLED') || name === 'DAC_MEMBRANE' || name === 'SCRAPERS')
      ? (d.value ? 'yes' : 'no')
      : fmt(d.value);
  return { label, value: unit ? `${value} ${unit}` : value, tag: d.tag, note: d.note };
}

/** A fact the store does not hold (a count or claim from a cited source). */
export function stated(label: string, value: string, tag: Tag, note?: string): Fact {
  return { label, value, tag, note };
}

const P = RAW.provenance as Record<string, number>;
export const PROVENANCE = {
  PUB: P.PUB ?? 0,
  DER: P.DER ?? 0,
  EST: (P.EST ?? 0) + (P.EST_INF ?? 0),
};
export const PROVENANCE_TOTAL = PROVENANCE.PUB + PROVENANCE.DER + PROVENANCE.EST;
export const CORRECTIONS = RAW.corrections as { topic: string; text: string; sources: string }[];
