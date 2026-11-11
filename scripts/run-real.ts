// Usage : npx tsx scripts/run-real.ts fichier1.xlsx fichier2.xlsx ...   (sans argument : jeu d'exemple)
//   --compare : compare 3 variantes (sans contrainte fonction / fonction seule / fonction + échange OFF)
import fs from "fs";
import path from "path";
import { parseWorkbooks } from "../lib/parse";
import { isRoleOnly, optimize } from "../lib/optimize";
import { buildDemoFiles } from "../lib/templates";
import { DEFAULT_SETTINGS, type Cell, type OptimizationResult, type ParsedInputs, type Settings } from "../lib/types";
import { norm, weekKey } from "../lib/util";

/** Contrôles d'invariants : chaque valeur doit être 0. */
export function checks(r: OptimizationResult, inputs?: ParsedInputs) {
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
  //    (les remplacements par la réserve sont contrôlés à part, en 5)
  const idx = new Map(r.agents.map((a, i) => [a.matricule, i]));
  const inReserve = new Set<string>(); // "matricule|jour"
  for (const s of r.swaps.filter((x) => x.kind === "reserve")) for (const d of s.weekDays!) [s.a.matricule, s.b.matricule].forEach((m) => inReserve.add(`${m}|${d}`));
  let offCount = 0;
  let frozenTouched = 0;
  r.before.forEach((row, i) => {
    const mat = r.agents[i].matricule;
    const perWeek = (state: Cell[]) => {
      const m = new Map<string, number>();
      state.forEach((c, d) => !inReserve.has(`${mat}|${d}`) && c.k === "off" && m.set(weekKey(r.dates[d]), (m.get(weekKey(r.dates[d])) ?? 0) + 1));
      return [...m.entries()].sort().join(",");
    };
    if (perWeek(row) !== perWeek(r.after[i])) offCount++;
    row.forEach((c, d) => {
      if (inReserve.has(`${mat}|${d}`)) return;
      const a = r.after[i][d];
      if (r.changed[i][d] && (!["shift", "off"].includes(c.k) || !["shift", "off"].includes(a.k))) frozenTouched++;
      if (r.changed[i][d] && r.agents[i].frozen) frozenTouched++;
    });
  });
  // 3) aucune nouvelle violation de repos
  const minRest = r.settings.minRestHours * 60;
  let rest = 0;
  const viol = (a: Cell, b: Cell) => a.k === "shift" && b.k === "shift" && b.arr + 1440 - a.dep < minRest;
  // pour un remplaçant, la référence d'un jour de remplacement est la case d'origine de l'agent remplacé
  const source = new Map<string, number>();
  for (const s of r.swaps.filter((x) => x.kind === "reserve")) for (const d of s.weekDays!) source.set(`${s.b.matricule}|${d}`, idx.get(s.a.matricule)!);
  const ref = (i: number, d: number) => {
    const src = source.get(`${r.agents[i].matricule}|${d}`);
    return src === undefined ? r.before[i][d] : r.before[src][d];
  };
  r.after.forEach((row, i) => {
    for (let d = 1; d < row.length; d++) if (viol(row[d - 1], row[d]) && !viol(ref(i, d - 1), ref(i, d))) rest++;
  });
  // 4) aucun échange entre fonctions différentes ; échanges OFF dans la même semaine
  const crossFn = r.settings.respectFunction ? r.swaps.filter((s) => norm(s.a.fonction) !== norm(s.b.fonction)).length : 0;
  const crossWeek = r.swaps.filter((s) => s.kind === "off" && weekKey(s.date) !== weekKey(s.date2!)).length;
  // 5) réserve : R reprend exactement la semaine de A, A est « REMPLACÉ », R était hors planning, même fonction / pôle
  const same = (a: Cell, b: Cell) => JSON.stringify(a) === JSON.stringify(b);
  let reserve = 0;
  for (const s of r.swaps.filter((x) => x.kind === "reserve")) {
    const ia = idx.get(s.a.matricule)!;
    const ir = idx.get(s.b.matricule)!;
    const ok =
      r.agents[ir].reserve === true &&
      norm(s.a.fonction) === norm(s.b.fonction) &&
      !(s.a.pole && s.b.pole && s.a.pole !== s.b.pole) &&
      s.weekDays!.every((d) => same(r.after[ir][d], r.before[ia][d]) && r.after[ia][d].k === "code" && r.before[ir][d].k === "code");
    if (!ok) reserve++;
  }
  const crossPole = r.swaps.filter((s) => s.a.pole && s.b.pole && s.a.pole !== s.b.pole).length;
  // 6) aménagements, vérifiés à part à partir des données brutes : aucune case modifiée pour une personne
  //    qui a un aménagement (sauf rôle seul quand le réglage « rôles échangeables » est activé)
  let amenTouched = 0;
  if (inputs) {
    const freezes = new Set(inputs.amenagements.filter((a) => a.texte && !(r.settings.swapRoles && isRoleOnly(a.texte))).map((a) => a.matricule));
    r.agents.forEach((a, i) => freezes.has(a.matricule) && r.changed[i].some(Boolean) && amenTouched++);
  }
  return { coverage, offCount, frozenTouched, rest, crossFn, crossPole, crossWeek, reserve, amenTouched };
}

