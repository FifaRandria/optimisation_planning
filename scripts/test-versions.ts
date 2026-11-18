// Usage : npx tsx scripts/test-versions.ts
// Versions du planning corrigé, sur les données de démo (semaine du lundi 16/11/2026, « aujourd'hui » = mercredi 18/11) :
// v1 = renfort hors planning + absence, ré-optimisée ; v2 = changement d'horaire, recalcul seul.
// Chaque contrôle doit valoir 0.
import { parseWorkbooks } from "../lib/parse";
import { optimize } from "../lib/optimize";
import { buildDemoFiles } from "../lib/templates";
import { DEFAULT_SETTINGS, type Cell, type OptimizationResult, type VersionRequest } from "../lib/types";
import { buildVersion, VersionError } from "../lib/versions";
import { checks } from "./run-real";

const START = "2026-11-16";
const TODAY = "2026-11-18";
const same = (a: Cell, b: Cell) => JSON.stringify(a) === JSON.stringify(b);
let failures = 0;
const expect = (label: string, n: number) => {
  console.log(`${n === 0 ? "ok  " : "ÉCHEC"} ${label} : ${n}`);
  if (n !== 0) failures++;
};

/** Contrôles d'invariants des seuls échanges nouveaux, par rapport au planning de départ (version de base + modifications). */
function newSwapChecks(base: OptimizationResult, v: OptimizationResult, req: VersionRequest) {
  const bi = new Map(base.agents.map((a, i) => [a.matricule, i]));
  const start = v.agents.map((a) => {
    const i = bi.get(a.matricule);
    const row = i !== undefined ? base.after[i].map((c) => c) : v.dates.map((): Cell => ({ k: "code", raw: "HORS PLANNING" }));
    for (const e of req.edits) if (e.matricule === a.matricule) row[e.dayIndex] = e.cell;
    return row;
  });
  const pseudo: OptimizationResult = {
    ...v,
    before: start,
    changed: v.after.map((row, i) => row.map((c, d) => !same(c, start[i][d]))),
    swaps: v.swaps.filter((s) => s.version === v.version),
  };
  return checks(pseudo);
}

