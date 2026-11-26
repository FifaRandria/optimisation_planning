// Itinéraires sur le graphe routier OpenStreetMap du Grand Antananarivo (serveur uniquement), sans OSRM ni Docker.
// Graphe généré par scripts/build-road-graph.ts (make map-routes) dans map-data/osm/tana-graph.json.gz.
// Plus court chemin en temps (Dijkstra), durées par type de route ; le coefficient de trafic est appliqué ensuite.
import fs from "fs";
import path from "path";
import { gunzipSync } from "zlib";

export type LatLon = { lat: number; lon: number };

interface Graph {
  lat: Float64Array;
  lon: Float64Array;
  offsets: Int32Array;
  targets: Int32Array;
  seconds: Float64Array;
  shapeOffsets: Int32Array;
  shapes: Float64Array;
  grid: Map<string, number[]>;
  bbox: [number, number, number, number];
}

const CELL = 0.004; // ~450 m
const cellKey = (lat: number, lon: number) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;
const g = globalThis as unknown as { __roadGraph?: Graph | null };

export function roadGraphPath(): string {
  return process.env.ROAD_GRAPH_PATH || path.join(process.cwd(), "map-data", "osm", "tana-graph.json.gz");
}

/** Graphe chargé une fois par processus ; null s'il n'est pas installé. */
export function roadGraph(): Graph | null {
  if (g.__roadGraph !== undefined) return g.__roadGraph;
  const file = roadGraphPath();
  if (!fs.existsSync(file)) return (g.__roadGraph = null);
  const j = JSON.parse(gunzipSync(fs.readFileSync(file)).toString("utf8"));
  const lat = Float64Array.from(j.lat as number[]);
  const lon = Float64Array.from(j.lon as number[]);
  const grid = new Map<string, number[]>();
  for (let i = 0; i < lat.length; i++) {
    const k = cellKey(lat[i], lon[i]);
    const c = grid.get(k);
    if (c) c.push(i);
    else grid.set(k, [i]);
  }
  g.__roadGraph = {
    lat,
    lon,
    offsets: Int32Array.from(j.offsets),
    targets: Int32Array.from(j.targets),
    seconds: Float64Array.from(j.seconds),
    shapeOffsets: Int32Array.from(j.shapeOffsets),
    shapes: Float64Array.from(j.shapes),
    grid,
    bbox: j.bbox,
  };
  return g.__roadGraph;
}

export const roadGraphAvailable = () => roadGraph() !== null;

const metersBetween = (aLat: number, aLon: number, bLat: number, bLon: number) => Math.hypot(aLat - bLat, (aLon - bLon) * Math.cos((aLat * Math.PI) / 180)) * 111320;

/** Carrefour le plus proche d'un point (recherche par cases de plus en plus larges). */
function snap(G: Graph, p: LatLon): { node: number; meters: number } | null {
  const ci = Math.floor(p.lat / CELL);
  const cj = Math.floor(p.lon / CELL);
  let best = -1;
  let bestD = Infinity;
  for (let r = 0; r <= 12; r++) {
    for (let di = -r; di <= r; di++)
      for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        for (const i of G.grid.get(`${ci + di}:${cj + dj}`) ?? []) {
          const d = metersBetween(p.lat, p.lon, G.lat[i], G.lon[i]);
          if (d < bestD) (bestD = d), (best = i);
        }
      }
    if (best >= 0 && bestD < r * CELL * 111320) break; // aucune case plus loin ne peut être plus proche
  }
  return best < 0 ? null : { node: best, meters: bestD };
}

/** Dijkstra depuis `src` ; s'arrête quand toutes les cibles sont atteintes. Renvoie temps et arête précédente. */
function dijkstra(G: Graph, src: number, targets: Set<number>): { time: Float64Array; prevEdge: Int32Array } {
  const n = G.lat.length;
  const time = new Float64Array(n).fill(Infinity);
  const prevEdge = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  // tas binaire (noeud, temps)
  const hn: number[] = [];
  const ht: number[] = [];
  const push = (v: number, t: number) => {
    let i = hn.length;
    hn.push(v);
    ht.push(t);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ht[p] <= t) break;
      hn[i] = hn[p];
      ht[i] = ht[p];
      i = p;
    }
    hn[i] = v;
    ht[i] = t;
  };
  const pop = (): number => {
    const top = hn[0];
    const lv = hn.pop()!;
    const lt = ht.pop()!;
    if (hn.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= hn.length) break;
        const r = l + 1;
        const c = r < hn.length && ht[r] < ht[l] ? r : l;
        if (ht[c] >= lt) break;
        hn[i] = hn[c];
        ht[i] = ht[c];
        i = c;
      }
      hn[i] = lv;
      ht[i] = lt;
    }
    return top;
  };
  let left = targets.size;
  time[src] = 0;
  push(src, 0);
  while (hn.length) {
    const t0 = ht[0];
    const u = pop();
    if (done[u]) continue;
    done[u] = 1;
    if (targets.has(u) && --left === 0) break;
    for (let e = G.offsets[u]; e < G.offsets[u + 1]; e++) {
      const v = G.targets[e];
      const t = t0 + G.seconds[e];
      if (t < time[v]) {
        time[v] = t;
        prevEdge[v] = e;
        push(v, t);
      }
    }
  }
  return { time, prevEdge };
}

