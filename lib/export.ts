import ExcelJS from "exceljs";
import type { Cell, Group, OptimizationResult } from "./types";
import { dayLabel, fmtTime } from "./util";
import { waveLabel } from "./waves";
import { addPlanningSheet } from "./templates";

export type ExportKind = "planning" | "echanges" | "transport" | "complet";

const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };

function header(ws: ExcelJS.Worksheet, cols: { h: string; w: number }[]) {
  const r = ws.addRow(cols.map((c) => c.h));
  r.eachCell((c) => {
    c.fill = HEAD_FILL;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.w));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
}

function cellValue(c: Cell): { arr: number | string | null; dep: number | string | null } {
  switch (c.k) {
    case "shift":
      return { arr: (c.arr % 1440) / 1440, dep: (c.dep % 1440) / 1440 };
    case "off":
      return { arr: "OFF", dep: "OFF" };
    case "leave":
      return { arr: c.raw || "CONGE", dep: c.raw || "CONGE" };
    case "code":
      return { arr: c.raw, dep: c.raw };
    default:
      return { arr: null, dep: null };
  }
}

function sheetPlanning(wb: ExcelJS.Workbook, r: OptimizationResult) {
  const rows = r.agents.map((a, i) => ({ matricule: a.matricule, nom: a.nom, cells: r.after[i].map(cellValue) }));
  const ws = addPlanningSheet(wb, "Planning Agents S+1", r.dates, rows, r.changed);
  const n = ws.rowCount + 2;
  ws.getCell(n, 2).value = "Cases en jaune = shift modifié par l'optimisation (voir la feuille « Échanges »).";
  ws.getCell(n, 2).font = { italic: true };
}

function sheetEchanges(wb: ExcelJS.Workbook, r: OptimizationResult) {
  const ws = wb.addWorksheet("Échanges");
  header(ws, [
    { h: "N°", w: 6 },
    { h: "Plan", w: 8 },
    { h: "Type", w: 12 },
    { h: "Jour", w: 12 },
    { h: "2e jour (échange OFF)", w: 12 },
    { h: "Action", w: 32 },
    { h: "Fonction", w: 28 },
    { h: "Agent A (quitte le transport) — Matricule", w: 16 },
    { h: "Agent A — Nom", w: 30 },
    { h: "A — Axe", w: 10 },
    { h: "A — Avant", w: 26 },
    { h: "A — Après", w: 26 },
    { h: "Agent B (partenaire) — Matricule", w: 16 },
    { h: "Agent B — Nom", w: 30 },
    { h: "B — Axe", w: 10 },
    { h: "B — Avant", w: 26 },
    { h: "B — Après", w: 26 },
    { h: "Niveau", w: 11 },
    { h: "Véhicules économisés (plan)", w: 14 },
    { h: "Raison", w: 110 },
  ]);
  for (const s of r.swaps)
    ws.addRow([
      s.id,
      s.planId,
      s.kind === "off" ? "Jour OFF" : "Même jour",
      dayLabel(s.date),
      s.date2 ? dayLabel(s.date2) : "",
      s.planSummary,
      s.a.fonction,
      s.a.matricule,
      s.a.nom,
      s.a.axe,
      s.a.before,
      s.a.after,
      s.b.matricule,
      s.b.nom,
      s.b.axe,
      s.b.before,
      s.b.after,
      s.a.niveau,
      s.vehiclesSaved,
      s.reason,
    ]);
}

function sheetGroups(wb: ExcelJS.Workbook, title: string, groups: Group[]) {
  const ws = wb.addWorksheet(title);
  header(ws, [
    { h: "Jour", w: 12 },
    { h: "Transport", w: 18 },
    { h: "Axe", w: 10 },
    { h: "Chauffeur", w: 26 },
    { h: "Véhicules", w: 10 },
    { h: "Pers. dans l'axe", w: 10 },
    { h: "Heure (entrée / sortie)", w: 12 },
    { h: "Matricule", w: 12 },
    { h: "Nom", w: 32 },
    { h: "Commune", w: 26 },
    { h: "Trajet (min)", w: 11 },
  ]);
  for (const g of groups)
    for (const m of g.members) ws.addRow([dayLabel(g.date), waveLabel(g.kind, g.wave), g.axe, g.chauffeur ?? "", g.vehicles, g.members.length, fmtTime(m.dep), m.matricule, m.nom, m.commune, m.duree ?? ""]);
}

function sheetChauffeurs(wb: ExcelJS.Workbook, title: string, groups: Group[]) {
  const ws = wb.addWorksheet(title);
  header(ws, [
    { h: "Chauffeur", w: 28 },
    { h: "Jour", w: 12 },
    { h: "Transport", w: 18 },
    { h: "Axe", w: 10 },
    { h: "Nb personnes", w: 13 },
    { h: "Véhicules requis", w: 15 },
    { h: "Agents", w: 120 },
  ]);
  const sorted = groups.slice().sort((a, b) => (a.chauffeur ?? "~").localeCompare(b.chauffeur ?? "~") || a.dayIndex - b.dayIndex || a.kind.localeCompare(b.kind) || a.wave.localeCompare(b.wave, "fr", { numeric: true }));
  for (const g of sorted) ws.addRow([g.chauffeur ?? "(non renseigné)", dayLabel(g.date), waveLabel(g.kind, g.wave), g.axe, g.members.length, g.vehicles, g.members.map((m) => `${m.nom} (${m.commune})`).join(" ; ")]);
}

