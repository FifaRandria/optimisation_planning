import { buildDemoFiles } from "./templates";
import type { UploadedFile } from "./parse";
import { DEFAULT_SETTINGS, type Settings } from "./types";

export async function readFilesFromForm(form: FormData): Promise<UploadedFile[]> {
  if (form.get("demo") === "1") return buildDemoFiles();
  const out: UploadedFile[] = [];
  for (const v of form.getAll("files")) {
    if (typeof v === "string") continue;
    const f = v as File;
    out.push({ name: f.name, buffer: Buffer.from(await f.arrayBuffer()) });
  }
  return out;
}

export function readSettings(form: FormData): Settings {
  const raw = form.get("settings");
  let s: Partial<Settings> = {};
  try {
    if (typeof raw === "string" && raw) s = JSON.parse(raw);
  } catch {
    /* réglages par défaut */
  }
  const num = (v: unknown, d: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  const hours = (v: unknown, d: number[]) => {
    const l = Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 24) : [];
    return l.length ? [...new Set(l)].sort((a, b) => a - b) : d;
  };
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const D = DEFAULT_SETTINGS;
  return {
    capacity: Math.round(num(s.capacity, D.capacity, 1, 100)),
    minRestHours: num(s.minRestHours, D.minRestHours, 0, 24),
    pickupHours: hours(s.pickupHours, D.pickupHours),
    dropHours: hours(s.dropHours, D.dropHours),
    axe21Waves: Array.isArray(s.axe21Waves) ? hours(s.axe21Waves, []) : D.axe21Waves,
    fairnessWeight: num(s.fairnessWeight, D.fairnessWeight, 0, 1000),
    weekendWeight: num(s.weekendWeight, D.weekendWeight, 0, 1000),
    maxDurationDiffMin: num(s.maxDurationDiffMin, D.maxDurationDiffMin, 0, 1440),
    respectFunction: bool(s.respectFunction, D.respectFunction),
    offSwap: bool(s.offSwap, D.offSwap),
    unknownLevelSwappable: bool(s.unknownLevelSwappable, D.unknownLevelSwappable),
    ignoreLevel: bool(s.ignoreLevel, D.ignoreLevel),
  };
}