// accès à pied / à petite vitesse entre le point et le carrefour le plus proche (20 km/h)
const ACCESS_MS = 20 / 3.6;

/** Matrices (minutes, km) entre tous les points ; index 0 = premier point (le site). null si le graphe est absent. */
export function roadMatrix(points: LatLon[]): { minutes: number[][]; km: number[][]; snappedMeters: number[] } | null {
  const G = roadGraph();
  if (!G || points.length < 1) return null;
  const snaps = points.map((p) => snap(G, p));
  if (snaps.some((s) => !s)) return null;
  const nodes = snaps.map((s) => s!.node);
  const targets = new Set(nodes);
  const minutes: number[][] = [];
  const km: number[][] = [];
  for (let i = 0; i < points.length; i++) {
    const { time, prevEdge } = dijkstra(G, nodes[i], targets);
    minutes.push(
      nodes.map((nj, j) => {
        if (i === j) return 0;
        const t = time[nj];
        const access = (snaps[i]!.meters + snaps[j]!.meters) / ACCESS_MS;
        return Number.isFinite(t) ? (t + access) / 60 : NaN;
      })
    );
    km.push(nodes.map((nj, j) => (i === j ? 0 : pathMeters(G, prevEdge, nodes[i], nj) / 1000)));
  }
  return { minutes, km, snappedMeters: snaps.map((s) => s!.meters) };
}

function pathEdges(prevEdge: Int32Array, G: Graph, src: number, dst: number): number[] {
  const out: number[] = [];
  let v = dst;
  for (let guard = 0; v !== src && guard < 200000; guard++) {
    const e = prevEdge[v];
    if (e < 0) return [];
    out.push(e);
    // source de l'arête e : le noeud u tel que offsets[u] <= e < offsets[u+1]
    v = edgeSource(G, e);
  }
  return out.reverse();
}

function edgeSource(G: Graph, e: number): number {
  let lo = 0;
  let hi = G.offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (G.offsets[mid] <= e) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function pathMeters(G: Graph, prevEdge: Int32Array, src: number, dst: number): number {
  let m = 0;
  for (const e of pathEdges(prevEdge, G, src, dst)) {
    const u = edgeSource(G, e);
    let pLat = G.lat[u];
    let pLon = G.lon[u];
    for (let k = G.shapeOffsets[e]; k < G.shapeOffsets[e + 1]; k += 2) {
      m += metersBetween(pLat, pLon, G.shapes[k], G.shapes[k + 1]);
      pLat = G.shapes[k];
      pLon = G.shapes[k + 1];
    }
    const v = G.targets[e];
    m += metersBetween(pLat, pLon, G.lat[v], G.lon[v]);
  }
  return m;
}

/** Tracé routier d'une suite d'arrêts ([lat, lon]) ; null si le graphe est absent. */
export function roadGeometry(stops: LatLon[]): [number, number][] | null {
  const G = roadGraph();
  if (!G || stops.length < 2) return null;
  const out: [number, number][] = [[stops[0].lat, stops[0].lon]];
  for (let i = 1; i < stops.length; i++) {
    const a = snap(G, stops[i - 1]);
    const b = snap(G, stops[i]);
    if (!a || !b) return null;
    const { prevEdge } = dijkstra(G, a.node, new Set([b.node]));
    out.push([G.lat[a.node], G.lon[a.node]]);
    for (const e of pathEdges(prevEdge, G, a.node, b.node)) {
      for (let k = G.shapeOffsets[e]; k < G.shapeOffsets[e + 1]; k += 2) out.push([G.shapes[k], G.shapes[k + 1]]);
      const v = G.targets[e];
      out.push([G.lat[v], G.lon[v]]);
    }
    out.push([stops[i].lat, stops[i].lon]);
  }
  return out;
}
