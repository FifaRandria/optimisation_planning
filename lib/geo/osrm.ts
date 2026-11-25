// Itinéraires routiers (serveur uniquement) : OSRM hébergé sur le serveur (service « osrm » de docker-compose).
// Sans OSRM_URL, on estime les durées à vol d'oiseau (mode dégradé, signalé à l'écran).
// Aucune adresse n'est envoyée : seulement des coordonnées, et seulement à notre propre serveur OSRM.
import { estimateMatrix } from "../axes-builder";

export type LatLon = { lat: number; lon: number };

export interface Matrix {
  minutes: number[][]; // index 0 = site
  km: number[][];
  source: "osrm" | "estimation";
}

const osrmUrl = () => (process.env.OSRM_URL || "").replace(/\/+$/, "");
export const routingAvailable = () => !!osrmUrl();

const coordList = (pts: LatLon[]) => pts.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";");

async function getJson<T>(url: string, timeoutMs = 30000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Matrice des durées entre le site et tous les points (minutes, multipliées par le coefficient de trafic).
 * OSRM ne connaît pas le trafic : `traffic` (ex. 1,3) rapproche les durées « route libre » de la réalité.
 */
export async function durationMatrix(site: LatLon, points: LatLon[], traffic = 1): Promise<Matrix> {
  const all = [site, ...points];
  if (routingAvailable() && all.length >= 2) {
    try {
      const j = await getJson<{ code: string; durations: (number | null)[][]; distances?: (number | null)[][] }>(
        `${osrmUrl()}/table/v1/driving/${coordList(all)}?annotations=duration,distance`
      );
      if (j.code === "Ok") {
        const est = estimateMatrix(site, points);
        // une paire sans route (point hors du réseau routier) : on garde l'estimation pour cette paire
        const minutes = j.durations.map((row, a) => row.map((s, b) => (s == null ? est.minutes[a][b] : (s / 60) * traffic)));
        const km = (j.distances ?? []).map((row, a) => row.map((m, b) => (m == null ? est.km[a][b] : m / 1000)));
        return { minutes, km: km.length ? km : est.km, source: "osrm" };
      }
    } catch {
      /* repli sur l'estimation */
    }
  }
  const est = estimateMatrix(site, points);
  return { minutes: est.minutes.map((r) => r.map((m) => m * traffic)), km: est.km, source: "estimation" };
}

/** Tracé routier d'un axe (pour la carte) ; ligne droite entre les arrêts si OSRM n'est pas disponible. */
export async function routeGeometry(stops: LatLon[]): Promise<[number, number][]> {
  const straight = stops.map((p) => [p.lat, p.lon] as [number, number]);
  if (!routingAvailable() || stops.length < 2) return straight;
  try {
    const j = await getJson<{ code: string; routes: { geometry: { coordinates: [number, number][] } }[] }>(
      `${osrmUrl()}/route/v1/driving/${coordList(stops)}?overview=full&geometries=geojson`
    );
    if (j.code === "Ok" && j.routes[0]) return j.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  } catch {
    /* ligne droite */
  }
  return straight;
}
