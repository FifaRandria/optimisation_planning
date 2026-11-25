// Contrôles de l'algorithme de création des axes (lib/axes-builder.ts), sans réseau.
// Usage : npx tsx scripts/test-axes-builder.ts   — chaque contrôle doit valoir 0.
import { buildAxes, estimateMatrix, evaluateRoute, type AxesParams, type Direction } from "../lib/axes-builder";
import { SIRIUS_POINTS } from "../lib/sample-sirius";
import { SITES } from "../lib/sites";

let failures = 0;
const check = (label: string, bad: number) => {
  console.log(`${bad === 0 ? "ok  " : "FAIL"} ${label} : ${bad}`);
  if (bad) failures++;
};

function run(name: string, pts: { lat: number; lon: number; weight?: number }[], site: { lat: number; lon: number }, dir: Direction, p: AxesParams) {
  const { minutes } = estimateMatrix(site, pts);
  const out = buildAxes(pts, site, minutes, dir, p);
  console.log(`\n${name} (${dir}) : ${pts.length} points, ${p.vehicles} axes, durée ≤ ${p.maxDurationMin} min, détour ≤ ${p.maxDetourMin} min`);
  out.axes.forEach((a, i) => console.log(`  Axe ${i + 1} : ${a.stops.length} arrêts, ${a.total.toFixed(1)} min, détour max ${Math.max(0, ...a.detours).toFixed(1)} min`));
  if (out.outside.length) console.log(`  hors axe : ${out.outside.map((o) => `#${o.index} (${o.reason})`).join(", ")}`);

  const seen = pts.map(() => 0);
  out.axes.forEach((a) => a.stops.forEach((s) => seen[s]++));
  out.outside.forEach((o) => seen[o.index]++);
  check(`${name} — points absents ou en double`, seen.filter((n) => n !== 1).length);
  check(`${name} — nombre d'axes ≠ chauffeurs`, out.axes.length === p.vehicles ? 0 : 1);
  check(`${name} — axes au-delà de la durée max`, out.axes.filter((a) => a.overDuration).length);
  check(`${name} — arrêts au-delà du détour max`, out.axes.reduce((s, a) => s + a.overDetour.filter(Boolean).length, 0));
  // la réévaluation d'un axe redonne la même durée
  check(`${name} — durées incohérentes`, out.axes.filter((a) => Math.abs(evaluateRoute(a.stops, minutes, dir, p).total - a.total) > 1e-6).length);
  // même entrée => même sortie
  const again = buildAxes(pts, site, minutes, dir, p);
  check(`${name} — résultat non déterministe`, JSON.stringify(again) === JSON.stringify(out) ? 0 : 1);
  return out;
}

const siriusSite = SITES.sirius.coords;
run("SIRIUS fictif soir", SIRIUS_POINTS.map((p) => ({ lat: p.lat, lon: p.lon, weight: 2 })), siriusSite, "remisage", { vehicles: 5, maxDurationMin: 60, maxDetourMin: 12 });
run("SIRIUS fictif matin", SIRIUS_POINTS.map((p) => ({ lat: p.lat, lon: p.lon, weight: 2 })), siriusSite, "ramassage", { vehicles: 6, maxDurationMin: 60, maxDetourMin: 12 });

// grille synthétique avec un point très éloigné : il doit sortir « hors axe »
const grid: { lat: number; lon: number }[] = [];
for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) if (i !== 3 || j !== 3) grid.push({ lat: -18.95 + i * 0.015, lon: 47.47 + j * 0.015 });
grid.push({ lat: -19.6, lon: 47.0 });
const g = run("Grille + point lointain", grid, { lat: -18.905, lon: 47.515 }, "remisage", { vehicles: 6, maxDurationMin: 45, maxDetourMin: 10 });
check("Point lointain laissé hors axe", g.outside.some((o) => o.index === grid.length - 1) ? 0 : 1);

// contraintes très strictes : rien ne doit dépasser, quitte à laisser beaucoup de points hors axe
run("Grille stricte", grid.slice(0, -1), { lat: -18.905, lon: 47.515 }, "ramassage", { vehicles: 3, maxDurationMin: 20, maxDetourMin: 3 });

// corrections à la main : l'affectation imposée est respectée
const { minutes } = estimateMatrix(siriusSite, SIRIUS_POINTS);
const fixed = SIRIUS_POINTS.map((_, i) => (i === 0 ? -1 : i % 3));
const f = buildAxes(SIRIUS_POINTS, siriusSite, minutes, "remisage", { vehicles: 3, maxDurationMin: 60, maxDetourMin: 12 }, fixed);
check("Affectation manuelle non respectée", fixed.filter((a, i) => (a < 0 ? !f.outside.some((o) => o.index === i) : !f.axes[a].stops.includes(i))).length);

console.log(failures ? `\n${failures} contrôle(s) en échec.` : "\nTous les contrôles valent 0.");
process.exit(failures ? 1 : 0);