function sheetSynthese(wb: ExcelJS.Workbook, r: OptimizationResult) {
  const ws = wb.addWorksheet("Synthèse");
  header(ws, [
    { h: "Jour", w: 14 },
    { h: "Personnes transportées", w: 14 },
    { h: "Véhicules avant", w: 12 },
    { h: "Véhicules après", w: 12 },
    { h: "Gain", w: 8 },
    { h: "Ramassage avant", w: 12 },
    { h: "Ramassage après", w: 12 },
    { h: "Remisage avant", w: 12 },
    { h: "Remisage après", w: 12 },
    { h: "Pers./véhicule avant", w: 14 },
    { h: "Pers./véhicule après", w: 14 },
  ]);
  r.dates.forEach((d, i) => {
    const b = r.metricsBefore.perDay[i];
    const a = r.metricsAfter.perDay[i];
    ws.addRow([dayLabel(d), a.transported, b.vehicles, a.vehicles, b.vehicles - a.vehicles, b.pickupVehicles, a.pickupVehicles, b.dropVehicles, a.dropVehicles, b.vehicles ? +(b.transported / b.vehicles).toFixed(2) : 0, a.vehicles ? +(a.transported / a.vehicles).toFixed(2) : 0]);
  });
  const mb = r.metricsBefore;
  const ma = r.metricsAfter;
  const t = ws.addRow(["TOTAL", ma.transported, mb.vehicles, ma.vehicles, mb.vehicles - ma.vehicles, mb.pickupVehicles, ma.pickupVehicles, mb.dropVehicles, ma.dropVehicles,+mb.avgPerVehicle.toFixed(2), +ma.avgPerVehicle.toFixed(2)]);
  t.font = { bold: true };
  ws.addRow([]);
  ws.addRow([`Véhicules ≤ 4 personnes : ${mb.smallVehicles} avant → ${ma.smallVehicles} après`]);
  const nOff = r.swaps.filter((x) => x.kind === "off").length;
  ws.addRow([`Échanges proposés : ${r.swaps.length} (dont ${nOff} échanges de jour OFF)`]);
  const st = r.settings;
  ws.addRow([
    `Réglages : ${st.capacity} places/véhicule, repos ${st.minRestHours} h, ramassage à ${st.pickupHours.join("h, ")}h, remisage à ${st.dropHours.join("h, ")}h, ` +
      `« Axe 21h » pour ${st.axe21Waves.length ? st.axe21Waves.join("h, ") + "h" : "aucune vague"}, même fonction ${st.respectFunction ? "oui" : "non"}, ` +
      `échange OFF ${st.offSwap ? "oui" : "non"}, équité tardifs ${st.fairnessWeight}, équité week-ends ${st.weekendWeight}`,
  ]);
}

function sheetAlertes(wb: ExcelJS.Workbook, r: OptimizationResult) {
  const ws = wb.addWorksheet("Alertes");
  header(ws, [
    { h: "Niveau", w: 10 },
    { h: "Type", w: 22 },
    { h: "Matricule", w: 12 },
    { h: "Nom", w: 32 },
    { h: "Message", w: 120 },
  ]);
  const order = { error: 0, warn: 1, info: 2 } as const;
  for (const a of r.alerts.slice().sort((x, y) => order[x.level] - order[y.level])) ws.addRow([a.level === "error" ? "Erreur" : a.level === "warn" ? "Attention" : "Info", a.code, a.matricule ?? "", a.nom ?? "", a.message]);
}

export async function buildExport(r: OptimizationResult, kind: ExportKind): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Optimiseur transport";
  if (kind === "planning") sheetPlanning(wb, r);
  if (kind === "echanges") {
    sheetEchanges(wb, r);
    sheetSynthese(wb, r);
  }
  if (kind === "transport") {
    sheetGroups(wb, "Transport après (par axe)", r.groupsAfter);
    sheetChauffeurs(wb, "Par chauffeur après", r.groupsAfter);
    sheetGroups(wb, "Transport avant (par axe)", r.groupsBefore);
    sheetChauffeurs(wb, "Par chauffeur avant", r.groupsBefore);
  }
  if (kind === "complet") {
    sheetSynthese(wb, r);
    sheetPlanning(wb, r);
    sheetEchanges(wb, r);
    sheetGroups(wb, "Transport après (par axe)", r.groupsAfter);
    sheetChauffeurs(wb, "Par chauffeur après", r.groupsAfter);
    sheetGroups(wb, "Transport avant (par axe)", r.groupsBefore);
    sheetAlertes(wb, r);
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
