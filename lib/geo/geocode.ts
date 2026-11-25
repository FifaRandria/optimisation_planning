// Géocodage (serveur uniquement) : Nominatim hébergé sur le serveur (service « nominatim » de docker-compose),
// limité à la zone d'Antananarivo. Les adresses ne sont envoyées qu'à ce serveur, jamais à l'extérieur.
// Sans NOMINATIM_URL, rien n'est géocodé : les points se placent à la main sur la carte.
import type { LatLon } from "./osrm";
import type { GeoStatus } from "../axes-map";

const nominatimUrl = () => (process.env.NOMINATIM_URL || "").replace(/\/+$/, "");
export const geocodingAvailable = () => !!nominatimUrl();

// Grand Antananarivo (ouest, nord, est, sud)
const VIEWBOX = "47.30,-18.70,47.75,-19.10";

async function search(q: string): Promise<LatLon | null> {
  const url = `${nominatimUrl()}/search?format=jsonv2&limit=1&countrycodes=mg&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(q)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "transport-optimizer" } });
    if (!r.ok) return null;
    const j = (await r.json()) as { lat: string; lon: string }[];
    return j[0] ? { lat: Number(j[0].lat), lon: Number(j[0].lon) } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Position d'un quartier : d'abord le nom du quartier / de la commune (« trouvé »),
 * sinon l'adresse ou le point de remisage le plus cité (« approximatif »).
 */
export async function geocodePlace(name: string, hints: string[]): Promise<{ pos: LatLon | null; status: GeoStatus }> {
  if (!geocodingAvailable()) return { pos: null, status: "none" };
  const clean = (s: string) => s.replace(/\b(lot|bis|ter)\b\s*[\w/-]*/gi, " ").replace(/\s+/g, " ").trim();
  const direct = await search(`${clean(name)}, Antananarivo`);
  if (direct) return { pos: direct, status: "found" };
  for (const h of hints.slice(0, 2)) {
    const p = await search(`${clean(h)}, Antananarivo`);
    if (p) return { pos: p, status: "approx" };
  }
  return { pos: null, status: "none" };
}

/** Géocode une liste en parallèle limité (serveur local : pas de quota, mais on ménage la machine). */
export async function geocodeAll<T>(items: T[], fn: (x: T) => Promise<void>, concurrency = 4): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}
