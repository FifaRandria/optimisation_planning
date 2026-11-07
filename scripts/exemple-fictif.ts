// Exemple fictif utilisé dans docs/algo-optimisation/Algorithme_Optimisation_Planning.pptx
// Usage : npx tsx scripts/exemple-fictif.ts
// 1) écrit les 4 classeurs Excel de l'exemple dans docs/algo-optimisation/
// 2) les relit avec le vrai parseur et lance le vrai algorithme (réglages par défaut)
// 3) affiche les groupes avant/après et les échanges, pour comparer avec le calcul fait à la main.
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { addPlanningSheet } from "../lib/templates";
import { parseWorkbooks } from "../lib/parse";
import { optimize } from "../lib/optimize";
import { DEFAULT_SETTINGS } from "../lib/types";

const OUT = path.join(__dirname, "..", "docs", "algo-optimisation");
const DATES = ["2026-11-09", "2026-11-10", "2026-11-11"]; // lundi, mardi, mercredi (le parseur exige au moins 3 dates)

const t = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h * 60 + m) / 1440; // fraction de jour, comme une vraie heure Excel
};
const shift = (a: string, b: string) => ({ arr: t(a), dep: t(b) });
const OFF = { arr: "OFF", dep: "OFF" };

const AXES = [
  { commune: "Ambohi", axe: "Axe 1", ch: "Chauffeur Rado", km: 12, min: 40 },
  { commune: "Bevalo", axe: "Axe 2", ch: "Chauffeur Solo", km: 9, min: 30 },
  { commune: "Belaza", axe: "Axe 2", ch: "Chauffeur Solo", km: 6, min: 20 },
  { commune: "Tsara", axe: "Axe 3", ch: "Chauffeur Tiana", km: 8, min: 25 },
  { commune: "Torana", axe: "Axe 3", ch: "Chauffeur Tiana", km: 11, min: 35 },
];

const AGENTS = [
  { mat: "AG001", nom: "Alice", fonction: "Conseiller client", niveau: "Midle", commune: "Ambohi", hist: 0, cells: [shift("12:00", "21:00"), OFF, OFF] },
  { mat: "AG002", nom: "Bruno", fonction: "Conseiller client", niveau: "Midle", commune: "Bevalo", hist: 0, cells: [shift("12:00", "21:00"), shift("12:00", "21:00"), OFF] },
  { mat: "AG003", nom: "Chloe", fonction: "Conseiller client", niveau: "Midle", commune: "Bevalo", hist: 0, cells: [shift("13:00", "21:00"), OFF, OFF] },
  { mat: "AG004", nom: "David", fonction: "Conseiller client", niveau: "Midle", commune: "Tsara", hist: 0, cells: [shift("12:00", "21:00"), OFF, OFF] },
  { mat: "AG005", nom: "Mamy", fonction: "Conseiller client", niveau: "Midle", commune: "Belaza", hist: 0, cells: [shift("08:00", "17:00"), shift("07:00", "16:00"), OFF] },
  { mat: "AG006", nom: "Emma", fonction: "Conseiller client", niveau: "Midle", commune: "Belaza", hist: 2, cells: [shift("08:00", "17:00"), OFF, OFF] },
  { mat: "AG007", nom: "Farid", fonction: "Conseiller client", niveau: "Midle", commune: "Torana", hist: 0, cells: [shift("08:00", "17:00"), OFF, OFF] },
  { mat: "AG008", nom: "Hery", fonction: "Conseiller client", niveau: "Midle", commune: "Bevalo", hist: 0, cells: [shift("07:00", "16:00"), OFF, OFF] },
  { mat: "AG009", nom: "Ivan", fonction: "Conseiller client", niveau: "Perf", commune: "Tsara", hist: 0, cells: [shift("08:00", "17:00"), OFF, OFF] },
  { mat: "AG010", nom: "Jeanne", fonction: "Conseiller client", niveau: "Midle", commune: "Belaza", hist: 0, cells: [shift("08:00", "17:00"), OFF, OFF] },
  { mat: "AG011", nom: "Koto", fonction: "Conseiller client", niveau: "Midle", commune: "Bevalo", hist: 0, cells: [OFF, OFF, OFF] },
  { mat: "AG012", nom: "Lova", fonction: "Conseiller client", niveau: "Midle", commune: "Bevalo", hist: 0, cells: [shift("13:00", "17:00"), OFF, OFF] },
  // autre fonction : meilleure candidate que Hery lundi (trajet 20 min), mais refusée (fonction différente)
  { mat: "AG013", nom: "Nina", fonction: "Trainer", niveau: "Midle", commune: "Belaza", hist: 0, cells: [shift("07:00", "16:00"), OFF, OFF] },
  // échange de jour OFF (mardi <-> mercredi) entre deux agents TERSEA
  { mat: "AG014", nom: "Olga", fonction: "Conseiller client TERSEA", niveau: "Midle", commune: "Ambohi", hist: 0, cells: [OFF, shift("12:00", "21:00"), OFF] },
  { mat: "AG015", nom: "Paul", fonction: "Conseiller client TERSEA", niveau: "Midle", commune: "Bevalo", hist: 0, cells: [OFF, OFF, shift("08:00", "17:00")] },
];

