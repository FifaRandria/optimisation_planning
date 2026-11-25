// Création automatique des axes d'un site à partir de points géolocalisés (communes / quartiers).
// Partagé serveur + client : aucune dépendance Node, aucun hasard (même entrée => même résultat).
//
// Un axe = un chauffeur = un trajet type au départ (remisage) ou à destination (ramassage) du site.
// Entrées : une matrice de durées en minutes, index 0 = le site, i + 1 = le point i.
// Contraintes : K axes (nombre de chauffeurs), durée max du trajet (site <-> dernier arrêt),
// détour max par arrêt (temps ajouté aux passagers déjà à bord, ou encore à bord, à cause de cet arrêt).
// Un point qui ne peut pas respecter les contraintes est laissé « hors axe » (à placer à la main),
// plutôt que de casser une contrainte.

export type Direction = "ramassage" | "remisage";

export interface AxesParams {
  vehicles: number; // nombre d'axes (chauffeurs)
  maxDurationMin: number; // durée max du trajet entre le site et le dernier (ou premier) arrêt
  maxDetourMin: number; // détour max imposé aux autres passagers par un arrêt
}

export interface PointLite {
  lat: number;
  lon: number;
  weight?: number; // nombre d'agents du point (équilibrage des axes)
}

export interface AxeRoute {
  stops: number[]; // index des points, ordonnés du site vers l'extérieur
  total: number; // durée du trajet complet (min)
  times: number[]; // pour chaque arrêt (même ordre) : temps passé dans le véhicule entre l'arrêt et le site (min)
  detours: number[]; // pour chaque arrêt : détour imposé aux autres passagers (min)
  overDuration: boolean;
  overDetour: boolean[];
}

export interface BuildOutput {
  axes: AxeRoute[];
  outside: { index: number; reason: string }[];
}

/** Durée d'un trajet. `route` est ordonnée du site vers l'extérieur ; en ramassage on la parcourt à l'envers. */
export function routeCost(route: number[], M: number[][], dir: Direction): number {
  if (!route.length) return 0;
  const n = (i: number) => route[i] + 1;
  let t = 0;
  if (dir === "remisage") {
    t += M[0][n(0)];
    for (let i = 1; i < route.length; i++) t += M[n(i - 1)][n(i)];
  } else {
    for (let i = route.length - 1; i > 0; i--) t += M[n(i)][n(i - 1)];
    t += M[n(0)][0];
  }
  return t;
}

/** Évalue un axe : durée totale, temps de trajet de chaque arrêt, détour de chaque arrêt, dépassements. */
export function evaluateRoute(stops: number[], M: number[][], dir: Direction, p: AxesParams): AxeRoute {
  const k = stops.length;
  const node = (i: number) => (i < 0 ? 0 : stops[i] + 1); // -1 = le site
  const leg = (a: number, b: number) => (dir === "remisage" ? M[a][b] : M[b][a]); // a plus près du site que b
  const total = routeCost(stops, M, dir);
  // temps entre le site et l'arrêt i en suivant l'axe (identique pour l'aller et le retour à l'ordre près)
  const times: number[] = [];
  let acc = 0;
  for (let i = 0; i < k; i++) {
    acc += leg(node(i - 1), node(i));
    times.push(acc);
  }
  if (dir === "ramassage") {
    // en ramassage, on monte à l'arrêt i puis on passe par i-1, …, 0 jusqu'au site
    const back: number[] = [];
    let b = 0;
    for (let i = 0; i < k; i++) {
      b += M[node(i)][node(i - 1)];
      back.push(b);
    }
    times.splice(0, k, ...back);
  }
  // détour : l'arrêt le plus éloigné n'en impose à personne ; les autres allongent le trajet de ceux d'au-delà
  const detours = stops.map((_, i) => (i === k - 1 ? 0 : leg(node(i - 1), node(i)) + leg(node(i), node(i + 1)) - leg(node(i - 1), node(i + 1))));
  return {
    stops: [...stops],
    total,
    times,
    detours,
    overDuration: total > p.maxDurationMin + 1e-9,
    overDetour: detours.map((d) => d > p.maxDetourMin + 1e-9),
  };
}

