import ExcelJS from "exceljs";
import { buildSample, type SampleSet } from "./sample";

export type TemplateName = "planning" | "agents" | "axes" | "amenagements";

const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
const HEAD_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.fill = HEAD_FILL;
    c.font = HEAD_FONT;
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
}

function readme(wb: ExcelJS.Workbook, lines: string[]) {
  const ws = wb.addWorksheet("LISEZ-MOI");
  ws.getColumn(1).width = 110;
  lines.forEach((l, i) => {
    const c = ws.getCell(i + 1, 1);
    c.value = l;
    c.alignment = { wrapText: true, vertical: "top" };
    if (i === 0) c.font = { bold: true, size: 14 };
  });
}

export function addPlanningSheet(
  wb: ExcelJS.Workbook,
  title: string,
  dates: string[],
  rows: { matricule: string; nom: string; cells: { arr: number | string | null; dep: number | string | null }[] }[],
  changed?: boolean[][]
) {
  const ws = wb.addWorksheet(title);
  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 34;
  const h1 = ws.getRow(1);
  const h2 = ws.getRow(2);
  h1.getCell(1).value = "Matricule";
  h1.getCell(2).value = "Nom et Prenom";
  ws.mergeCells(1, 1, 2, 1);
  ws.mergeCells(1, 2, 2, 2);
  dates.forEach((iso, d) => {
    const c = 3 + d * 2;
    h1.getCell(c).value = new Date(iso + "T00:00:00Z");
    h1.getCell(c).numFmt = "ddd dd/mm/yyyy";
    ws.mergeCells(1, c, 1, c + 1);
    h2.getCell(c).value = "heure d'arrivée";
    h2.getCell(c + 1).value = "heure de départ";
    ws.getColumn(c).width = 11;
    ws.getColumn(c + 1).width = 11;
  });
  styleHeader(h1);
  styleHeader(h2);
  h1.height = 22;
  rows.forEach((r, i) => {
    const row = ws.getRow(3 + i);
    row.getCell(1).value = r.matricule;
    row.getCell(2).value = r.nom;
    r.cells.forEach((cell, d) => {
      const a = row.getCell(3 + d * 2);
      const b = row.getCell(4 + d * 2);
      a.value = cell.arr;
      b.value = cell.dep;
      for (const x of [a, b]) {
        if (typeof x.value === "number") x.numFmt = "hh:mm";
        x.alignment = { horizontal: "center" };
        if (x.value === "OFF") x.font = { color: { argb: "FF9AA5B1" } };
        if (x.value === "CONGE") x.font = { color: { argb: "FFB45309" }, bold: true };
        if (changed?.[i]?.[d]) x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE08A" } };
      }
    });
  });
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 2 }];
  return ws;
}

function planningWorkbook(s: SampleSet) {
  const wb = new ExcelJS.Workbook();
  addPlanningSheet(wb, "Planning Agents S+1", s.dates, s.planning);
  readme(wb, [
    "Modèle : planning de la semaine",
    "Feuille « Planning Agents S+1 » : 2 lignes d'en-tête.",
    "Ligne 1 : « Matricule », « Nom et Prenom », puis une DATE par jour (cellule fusionnée sur 2 colonnes).",
    "Ligne 2 : sous chaque date, « heure d'arrivée » puis « heure de départ ».",
    "Cases : une heure (07:00), ou OFF, ou CONGE. Seul un OFF peut être échangé (échange de jour OFF entre 2 agents de même fonction, dans la même semaine). Toute autre valeur (C, CM, RC, Récup, D, P…) est conservée telle quelle et la case n'est jamais échangée.",
    "Le nom de la feuille peut changer : l'outil reconnaît la feuille grâce à « Matricule » + les dates.",
  ]);
  return wb;
}

