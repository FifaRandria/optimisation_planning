// Page « Axes » : types partagés (serveur + client) et conversion en table d'axes pour l'optimiseur.
// Deux découpages par site, un par colonne d'axe lue par l'optimiseur : « Axe 23h » et « Axe 21h »
// (SIRIUS : Axe 23h = ramassage de 6h, Axe 21h = remisage de 21h ; voir les vagues de chaque site).
import type { AxeTable, Settings } from "./types";
import type { SiteId } from "./sites";

export type AxeCol = "23h" | "21h";
export const AXE_COLS: AxeCol[] = ["23h", "21h"];
export const AXE_COL_HEADER: Record<AxeCol, string> = { "23h": "Axe 23h", "21h": "Axe 21h" };

export type GeoStatus = "found" | "approx" | "none" | "manual" | "file" | "saved" | "gazetteer";
export const GEO_STATUS_LABEL: Record<GeoStatus, string> = {
  found: "trouvé",
  approx: "approximatif",
  none: "à placer",
  manual: "placé à la main",
  file: "coordonnées du fichier",
  saved: "position enregistrée",
  gazetteer: "fokontany (répertoire officiel)",
};

export interface MapPoint {
  key: string; // commune / quartier tel qu'écrit dans les fichiers (clé de la table d'axes)
  lat: number | null;
  lon: number | null;
  status: GeoStatus;
  agents: number; // nombre d'agents rattachés (équilibrage)
  hints: string[]; // adresses / points de remisage cités (aide au placement)
  place?: string; // lieu reconnu dans le répertoire des fokontany (« Andraharo (fokontany, 6e Arrondissement) »)
}

export interface AxesConfig {
  vehicles: number;
  maxDurationMin: number;
  maxDetourMin: number;
  drivers: string[]; // un nom par axe (facultatif)
}

export interface AxesSettings {
  site: { lat: number; lon: number };
  traffic: number; // coefficient appliqué aux durées OSRM (route libre)
  configs: Record<AxeCol, AxesConfig>;
}

export interface PlannedAxe {
  name: string; // « Axe 1 »
  driver?: string;
  stops: number[]; // index dans AxesDoc.points, du site vers l'extérieur
  total: number;
  times: number[];
  detours: number[];
  overDuration: boolean;
  overDetour: boolean[];
  km: number;
  geometry: [number, number][]; // [lat, lon]
}

export interface AxesPlan {
  direction: "ramassage" | "remisage";
  axes: PlannedAxe[];
  outside: { index: number; reason: string }[];
}

export interface AxesDoc {
  site: SiteId;
  settings: AxesSettings;
  points: MapPoint[];
  plans: Record<AxeCol, AxesPlan | null>;
  pointKm: (number | null)[]; // distance routière site -> point
  source: "osrm" | "routes" | "estimation";
  computedAt: string;
}

/** Vagues qui utilisent chaque colonne d'axe, et sens du trajet à optimiser pour cette colonne. */
export function columnUse(s: Pick<Settings, "pickupHours" | "dropHours" | "axe21Waves">): Record<AxeCol, { waves: string[]; direction: "ramassage" | "remisage" }> {
  const out = {} as Record<AxeCol, { waves: string[]; direction: "ramassage" | "remisage" }>;
  for (const col of AXE_COLS) {
    const uses = (h: number) => (col === "21h") === s.axe21Waves.includes(h);
    const pick = s.pickupHours.filter(uses);
    const drop = s.dropHours.filter(uses);
    const waves = [...pick.map((h) => `ramassage ${h}h`), ...drop.map((h) => `remisage ${h}h`)];
    // sens du trajet : remisage dès qu'une vague de remisage utilise la colonne (cas le plus fréquent)
    out[col] = { waves, direction: drop.length ? "remisage" : "ramassage" };
  }
  return out;
}

export const defaultConfig = (vehicles = 5): AxesConfig => ({ vehicles, maxDurationMin: 60, maxDetourMin: 10, drivers: [] });

/** Table d'axes lue par l'optimiseur (même format qu'une feuille « Axes » importée). */
export function toAxeTable(doc: AxesDoc, label: string): AxeTable {
  const rows: AxeTable["rows"] = [];
  const axeOf: Record<AxeCol, Map<number, { axe: PlannedAxe; pos: number }>> = { "23h": new Map(), "21h": new Map() };
  for (const col of AXE_COLS) doc.plans[col]?.axes.forEach((a) => a.stops.forEach((s, pos) => axeOf[col].set(s, { axe: a, pos })));
  doc.points.forEach((p, i) => {
    const axes: Record<string, string> = {};
    const chauffeurs: Record<string, string> = {};
    let duree: number | undefined;
    for (const col of AXE_COLS) {
      const hit = axeOf[col].get(i);
      if (!hit) continue;
      axes[AXE_COL_HEADER[col]] = hit.axe.name;
      if (hit.axe.driver) chauffeurs[AXE_COL_HEADER[col]] = hit.axe.driver;
      // durée : temps de trajet de l'agent sur l'axe du soir (« Axe 21h ») de préférence
      if (duree === undefined || col === "21h") duree = Math.round(hit.axe.times[hit.pos]);
    }
    if (!Object.keys(axes).length) return;
    const km = doc.pointKm[i];
    rows.push({ commune: p.key, axes, chauffeurs, duree, distance: km == null ? undefined : Math.round(km * 10) / 10 });
  });
  return { sheet: label, file: "Axes enregistrés (page Axes)", rows, axeColumns: AXE_COLS.map((c) => AXE_COL_HEADER[c]) };
}

/** Points sans axe dans au moins un découpage (à corriger avant d'enregistrer). */
export function unassigned(doc: AxesDoc): Record<AxeCol, number[]> {
  const out: Record<AxeCol, number[]> = { "23h": [], "21h": [] };
  for (const col of AXE_COLS) {
    const plan = doc.plans[col];
    if (!plan) continue;
    const inAxe = new Set(plan.axes.flatMap((a) => a.stops));
    doc.points.forEach((_, i) => !inAxe.has(i) && out[col].push(i));
  }
  return out;
}
