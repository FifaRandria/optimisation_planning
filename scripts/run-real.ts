// Usage : npx tsx scripts/run-real.ts fichier1.xlsx fichier2.xlsx ...   (sans argument : jeu d'exemple)
//   --compare : compare 3 variantes (sans contrainte fonction / fonction seule / fonction + échange OFF)
import fs from "fs";
import path from "path";
import { parseWorkbooks } from "../lib/parse";
import { optimize } from "../lib/optimize";
import { buildDemoFiles } from "../lib/templates";
import { DEFAULT_SETTINGS, type Cell, type OptimizationResult, type Settings } from "../lib/types";
import { norm, weekKey } from "../lib/util";

/** Contrôles d'invariants : chaque valeur doit être 0. */
export function checks(r: OptimizationResult) {
  const key = (c: Cell) => (c.k === "shift" ? `${c.arr}-${c.dep}` : null);
  // 1) couverture identique par jour × fonction × horaire
  let coverage = 0;
  for (let d = 0; d < r.dates.length; d++) {
    const cov = (state: Cell[][]) =>
      state
        .map((row, i) => (key(row[d]) ? `${norm(r.agents[i].fonction)}|${key(row[d])}` : null))
        .filter(Boolean)
        .sort()
        .join(",");
    if (cov(r.before) !== cov(r.after)) coverage++;
  }
  // 2) nombre de jours OFF par agent et par semaine identique ; aucune case non OFF/shift modifiée
  let offCount = 0;
  let frozenTouched = 0;
  r.before.forEach((row, i) => {
    const perWeek = (state: Cell[]) => {
      const m = new Map<string, number>();
      state.forEach((c, d) => c.k === "off" && m.set(weekKey(r.dates[d]), (m.get(weekKey(r.dates[d])) ?? 0) + 1));
      return [...m.entries()].sort().join(",");
    };
    if (perWeek(row) !== perWeek(r.after[i])) offCount++;
    row.forEach((c, d) => {
      const a = r.after[i][d];
      if (r.changed[i][d] && (!["shift", "off"].includes(c.k) || !["shift", "off"].includes(a.k))) frozenTouched++;
      if (r.changed[i][d] && r.agents[i].frozen) frozenTouched++;
    });
  });
  // 3) aucune nouvelle violation de repos
  const minRest = r.settings.minRestHours * 60;
  let rest = 0;
  const viol = (a: Cell, b: Cell) => a.k === "shift" && b.k === "shift" && b.arr + 1440 - a.dep < minRest;
  r.after.forEach((row, i) => {
    for (let d = 1; d < row.length; d++) if (viol(row[d - 1], row[d]) && !viol(r.before[i][d - 1], r.before[i][d])) rest++;
  });
  // 4) aucun échange entre fonctions différentes ; échanges OFF dans la même semaine
  const crossFn = r.settings.respectFunction ? r.swaps.filter((s) => norm(s.a.fonction) !== norm(s.b.fonction)).length : 0;
  const crossWeek = r.swaps.filter((s) => s.kind === "off" && weekKey(s.date) !== weekKey(s.date2!)).length;
  return { coverage, offCount, frozenTouched, rest, crossFn, crossWeek };
}

function summary(label: string, r: OptimizationResult) {
  const mb = r.metricsBefore;
  const ma = r.metricsAfter;
  const off = r.swaps.filter((s) => s.kind === "off").length;
  console.log(
    `${label.padEnd(26)} véhicules ${mb.vehicles} → ${ma.vehicles} (−${mb.vehicles - ma.vehicles}, −${((100 * (mb.vehicles - ma.vehicles)) / Math.max(1, mb.vehicles)).toFixed(1)} %)` +
      ` | ramassage ${mb.pickupVehicles}→${ma.pickupVehicles}, remisage ${mb.dropVehicles}→${ma.dropVehicles}` +
      ` | ≤4 pers. ${mb.smallVehicles}→${ma.smallVehicles} | échanges ${r.swaps.length} (dont OFF ${off}), plans ${new Set(r.swaps.map((s) => s.planId)).size}`
  );
  console.log(" ".repeat(26), "contrôles (tous à 0) :", JSON.stringify(checks(r)));
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const compare = process.argv.includes("--compare");
  const files = args.length ? args.map((f) => ({ name: path.basename(f), buffer: fs.readFileSync(f) })) : await buildDemoFiles();
  console.time("parse");
  const inputs = parseWorkbooks(files);
  console.timeEnd("parse");
  console.log(inputs.detection.map((d) => `${d.role}: ${d.file} / ${d.sheet} (${d.rows}) ${d.note ?? ""}`).join("\n"));
  if (inputs.alerts.length) console.log("alertes de lecture :", inputs.alerts);
  if (!inputs.planning) return;

  const variants: [string, Partial<Settings>][] = compare
    ? [
        ["sans contrainte fonction", { respectFunction: false, offSwap: false }],
        ["fonction seule", { respectFunction: true, offSwap: false }],
        ["fonction + échange OFF", { respectFunction: true, offSwap: true }],
      ]
    : [["réglages par défaut", {}]];
  let last: OptimizationResult | null = null;
  for (const [label, s] of variants) {
    const t0 = Date.now();
    const r = optimize(inputs, { ...DEFAULT_SETTINGS, ...s });
    summary(`${label} (${((Date.now() - t0) / 1000).toFixed(1)} s)`, r);
    last = r;
  }
  if (!last) return;
  const byCode: Record<string, number> = {};
  last.alerts.forEach((a) => (byCode[a.code] = (byCode[a.code] ?? 0) + 1));
  console.log("alertes :", byCode);
  for (const s of last.swaps.filter((x) => x.kind === "off").slice(0, 2)) console.log("  ex. OFF :", s.reason);
  for (const s of last.swaps.filter((x) => x.kind === "jour").slice(0, 1)) console.log("  ex. jour :", s.reason);
}
main();