/** Pénalité d'un axe : durée + forte pénalité par minute de dépassement. */
function axeScore(stops: number[], M: number[][], dir: Direction, p: AxesParams): number {
  if (!stops.length) return 0;
  const r = evaluateRoute(stops, M, dir, p);
  let over = Math.max(0, r.total - p.maxDurationMin);
  r.detours.forEach((d) => (over += Math.max(0, d - p.maxDetourMin)));
  return r.total + 1000 * over;
}

/** Ordre des arrêts : plus proche voisin depuis le site, puis 2-opt. */
export function orderStops(stops: number[], M: number[][], dir: Direction): number[] {
  if (stops.length <= 1) return [...stops];
  const leg = (a: number, b: number) => (dir === "remisage" ? M[a][b] : M[b][a]);
  const left = new Set(stops);
  const route: number[] = [];
  let cur = 0;
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    for (const s of [...left].sort((a, b) => a - b)) {
      const d = leg(cur, s + 1);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = s;
      }
    }
    route.push(best);
    left.delete(best);
    cur = best + 1;
  }
  let improved = true;
  let guard = 0;
  let cost = routeCost(route, M, dir);
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 0; i < route.length - 1; i++)
      for (let j = i + 1; j < route.length; j++) {
        const cand = [...route.slice(0, i), ...route.slice(i, j + 1).reverse(), ...route.slice(j + 1)];
        const c = routeCost(cand, M, dir);
        if (c < cost - 1e-9) {
          route.splice(0, route.length, ...cand);
          cost = c;
          improved = true;
        }
      }
  }
  return route;
}

/** Meilleure position d'insertion d'un point dans un axe (ordre conservé). */
function bestInsertion(stops: number[], s: number, M: number[][], dir: Direction, p: AxesParams): { stops: number[]; score: number } {
  let best = { stops: [...stops, s], score: Infinity };
  for (let i = 0; i <= stops.length; i++) {
    const cand = [...stops.slice(0, i), s, ...stops.slice(i)];
    const sc = axeScore(cand, M, dir, p);
    if (sc < best.score - 1e-9) best = { stops: cand, score: sc };
  }
  return best;
}

/** Amorce : balayage angulaire autour du site, K secteurs contigus équilibrés en poids (agents). */
function sweep(points: PointLite[], site: { lat: number; lon: number }, k: number): number[][] {
  const cos = Math.cos((site.lat * Math.PI) / 180);
  const ang = points.map((pt, i) => ({ i, a: Math.atan2(pt.lat - site.lat, (pt.lon - site.lon) * cos) }));
  ang.sort((x, y) => x.a - y.a || x.i - y.i);
  // on commence le balayage après le plus grand vide angulaire, pour ne pas couper un groupe de points
  let start = 0;
  let gap = -1;
  for (let j = 0; j < ang.length; j++) {
    const next = ang[(j + 1) % ang.length].a + (j + 1 === ang.length ? 2 * Math.PI : 0);
    if (next - ang[j].a > gap) {
      gap = next - ang[j].a;
      start = (j + 1) % ang.length;
    }
  }
  const order = [...ang.slice(start), ...ang.slice(0, start)].map((x) => x.i);
  const w = (i: number) => Math.max(1, points[i].weight ?? 1);
  const totalW = order.reduce((s, i) => s + w(i), 0);
  const groups: number[][] = Array.from({ length: k }, () => []);
  let accW = 0;
  for (const i of order) {
    const g = Math.min(k - 1, Math.floor((accW / totalW) * k));
    groups[g].push(i);
    accW += w(i);
  }
  return groups;
}

/**
 * Construit les axes. `fixed` (facultatif) : affectation imposée point -> axe (-1 = hors axe) ;
 * dans ce cas on ne fait qu'ordonner et évaluer chaque axe (corrections faites à la main sur la carte).
 */