function summary(label: string, r: OptimizationResult, inputs: ParsedInputs) {
  const mb = r.metricsBefore;
  const ma = r.metricsAfter;
  const off = r.swaps.filter((s) => s.kind === "off").length;
  const res = r.swaps.filter((s) => s.kind === "reserve").length;
  console.log(
    `${label.padEnd(26)} véhicules ${mb.vehicles} → ${ma.vehicles} (−${mb.vehicles - ma.vehicles}, −${((100 * (mb.vehicles - ma.vehicles)) / Math.max(1, mb.vehicles)).toFixed(1)} %)` +
      ` | ramassage ${mb.pickupVehicles}→${ma.pickupVehicles}, remisage ${mb.dropVehicles}→${ma.dropVehicles}` +
      ` | ≤4 pers. ${mb.smallVehicles}→${ma.smallVehicles} | échanges ${r.swaps.length} (dont OFF ${off}, réserve ${res}), plans ${new Set(r.swaps.map((s) => s.planId)).size}`
  );
  const figesAmen = r.agents.filter((a) => a.frozen?.startsWith("Aménagement")).length;
  const roles = r.alerts.filter((a) => a.code === "amenagement-role").length;
  console.log(" ".repeat(26), `aménagements : ${figesAmen} agent(s) figé(s), ${roles} rôle(s) seul(s) libéré(s)`);
  console.log(" ".repeat(26), "contrôles (tous à 0) :", JSON.stringify(checks(r, inputs)));
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
        ["sans contrainte fonction", { respectFunction: false, offSwap: false, useReserve: false }],
        ["fonction seule", { respectFunction: true, offSwap: false, useReserve: false }],
        ["fonction + échange OFF", { respectFunction: true, offSwap: true, useReserve: false }],
        ["+ réserve hors planning", { respectFunction: true, offSwap: true, useReserve: true }],
        ["+ rôles échangeables", { respectFunction: true, offSwap: true, useReserve: true, swapRoles: true }],
      ]
    : [["réglages par défaut", {}]];
  let last: OptimizationResult | null = null;
  for (const [label, s] of variants) {
    const t0 = Date.now();
    const r = optimize(inputs, { ...DEFAULT_SETTINGS, ...s });
    summary(`${label} (${((Date.now() - t0) / 1000).toFixed(1)} s)`, r, inputs);
    last = r;
  }
  if (!last) return;
  const byCode: Record<string, number> = {};
  last.alerts.forEach((a) => (byCode[a.code] = (byCode[a.code] ?? 0) + 1));
  console.log("alertes :", byCode);
  for (const s of last.swaps.filter((x) => x.kind === "off").slice(0, 2)) console.log("  ex. OFF :", s.reason);
  for (const s of last.swaps.filter((x) => x.kind === "jour").slice(0, 1)) console.log("  ex. jour :", s.reason);
  for (const s of last.swaps.filter((x) => x.kind === "reserve").slice(0, 3)) console.log("  ex. réserve :", s.reason);
}
main();
