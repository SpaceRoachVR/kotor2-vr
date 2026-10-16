/**
 * Pure rules for lightsaber colour crystals. Sources: retail upcrystals.2da,
 * where each u_l_colo_* row names, per saber kind, the saber template (UTI
 * resref) whose ModelVariation gives the blade colour. Engine-free so it can be
 * unit-tested; the caller supplies `variationOf` to look templates up.
 * See docs/superpowers/specs/2026-10-15-lightsaber-upgrades-design.md.
 */
import type { SaberKind } from './UpgradeRules';

export interface ColourRow {
  crystal: string;
  templates: Record<SaberKind, string>;
}

export type VariationOf = (template: string) => number | undefined;

const COLOUR_PREFIX = 'u_l_colo_';

function cell(value: string | undefined): string {
  const v = (value ?? '').trim().toLowerCase();
  return v === '****' ? '' : v;
}

export function parseColourTable(rows: Record<string, Record<string, string>>): ColourRow[] {
  const out: ColourRow[] = [];
  const keys = Object.keys(rows).sort((a, b) => Number(a) - Number(b));
  for (const key of keys) {
    const r = rows[key];
    const crystal = cell(r.template);
    if (!crystal.startsWith(COLOUR_PREFIX)) continue;
    out.push({
      crystal,
      templates: { long: cell(r.longmdlvar), short: cell(r.shortmdlvar), double: cell(r.doublemdlvar) },
    });
  }
  return out;
}

export function isColourCrystal(table: ColourRow[], resref: string): boolean {
  const wanted = resref.trim().toLowerCase();
  return table.some(r => r.crystal === wanted);
}

export function modelVariationFor(
  table: ColourRow[], crystal: string, kind: SaberKind, variationOf: VariationOf,
): number | undefined {
  const wanted = crystal.trim().toLowerCase();
  const row = table.find(r => r.crystal === wanted);
  const template = row?.templates[kind];
  return template ? variationOf(template) : undefined;
}

/** The first crystal (table order) that gives a saber of `kind` this ModelVariation. */
export function colourCrystalFor(
  table: ColourRow[], kind: SaberKind, modelVariation: number, variationOf: VariationOf,
): string | undefined {
  for (const row of table) {
    const template = row.templates[kind];
    if (template && variationOf(template) === modelVariation) return row.crystal;
  }
  return undefined;
}