const AMENAGEMENTS = [{ mat: "AG010", nom: "Jeanne", texte: "Pas de nuit" }];

async function buildFiles() {
  const files: { name: string; wb: ExcelJS.Workbook }[] = [];

  const p = new ExcelJS.Workbook();
  addPlanningSheet(
    p,
    "Planning Agents S+1",
    DATES,
    AGENTS.map((a) => ({ matricule: a.mat, nom: a.nom, cells: a.cells }))
  );
  files.push({ name: "exemple_planning.xlsx", wb: p });

  const ag = new ExcelJS.Workbook();
  const wsA = ag.addWorksheet("Agents");
  wsA.addRow(["Matricule", "Nom et Prenom", "Fonction", "Commune", "Niveau", "Tardifs historique"]);
  AGENTS.forEach((a) => wsA.addRow([a.mat, a.nom, a.fonction, a.commune, a.niveau, a.hist]));
  files.push({ name: "exemple_agents.xlsx", wb: ag });

  const ax = new ExcelJS.Workbook();
  const wsX = ax.addWorksheet("Axes");
  wsX.addRow(["Commune/Fokotany/Repère map", "Axe 23h", "Axe 21h", "Chauffeur à 19h", "Chauffeur à 21h", "Distance (km)", "Durée en minutes"]);
  AXES.forEach((a) => wsX.addRow([a.commune, a.axe, a.axe, a.ch, a.ch, a.km, a.min]));
  files.push({ name: "exemple_axes.xlsx", wb: ax });

  const am = new ExcelJS.Workbook();
  const wsM = am.addWorksheet("Amenagements");
  wsM.addRow(["Matricule", "Nom et Prenom", "Aménagement", "Congé début", "Congé fin"]);
  AMENAGEMENTS.forEach((a) => wsM.addRow([a.mat, a.nom, a.texte, null, null]));
  files.push({ name: "exemple_amenagements.xlsx", wb: am });

  fs.mkdirSync(OUT, { recursive: true });
  const out: { name: string; buffer: Buffer }[] = [];
  for (const f of files) {
    const buffer = Buffer.from((await f.wb.xlsx.writeBuffer()) as ArrayBuffer);
    fs.writeFileSync(path.join(OUT, f.name), buffer);
    out.push({ name: f.name, buffer });
  }
  return out;
}

async function main() {
  const files = await buildFiles();
  const inputs = parseWorkbooks(files);
  console.log("Détection :", inputs.detection.map((d) => `${d.role}=${d.file}/${d.sheet} (${d.rows})`).join(" | "));
  const r = optimize(inputs, DEFAULT_SETTINGS);

  const show = (label: string, gs: typeof r.groupsBefore) => {
    console.log(`\n${label}`);
    for (const g of gs) console.log(`  ${g.date} ${g.wave} ${g.axe} : ${g.members.map((m) => m.nom).join(", ")} → ${g.vehicles} véhicule(s)`);
  };
  show("GROUPES AVANT", r.groupsBefore);
  show("GROUPES APRÈS", r.groupsAfter);
  console.log(`\nVéhicules : ${r.metricsBefore.vehicles} → ${r.metricsAfter.vehicles}`);
  console.log("\nÉCHANGES :");
  for (const s of r.swaps)
    console.log(`  Plan ${s.planId} [${s.planSummary}] (${s.kind}) ${s.a.nom} ${s.a.before}→${s.a.after}  ⇄  ${s.b.nom} ${s.b.before}→${s.b.after}\n     ${s.reason}`);
  console.log("\nAgents figés :", r.agents.filter((a) => a.frozen).map((a) => `${a.nom} (${a.frozen})`).join(", ") || "aucun");
  console.log("Alertes :", r.alerts.map((a) => `[${a.code}] ${a.nom ?? ""} ${a.message}`).join("\n  "));
}
main();