async function main() {
  const inputs = parseWorkbooks(await buildDemoFiles(START));
  if (!inputs.planning) throw new Error("planning de démo manquant");
  const v0 = { ...optimize(inputs, DEFAULT_SETTINGS), version: 0 };
  const past = v0.dates.map((d) => d < TODAY);
  console.log(`v0 : ${v0.metricsBefore.vehicles} → ${v0.metricsAfter.vehicles} véhicules, ${v0.swaps.length} échanges ; jours passés : ${past.filter(Boolean).length}`);

  // -- v1 : renfort hors planning sur un remisage 21h jeudi + absence d'un agent tardif vendredi ----------------
  const thu = 3;
  const fri = 4;
  const axeOf = v0.groupsAfter.find((g) => g.dayIndex === thu && g.wave === "21h")!.axe;
  const absent = v0.agents.findIndex((a, i) => !a.frozen && v0.after[i][fri].k === "shift" && !v0.changed[i][fri] && v0.groupsAfter.some((g) => g.dayIndex === fri && g.kind === "remisage" && g.members.some((m) => m.matricule === a.matricule)));
  const req1: VersionRequest = {
    baseVersion: 0,
    motif: "renfort",
    comment: "test",
    edits: [
      { matricule: "R-TEST-1", dayIndex: thu, cell: { k: "shift", arr: 12 * 60, dep: 21 * 60 } },
      { matricule: v0.agents[absent].matricule, dayIndex: fri, cell: { k: "code", raw: "ABSENT" } },
    ],
    newAgents: [{ matricule: "R-TEST-1", nom: "Renfort Test", fonction: v0.agents[0].fonction, axe21: axeOf, axe23: axeOf }],
    reoptimize: true,
    save: false,
  };
  const { result: v1, swapsNew } = buildVersion(v0, inputs, req1, { version: 1, today: TODAY, userName: "test" });
  const recalc1 = buildVersion(v0, inputs, { ...req1, reoptimize: false }, { version: 1, today: TODAY }).result;
  console.log(`v1 : ${v1.metricsAfter.vehicles} véhicules (recalcul seul : ${recalc1.metricsAfter.vehicles}), ${swapsNew} échange(s) nouveau(x), ${v1.edits!.length} modification(s), ${v1.transportChanges!.length} groupe(s) de transport changé(s)`);

  const i0 = new Map(v0.agents.map((a, i) => [a.matricule, i]));
  let pastChanged = 0;
  let announcedChanged = 0;
  v1.agents.forEach((a, i) => {
    const j = i0.get(a.matricule);
    if (j === undefined) return;
    v1.dates.forEach((_, d) => {
      if (past[d] && !same(v1.after[i][d], v0.after[j][d])) pastChanged++;
      if (v0.changed[j][d] && !same(v1.after[i][d], v0.after[j][d])) announcedChanged++;
    });
  });
  const iv = new Map(v1.agents.map((a, i) => [a.matricule, i]));
  const manualKept = req1.edits.filter((e) => !same(v1.after[iv.get(e.matricule)!][e.dayIndex], e.cell)).length;
  expect("jours passés modifiés", pastChanged);
  expect("échanges déjà annoncés défaits", announcedChanged);
  expect("modifications manuelles non respectées", manualKept);
  expect("renfort absent du résultat", iv.has("R-TEST-1") ? 0 : 1);
  expect("ré-optimisation moins bonne que le recalcul seul", v1.metricsAfter.vehicles > recalc1.metricsAfter.vehicles ? 1 : 0);
  expect("échanges proposés par le recalcul seul", recalc1.swaps.length - v0.swaps.length);
  expect("« avant » différent du planning publié", v1.metricsBefore.vehicles - v0.metricsBefore.vehicles);
  const inv = newSwapChecks(v0, v1, req1);
  for (const [k, n] of Object.entries(inv)) expect(`invariant ${k} (échanges nouveaux)`, n);

  // -- ré-optimisation réelle : base = planning NON optimisé, une modification, puis ré-optimisation -------
  const raw = { ...optimize(inputs, DEFAULT_SETTINGS, { lockedDays: v0.dates.map(() => true) }), version: 0 };
  const reqRaw: VersionRequest = { ...req1, newAgents: [], edits: [req1.edits[1]] };
  const { result: vr, swapsNew: sr } = buildVersion(raw, inputs, reqRaw, { version: 1, today: TODAY });
  console.log(`ré-optimisation depuis le planning brut : ${raw.metricsAfter.vehicles} → ${vr.metricsAfter.vehicles} véhicules, ${sr} échange(s) nouveau(x)`);
  expect("aucun échange trouvé par la ré-optimisation", sr > 0 && vr.metricsAfter.vehicles < raw.metricsAfter.vehicles ? 0 : 1);
  let rawPast = 0;
  vr.agents.forEach((a, i) => {
    const j = raw.agents.findIndex((x) => x.matricule === a.matricule);
    if (j >= 0) vr.dates.forEach((_, d) => past[d] && !same(vr.after[i][d], raw.after[j][d]) && rawPast++);
  });
  expect("jours passés modifiés (ré-optimisation réelle)", rawPast);
  for (const [k, n] of Object.entries(newSwapChecks(raw, vr, reqRaw))) expect(`invariant ${k} (ré-optimisation réelle)`, n);

  // -- v2 : changement d'horaire dimanche, recalcul seul -------------------------------------------------
  const sun = 6;
  const who = v1.agents.findIndex((a, i) => !a.frozen && v1.after[i][sun].k === "shift");
  const req2: VersionRequest = {
    baseVersion: 1,
    motif: "horaire",
    edits: [{ matricule: v1.agents[who].matricule, dayIndex: sun, cell: { k: "shift", arr: 14 * 60, dep: 23 * 60 } }],
    reoptimize: false,
    save: false,
  };
  const { result: v2, swapsNew: s2 } = buildVersion(v1, inputs, req2, { version: 2, today: TODAY });
  console.log(`v2 : ${v2.metricsAfter.vehicles} véhicules, ${v2.edits!.length} modifications cumulées`);
  expect("échanges nouveaux en recalcul seul", s2);
  expect("modifications de v1 perdues", v1.edits!.length + 1 - v2.edits!.length);

  // -- refus attendus -----------------------------------------------------------------------------------
  const refused = (f: () => unknown) => {
    try {
      f();
      return 1;
    } catch (e) {
      return e instanceof VersionError ? 0 : 1;
    }
  };
  expect("modification d'un jour passé acceptée", refused(() => buildVersion(v0, inputs, { ...req1, newAgents: [], edits: [{ ...req1.edits[1], dayIndex: 0 }] }, { version: 1, today: TODAY })));
  expect("agent inconnu accepté", refused(() => buildVersion(v0, inputs, { ...req1, newAgents: [] }, { version: 1, today: TODAY })));
  expect("période terminée acceptée", refused(() => buildVersion(v0, inputs, req1, { version: 1, today: "2026-12-31" })));

  console.log(failures ? `\n${failures} contrôle(s) en échec` : "\nTous les contrôles valent 0.");
  process.exit(failures ? 1 : 0);
}

main();
