// Calcul des axes côté serveur : matrice de durées (OSRM ou estimation), algorithme, tracés pour la carte.
import { buildAxes, routeCost, type Direction } from "../axes-builder";
import { AXE_COLS, columnUse, defaultConfig, type AxeCol, type AxesConfig, type AxesDoc, type AxesPlan, type AxesSettings, type MapPoint } from "../axes-map";
import { SITES, type SiteId } from "../sites";
import type { Settings } from "../types";
import { durationMatrix, routeGeometry } from "../geo/osrm";
import { HttpError } from "./auth";

const clamp = (v: unknown, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

export function sanitizeAxesSettings(site: SiteId, raw: unknown): AxesSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<AxesSettings>;
  const cfg = (c: Partial<AxesConfig> | undefined): AxesConfig => {
    const d = defaultConfig();
    return {
      vehicles: Math.round(clamp(c?.vehicles, d.vehicles, 1, 40)),
      maxDurationMin: clamp(c?.maxDurationMin, d.maxDurationMin, 5, 240),
      maxDetourMin: clamp(c?.maxDetourMin, d.maxDetourMin, 0, 120),
      drivers: Array.isArray(c?.drivers) ? c!.drivers.slice(0, 40).map((x) => String(x ?? "").slice(0, 120).trim()) : [],
    };
  };
  const base = SITES[site].coords;
  return {
    site: { lat: clamp(s.site?.lat, base.lat, -26, -11), lon: clamp(s.site?.lon, base.lon, 42, 51) },
    traffic: clamp(s.traffic, 1.3, 0.5, 3),
    configs: { "23h": cfg(s.configs?.["23h"]), "21h": cfg(s.configs?.["21h"]) },
  };
}

export function sanitizePoints(raw: unknown): MapPoint[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "Liste de points invalide.");
  if (raw.length > 3000) throw new HttpError(400, "Trop de points (3000 au maximum).");
  return raw.map((p) => {
    const x = (p ?? {}) as Partial<MapPoint>;
    const lat = x.lat == null ? null : clamp(x.lat, NaN, -26, -11);
    const lon = x.lon == null ? null : clamp(x.lon, NaN, 42, 51);
    const placed = lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon);
    return {
      key: String(x.key ?? "").slice(0, 200),
      lat: placed ? lat : null,
      lon: placed ? lon : null,
      status: placed ? x.status ?? "manual" : "none",
      agents: Math.max(0, Math.round(Number(x.agents) || 0)),
      hints: Array.isArray(x.hints) ? x.hints.slice(0, 3).map((h) => String(h).slice(0, 200)) : [],
      place: placed && x.place ? String(x.place).slice(0, 200) : undefined,
    };
  });
}

/**
 * Calcule (ou réévalue) les deux découpages. `fixed[col]` : affectation imposée par point (index d'axe, -1 = hors axe),
 * pour réévaluer après une correction à la main ; sans `fixed[col]`, l'algorithme choisit.
 */
export async function computeAxesDoc(site: SiteId, siteSettings: Settings, settings: AxesSettings, points: MapPoint[], fixed: Partial<Record<AxeCol, number[]>> = {}): Promise<AxesDoc> {
  const placed = points.map((p, i) => ({ p, i })).filter((x) => x.p.lat !== null && x.p.lon !== null);
  const toFull = placed.map((x) => x.i);
  const lite = placed.map((x) => ({ lat: x.p.lat!, lon: x.p.lon!, weight: x.p.agents }));
  const matrix = await durationMatrix(settings.site, lite, settings.traffic);
  const use = columnUse(siteSettings);
  const unplaced = points.map((p, i) => ({ p, i })).filter((x) => x.p.lat === null || x.p.lon === null);

  const plans = {} as Record<AxeCol, AxesPlan | null>;
  for (const col of AXE_COLS) {
    const cfg = settings.configs[col];
    const dir: Direction = use[col].direction;
    const fullFixed = fixed[col];
    const placedFixed = fullFixed && fullFixed.length === points.length ? placed.map((x) => Math.min(cfg.vehicles - 1, fullFixed[x.i] ?? -1)) : undefined;
    const out = buildAxes(lite, settings.site, matrix.minutes, dir, cfg, placedFixed);
    const axes = await Promise.all(
      out.axes.map(async (a, k) => {
        const stopsFull = a.stops.map((s) => toFull[s]);
        const path: { lat: number; lon: number }[] = a.stops.map((s) => lite[s]);
        const ordered = dir === "remisage" ? [settings.site, ...path] : [...[...path].reverse(), settings.site];
        return {
          name: `Axe ${k + 1}`,
          driver: cfg.drivers[k] || undefined,
          stops: stopsFull,
          total: a.total,
          times: a.times,
          detours: a.detours,
          overDuration: a.overDuration,
          overDetour: a.overDetour,
          km: routeCost(a.stops, matrix.km, dir),
          geometry: a.stops.length ? await routeGeometry(ordered) : [],
        };
      })
    );
    plans[col] = {
      direction: dir,
      axes,
      outside: [
        ...out.outside.map((o) => ({ index: toFull[o.index], reason: o.reason })),
        ...unplaced.map((x) => ({ index: x.i, reason: "position inconnue : à placer sur la carte" })),
      ],
    };
  }
  const pointKm: (number | null)[] = points.map(() => null);
  placed.forEach((x, j) => (pointKm[x.i] = matrix.km[0][j + 1]));
  return { site, settings, points, plans, pointKm, source: matrix.source, computedAt: new Date().toISOString() };
}
