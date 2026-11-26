// Graphe routier du Grand Antananarivo pour calculer des trajets qui suivent les routes SANS serveur OSRM.
// Entrée : map-data/osm/tana-roads.json (routes OpenStreetMap, téléchargées par « make map-routes » :
//          requête Overpass sur un rectangle, aucune adresse envoyée). Données © contributeurs OpenStreetMap, ODbL.
// Sortie : map-data/osm/tana-graph.json.gz (non versionné, régénérable)
// Usage : npx tsx scripts/build-road-graph.ts
import fs from "fs";
import path from "path";
import { gzipSync } from "zlib";

const DIR = path.join(__dirname, "..", "map-data", "osm");
const SRC = path.join(DIR, "tana-roads.json");
const OUT = path.join(DIR, "tana-graph.json.gz");

// vitesses de circulation (km/h) par type de route, route libre ; le coefficient de trafic de la page s'y ajoute
const SPEED: Record<string, number> = {
  motorway: 70, motorway_link: 50, trunk: 50, trunk_link: 40, primary: 40, primary_link: 32, secondary: 35, secondary_link: 28,
  tertiary: 30, tertiary_link: 25, unclassified: 25, road: 20, residential: 20, living_street: 10, service: 12, track: 10,
};

interface El { type: "node" | "way"; id: number; lat?: number; lon?: number; nodes?: number[]; tags?: Record<string, string> }
if (!fs.existsSync(SRC)) {
  console.error(`Fichier absent : ${SRC} (lancez « make map-routes »)`);
  process.exit(1);
}
const els = (JSON.parse(fs.readFileSync(SRC, "utf8")) as { elements: El[] }).elements;
const coord = new Map<number, [number, number]>();
for (const e of els) if (e.type === "node") coord.set(e.id, [e.lat!, e.lon!]);

const R = 6371000;
const meters = (a: [number, number], b: [number, number]) => {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

// noeuds utiles : extrémités de voie et carrefours (un noeud présent dans 2 voies ou plus) — les autres ne servent qu'au tracé
const uses = new Map<number, number>();
const ways = els.filter((e) => e.type === "way" && e.nodes && e.tags?.highway && SPEED[e.tags.highway]);
for (const w of ways) w.nodes!.forEach((n, i) => uses.set(n, (uses.get(n) ?? 0) + (i === 0 || i === w.nodes!.length - 1 ? 2 : 1)));

const index = new Map<number, number>();
const lat: number[] = [];
const lon: number[] = [];
const idOf = (osm: number) => {
  let i = index.get(osm);
  if (i === undefined) {
    i = lat.length;
    index.set(osm, i);
    const c = coord.get(osm)!;
    lat.push(Math.round(c[0] * 1e6) / 1e6);
    lon.push(Math.round(c[1] * 1e6) / 1e6);
  }
  return i;
};

// arêtes entre noeuds utiles ; la géométrie intermédiaire est gardée pour dessiner la route
const edges: { a: number; b: number; s: number; shape: number[] }[] = [];
const shapes: number[] = []; // lat, lon à plat
for (const w of ways) {
  const t = w.tags!;
  const speed = (Number(t.maxspeed) > 0 ? Math.min(Number(t.maxspeed), SPEED[t.highway] * 1.3) : SPEED[t.highway]) / 3.6; // m/s
  const oneway = t.oneway === "yes" || t.oneway === "1" || t.junction === "roundabout" || t.highway === "motorway";
  const reverse = t.oneway === "-1";
  const ns = w.nodes!.filter((n) => coord.has(n));
  let start = 0;
  let dist = 0;
  let shape: number[] = [];
  for (let i = 1; i < ns.length; i++) {
    dist += meters(coord.get(ns[i - 1])!, coord.get(ns[i])!);
    const last = i === ns.length - 1;
    if (!last && (uses.get(ns[i]) ?? 0) < 2) {
      const c = coord.get(ns[i])!;
      shape.push(Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6);
      continue;
    }
    const a = idOf(ns[start]);
    const b = idOf(ns[i]);
    const s = dist / speed;
    if (!reverse) edges.push({ a, b, s, shape });
    if (!oneway || reverse) edges.push({ a: b, b: a, s, shape: reversePairs(shape) });
    start = i;
    dist = 0;
    shape = [];
  }
}
function reversePairs(s: number[]): number[] {
  const out: number[] = [];
  for (let i = s.length - 2; i >= 0; i -= 2) out.push(s[i], s[i + 1]);
  return out;
}

// on ne garde que la plus grande composante connexe (les tronçons isolés feraient échouer les trajets)
const n = lat.length;
const adj: number[][] = Array.from({ length: n }, () => []);
for (const e of edges) {
  adj[e.a].push(e.b);
  adj[e.b].push(e.a);
}
const comp = new Int32Array(n).fill(-1);
let best = -1;
let bestSize = 0;
for (let s = 0, c = 0; s < n; s++) {
  if (comp[s] >= 0) continue;
  const stack = [s];
  comp[s] = c;
  let size = 0;
  while (stack.length) {
    const u = stack.pop()!;
    size++;
    for (const v of adj[u]) if (comp[v] < 0) (comp[v] = c), stack.push(v);
  }
  if (size > bestSize) (bestSize = size), (best = c);
  c++;
}
const keep = new Int32Array(n).fill(-1);
const kLat: number[] = [];
const kLon: number[] = [];
for (let i = 0; i < n; i++) if (comp[i] === best) (keep[i] = kLat.length), kLat.push(lat[i]), kLon.push(lon[i]);
const kept = edges.filter((e) => comp[e.a] === best && comp[e.b] === best);

// format compact : listes à plat (CSR) pour un chargement rapide
kept.sort((x, y) => keep[x.a] - keep[y.a]);
const offsets = new Array(kLat.length + 1).fill(0);
for (const e of kept) offsets[keep[e.a] + 1]++;
for (let i = 0; i < kLat.length; i++) offsets[i + 1] += offsets[i];
const shapeOffsets: number[] = [0];
for (const e of kept) {
  shapes.push(...e.shape);
  shapeOffsets.push(shapes.length);
}
const graph = {
  source: "© contributeurs OpenStreetMap (ODbL), routes du Grand Antananarivo via Overpass",
  generatedAt: new Date().toISOString().slice(0, 10),
  bbox: [-19.1, 47.3, -18.7, 47.75],
  lat: kLat,
  lon: kLon,
  offsets,
  targets: kept.map((e) => keep[e.b]),
  seconds: kept.map((e) => Math.round(e.s * 10) / 10),
  shapeOffsets,
  shapes,
};
fs.writeFileSync(OUT, gzipSync(Buffer.from(JSON.stringify(graph))));
console.log(`${ways.length} voies → ${kLat.length} carrefours, ${kept.length} arêtes (composante principale : ${((100 * bestSize) / n).toFixed(1)} % des noeuds) → ${OUT} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} Mo)`);