function agentsWorkbook(s: SampleSet) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Agents");
  ws.addRow(["Matricule", "Nom et Prenom", "Fonction", "Commune", "Niveau", "Tardifs historique"]);
  styleHeader(ws.getRow(1));
  [12, 34, 30, 26, 14, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  s.agents.forEach((a) => ws.addRow([a.matricule, a.nom, a.fonction, a.commune, a.niveau, a.historique]));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  readme(wb, [
    "Modèle : liste des agents",
    "Une ligne par agent. En-têtes reconnus (accents et majuscules ignorés) :",
    "• Matricule (obligatoire) — le même que dans le planning.",
    "• Fonction (obligatoire) — deux agents ne s'échangent que s'ils ont exactement la même fonction (ex. « CSA Appels Entrants MVOLA »). Le fichier Personnes-par-fonction convient tel quel.",
    "• Axe 21h / Axe 23h (facultatif) — axe direct de l'agent ; sinon il est déduit de la commune avec la table des axes.",
    "• Commune (obligatoire) — doit correspondre à une ligne de la table des axes. Alias acceptés : Commune/Fokotany/Repère map, Repère, Quartier.",
    "• Niveau — Perf, Midle ou Débutant. Alias : « Statut d'agents ». Vide = niveau inconnu.",
    "• Tardifs historique (facultatif) — nombre de shifts tardifs déjà faits, pour l'équité.",
    "• Nom et Prenom — facultatif, pour l'affichage.",
  ]);
  return wb;
}

function axesWorkbook(s: SampleSet) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Axes");
  ws.addRow(["Commune/Fokotany/Repère map", "Axe 23h", "Axe 21h", "Chauffeur à 19h", "Chauffeur à 21h", "Distance (km)", "Durée en minutes"]);
  styleHeader(ws.getRow(1));
  [30, 12, 12, 24, 24, 14, 16].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  s.axes.forEach((a) => ws.addRow([a.commune, a.axe19, a.axe21, a.ch19, a.ch21, a.km, a.min]));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  readme(wb, [
    "Modèle : table commune → axe",
    "Une ligne par commune / fokotany / repère.",
    "• Colonne commune (obligatoire) : « Commune », « Commune/Fokotany/Repère map », « Repère » ou « Quartier ».",
    "• Une ou plusieurs colonnes d'axe dont l'en-tête commence par « Axe » (Axe 23h, Axe 21h). « Axe 21h » sert aux vagues de 21h et 22h, « Axe 23h » au ramassage de 6h et aux remisages de 18h, 19h, 20h et 23h (modifiable dans les réglages).",
    "• Colonnes « Chauffeur … » (facultatif) : appariées aux colonnes d'axe dans le même ordre.",
    "• Durée en minutes (facultatif) : sert à départager les cas égaux (trajet le plus court). Distance (km) facultative.",
  ]);
  return wb;
}

function amenagementsWorkbook(s: SampleSet) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Amenagements");
  ws.addRow(["Matricule", "Nom et Prenom", "Aménagement", "Congé début", "Congé fin"]);
  styleHeader(ws.getRow(1));
  [12, 34, 50, 14, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  s.amenagements.forEach((a) => {
    const r = ws.addRow([a.matricule, a.nom, a.texte, a.debut ? new Date(a.debut + "T00:00:00Z") : null, a.fin ? new Date(a.fin + "T00:00:00Z") : null]);
    r.getCell(4).numFmt = "dd/mm/yyyy";
    r.getCell(5).numFmt = "dd/mm/yyyy";
  });
  readme(wb, [
    "Modèle : aménagements et congés (facultatif)",
    "• Matricule (obligatoire).",
    "• Aménagement : texte libre. Tout agent avec un aménagement est FIGÉ (jamais échangé). Si le texte n'est pas compris, une alerte est levée.",
    "• Congé début / Congé fin : dates. Aucun échange n'est fait sur ces jours pour cet agent.",
    "Cette feuille peut être la feuille « Amenagement_S41 » existante : colonnes Matricules, Quartier, Statut d'agents, Aménagement, Congé.",
  ]);
  return wb;
}

export async function buildTemplate(name: TemplateName, full = false): Promise<Buffer> {
  const s = buildSample(full ? 80 : 12);
  const wb = name === "planning" ? planningWorkbook(s) : name === "agents" ? agentsWorkbook(s) : name === "axes" ? axesWorkbook(s) : amenagementsWorkbook(s);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/** Jeu complet : 4 classeurs, utilisé par la démo (passe par le vrai parseur). */
export async function buildDemoFiles(): Promise<{ name: string; buffer: Buffer }[]> {
  const names: TemplateName[] = ["planning", "agents", "axes", "amenagements"];
  const out: { name: string; buffer: Buffer }[] = [];
  for (const n of names) out.push({ name: `exemple-${n}.xlsx`, buffer: await buildTemplate(n, true) });
  return out;
}