export function buildAxes(points: PointLite[], site: { lat: number; lon: number }, M: number[][], dir: Direction, p: AxesParams, fixed?: number[]): BuildOutput {
  const k = Math.max(1, Math.round(p.vehicles));
  if (fixed) {
    const groups: number[][] = Array.from({ length: Math.max(k, ...fixed.map((a) => a + 1)) }, () => []);
    const outside: BuildOutput["outside"] = [];
    fixed.forEach((a, i) => (a >= 0 ? groups[a].push(i) : outside.push({ index: i, reason: "placé hors axe à la main" })));
    return { axes: groups.map((g) => evaluateRoute(orderStops(g, M, dir), M, dir, p)), outside };
  }
  if (!points.length) return { axes: Array.from({ length: k }, () => evaluateRoute([], M, dir, p)), outside: [] };

  // 1) amorce + ordre
  let groups = sweep(points, site, k).map((g) => orderStops(g, M, dir));

  // 2) amélioration locale : déplacer un point vers l'axe où il coûte le moins (jamais vider un axe)
  for (let pass = 0; pass < 30; pass++) {
    let moved = false;
    for (let a = 0; a < groups.length; a++) {
      for (const s of [...groups[a]]) {
        if (groups[a].length <= 1) break;
        const without = groups[a].filter((x) => x !== s);
        const curA = axeScore(groups[a], M, dir, p);
        const newA = axeScore(without, M, dir, p);
        let best: { b: number; stops: number[]; gain: number } | null = null;
        for (let b = 0; b < groups.length; b++) {
          if (b === a) continue;
          const ins = bestInsertion(groups[b], s, M, dir, p);
          const gain = curA + axeScore(groups[b], M, dir, p) - (newA + ins.score);
          if (gain > 1e-6 && (!best || gain > best.gain + 1e-9)) best = { b, stops: ins.stops, gain };
        }
        if (best) {
          groups[a] = orderStops(without, M, dir);
          groups[best.b] = orderStops(best.stops, M, dir);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  // 3) points impossibles : on retire l'arrêt fautif, on essaie de le placer ailleurs sans dépassement, sinon hors axe
  const outside: BuildOutput["outside"] = [];
  const pending: number[] = [];
  groups = groups.map((g) => {
    let cur = [...g];
    for (let guard = 0; guard < 500; guard++) {
      const r = evaluateRoute(cur, M, dir, p);
      if (!r.overDuration && !r.overDetour.some(Boolean)) break;
      // arrêt le plus coûteux : plus grand détour fautif, sinon (durée dépassée) l'arrêt le plus éloigné
      let worst = -1;
      r.detours.forEach((d, i) => r.overDetour[i] && (worst < 0 || d > r.detours[worst]) && (worst = i));
      if (worst < 0) worst = cur.length - 1;
      pending.push(cur[worst]);
      cur = orderStops(cur.filter((_, i) => i !== worst), M, dir);
    }
    return cur;
  });
  for (const s of pending.sort((x, y) => x - y)) {
    let best: { b: number; stops: number[]; cost: number } | null = null;
    for (let b = 0; b < groups.length; b++) {
      const cand = orderStops([...groups[b], s], M, dir);
      const r = evaluateRoute(cand, M, dir, p);
      if (r.overDuration || r.overDetour.some(Boolean)) continue;
      const cost = r.total - routeCost(groups[b], M, dir);
      if (!best || cost < best.cost - 1e-9) best = { b, stops: cand, cost };
    }
    if (best) groups[best.b] = best.stops;
    else {
      const alone = evaluateRoute([s], M, dir, p);
      outside.push({ index: s, reason: alone.overDuration ? `trop loin : ${Math.ceil(alone.total)} min seul, au-delà de ${p.maxDurationMin} min` : "aucun axe ne peut l'ajouter sans dépasser la durée ou le détour maximum" });
    }
  }
  return { axes: groups.map((g) => evaluateRoute(g, M, dir, p)), outside };
}

// ---------------------------------------------------------------------------
// Durées estimées sans serveur d'itinéraires (mode dégradé) : vol d'oiseau × facteur routier / vitesse
// ---------------------------------------------------------------------------

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export const ESTIMATE = { roadFactor: 1.4, speedKmh: 22 };

/** Matrices (minutes, km) estimées ; index 0 = site. */
export function estimateMatrix(site: { lat: number; lon: number }, points: { lat: number; lon: number }[]): { minutes: number[][]; km: number[][] } {
  const all = [site, ...points];
  const km = all.map((a) => all.map((b) => haversineKm(a, b) * ESTIMATE.roadFactor));
  return { km, minutes: km.map((row) => row.map((d) => (d / ESTIMATE.speedKmh) * 60)) };
}
