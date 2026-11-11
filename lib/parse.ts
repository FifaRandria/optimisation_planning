import * as XLSX from "xlsx";
import type {
  Alert,
  AgentInfo,
  Amenagement,
  AxeRow,
  AxeTable,
  Cell,
  DetectedSource,
  ParsedInputs,
  Planning,
  PlanningAgent,
} from "./types";
import {
  axeKey,
  isBlank,
  isExcelDateSerial,
  norm,
  normMatricule,
  parseDate,
  parseLevel,
  parseTime,
  str,
  toNumber,
} from "./util";

type Rows = unknown[][];
export interface UploadedFile {
  name: string;
  buffer: Buffer;
}

const MATRICULE_RE = /^[A-Z]{1,4}\d{3,6}$/;
const SCAN_ROWS = 15;

function sheetRows(ws: XLSX.WorkSheet): Rows {
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
}

function findCol(header: unknown[], pred: (n: string) => boolean): number {
  for (let c = 0; c < header.length; c++) if (pred(norm(header[c]))) return c;
  return -1;
}

// ---------------------------------------------------------------------------
// PLANNING
// ---------------------------------------------------------------------------

interface PlanningLayout {
  headerRow: number;
  matCol: number;
  nomCol: number;
  fonctionCol: number;
  dateCols: { col: number; iso: string }[];
  firstDataRow: number;
}

function detectPlanningLayout(rows: Rows): PlanningLayout | null {
  for (let h = 0; h < Math.min(rows.length, 8); h++) {
    const row = rows[h] || [];
    const matCol = findCol(row, (n) => n === "matricule" || n === "matricules" || n === "mat");
    if (matCol < 0) continue;
    // la ligne des dates : h ou h+1 ou h-1
    for (const dr of [h, h + 1, h - 1]) {
      if (dr < 0 || dr >= rows.length) continue;
      const r = rows[dr] || [];
      const dateCols: { col: number; iso: string }[] = [];
      for (let c = matCol + 1; c < r.length; c++) {
        const v = r[c];
        if (v === null || v === undefined || v === "") continue;
        const typed = isExcelDateSerial(v) || v instanceof Date || /^\d{4}-\d{2}-\d{2}/.test(String(v)) || /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}$/.test(String(v));
        if (!typed) continue;
        const iso = parseDate(v);
        if (iso) dateCols.push({ col: c, iso });
      }
      if (dateCols.length >= 3) return finishLayout(rows, h, matCol, dateCols, Math.max(h, dr));
    }
    // Planning mensuel : une ligne de numéros de jour (1, 2, 3…) + une colonne « Mois » qui porte la date
    const moisCol = findCol(row, (n) => n === "mois");
    if (moisCol < 0) continue;
    let base: string | null = null;
    for (let r = h + 1; r < Math.min(rows.length, h + 6) && !base; r++) base = parseDate((rows[r] || [])[moisCol]);
    if (!base) continue;
    for (const dr of [h - 1, h + 1]) {
      if (dr < 0 || dr >= rows.length) continue;
      const r = rows[dr] || [];
      const nums: { col: number; day: number }[] = [];
      for (let c = matCol + 1; c < r.length; c++) {
        const v = r[c];
        if (v === null || v === undefined || v === "") continue;
        const n = typeof v === "number" ? v : /^\d{1,2}$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN;
        if (Number.isInteger(n) && n >= 1 && n <= 31) nums.push({ col: c, day: n });
      }
      if (nums.length < 3) continue;
      let y = Number(base.slice(0, 4));
      let m = Number(base.slice(5, 7));
      // « Mois » doit être un 1er du mois : 10/01 saisi pour 01/10 (jour et mois inversés) => octobre
      const bd = Number(base.slice(8, 10));
      if (bd !== 1 && bd <= 12) m = bd;
      const dateCols: { col: number; iso: string }[] = [];
      nums.forEach((x, i) => {
        if (i > 0 && x.day < nums[i - 1].day) {
          m++;
          if (m > 12) {
            m = 1;
            y++;
          }
        }
        const iso = `${y}-${String(m).padStart(2, "0")}-${String(x.day).padStart(2, "0")}`;
        if (new Date(iso + "T00:00:00Z").getUTCDate() === x.day) dateCols.push({ col: x.col, iso });
      });
      if (dateCols.length >= 3) return finishLayout(rows, h, matCol, dateCols, Math.max(h, dr));
    }
  }
  return null;
}

function finishLayout(rows: Rows, h: number, matCol: number, dateCols: { col: number; iso: string }[], lastHeader: number): PlanningLayout {
  const row = rows[h] || [];
  let nomCol = findCol(row, (n) => n.startsWith("nom"));
  if (nomCol < 0) nomCol = matCol + 1;
  const fonctionCol = findCol(row, (n) => n === "fonction" || n === "poste");
  return { headerRow: h, matCol, nomCol, fonctionCol, dateCols, firstDataRow: lastHeader + 1 };
}

function parseCell(a: unknown, d: unknown): Cell {
  const sa = str(a);
  const sd = str(d);
  if (!sa && !sd) return { k: "empty" };
  const na = norm(sa);
  const nd = norm(sd);
  // seul un vrai OFF est échangeable ; RC (repos compensateur), Récup, CM, C… restent figés
  const isOff = (n: string) => n === "off" || n === "repos";
  // OFF seulement si une moitié dit OFF et l'autre est OFF ou vide (« - » n'est pas un OFF : case figée)
  if ((isOff(na) && (isOff(nd) || !sd)) || (isOff(nd) && !sa)) return { k: "off", raw: sa || sd };
  const LEAVE = /^(conge|conges|cp|cge|cong|cm|c|rc|recup|recuperation|maladie|absent|abs)$/;
  if (LEAVE.test(na) || LEAVE.test(nd) || /^conge/.test(na)) return { k: "leave", raw: sa || sd };
  const ta = parseTime(a);
  const td = parseTime(d);
  if (ta !== null && td !== null) {
    return { k: "shift", arr: ta, dep: td <= ta ? td + 1440 : td };
  }
  return { k: "code", raw: sa && sd && sa !== sd ? `${sa}/${sd}` : sa || sd };
}

function readPlanning(rows: Rows, layout: PlanningLayout, file: string, sheet: string): Planning {
  const agents: PlanningAgent[] = [];
  const seen = new Set<string>();
  for (let r = layout.firstDataRow; r < rows.length; r++) {
    const row = rows[r] || [];
    const mat = normMatricule(row[layout.matCol]);
    if (!mat || !MATRICULE_RE.test(mat) || seen.has(mat)) continue;
    seen.add(mat);
    const cells = layout.dateCols.map(({ col }) => parseCell(row[col], row[col + 1]));
    const fonction = layout.fonctionCol >= 0 && !isBlank(row[layout.fonctionCol]) ? str(row[layout.fonctionCol]) : undefined;
    agents.push({ matricule: mat, nom: str(row[layout.nomCol]), fonction, row: r + 1, cells });
  }
  return { sheet, file, dates: layout.dateCols.map((d) => d.iso), agents };
}

// ---------------------------------------------------------------------------
// AGENTS (commune + niveau)
// ---------------------------------------------------------------------------

interface AgentsLayout {
  headerRow: number;
  matCol: number;
  nomCol: number;
  communeCols: number[]; // par ordre de priorité
  niveauCol: number;
  histCol: number;
  fonctionCol: number;
  axeCols: { col: number; key: string }[]; // « Axe 21h » -> "21h"
  poleCol: number; // « Pôles » (IT.xlsx) : FO / BO / SUPPORT
  etatCol: number; // « Etat du collaborateur » : ACTIF / INACTIF
  departCol: number; // « Date de départ »
}

export { axeKey } from "./util";

const NIVEAU_HEADERS = ["niveau", "statut d agents", "statut agent", "statut d agent", "level", "profil", "niveau agent"];

function detectAgentsLayout(rows: Rows): AgentsLayout | null {
  for (let h = 0; h < Math.min(rows.length, 8); h++) {
    const row = rows[h] || [];
    const matCol = findCol(row, (n) => n === "matricule" || n === "matricules" || n === "mat");
    if (matCol < 0) continue;
    const prio: [number, number][] = [];
    row.forEach((v, c) => {
      const n = norm(v);
      if (!n || c === matCol) return;
      if (n.includes("commune") && (n.includes("fokotany") || n.includes("repere"))) prio.push([0, c]);
      else if (n.includes("repere")) prio.push([1, c]);
      else if (n === "commune" || n.startsWith("commune") || n === "fokotany") prio.push([2, c]);
      else if (n.includes("quartier")) prio.push([3, c]);
      else if (n === "adresse" || n === "localite" || n === "zone") prio.push([4, c]);
    });
    prio.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const niveauCol = findCol(row, (n) => NIVEAU_HEADERS.includes(n));
    const fonctionCol = findCol(row, (n) => n === "fonction" || n === "poste");
    const poleCol = findCol(row, (n) => n === "pole" || n === "poles");
    const etatCol = findCol(row, (n) => n.startsWith("etat du collab") || n === "etat");
    const departCol = findCol(row, (n) => n === "date de depart");
    const axeCols: { col: number; key: string }[] = [];
    row.forEach((v, c) => {
      const k = axeKey(v);
      if (k && !axeCols.some((a) => a.key === k)) axeCols.push({ col: c, key: k });
    });
    if (prio.length === 0 && niveauCol < 0 && fonctionCol < 0) continue;
    let nomCol = findCol(row, (n) => n.startsWith("nom"));
    if (nomCol < 0) nomCol = -1;
    const histCol = findCol(row, (n) => n.includes("historique") || n.includes("tardif"));
    return { headerRow: h, matCol, nomCol, communeCols: prio.map((p) => p[1]), niveauCol, histCol, fonctionCol, axeCols, poleCol, etatCol, departCol };
  }
  return null;
}

function readAgents(rows: Rows, l: AgentsLayout): AgentInfo[] {
  const out: AgentInfo[] = [];
  for (let r = l.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const mat = normMatricule(row[l.matCol]);
    if (!mat || !MATRICULE_RE.test(mat)) continue;
    const communes: string[] = [];
    for (const c of l.communeCols) {
      const v = str(row[c]);
      if (v && !isBlank(v) && !communes.includes(v)) communes.push(v);
    }
    const axes: Record<string, string> = {};
    for (const a of l.axeCols) {
      const v = axeName(row[a.col]);
      if (v) axes[a.key] = v;
    }
    out.push({
      matricule: mat,
      nom: l.nomCol >= 0 ? str(row[l.nomCol]) || undefined : undefined,
      communes,
      niveau: l.niveauCol >= 0 ? parseLevel(row[l.niveauCol]) : "INCONNU",
      historique: l.histCol >= 0 ? Math.max(0, Math.round(toNumber(row[l.histCol]) ?? 0)) : 0,
      fonction: l.fonctionCol >= 0 && !isBlank(row[l.fonctionCol]) ? str(row[l.fonctionCol]) : undefined,
      axes: Object.keys(axes).length ? axes : undefined,
      pole: l.poleCol >= 0 && !isBlank(row[l.poleCol]) ? str(row[l.poleCol]).toUpperCase() : undefined,
      actif: l.etatCol >= 0 && !isBlank(row[l.etatCol]) ? norm(row[l.etatCol]) !== "inactif" : undefined,
      dateDepart: l.departCol >= 0 ? parseDate(row[l.departCol]) ?? undefined : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// AXES
// ---------------------------------------------------------------------------

export function axeName(v: unknown): string {
  const s = str(v);
  if (!s || isBlank(s)) return "";
  const m = s.match(/axe\s*(\d+)/i);
  return m ? `Axe ${parseInt(m[1], 10)}` : s;
}

interface AxesLayout {
  headerRow: number;
  communeCol: number;
  axeCols: { col: number; name: string }[];
  driverCols: number[];
  dureeCol: number;
  dureeIsText: boolean;
  distCol: number;
}

function detectAxesLayout(rows: Rows): AxesLayout | null {
  for (let h = 0; h < Math.min(rows.length, 6); h++) {
    const row = rows[h] || [];
    if (findCol(row, (n) => n === "matricule" || n === "matricules") >= 0) continue; // c'est une liste d'agents, pas une table d'axes
    const communeCol = findCol(row, (n) => n.includes("commune") || n.includes("fokotany") || n.includes("repere") || n === "quartier");
    if (communeCol < 0) continue;
    const axeCols: { col: number; name: string }[] = [];
    const driverCols: number[] = [];
    row.forEach((v, c) => {
      const n = norm(v);
      if (/^axes?( |$)/.test(n) && n !== "axes") axeCols.push({ col: c, name: str(v) });
      else if (n.includes("chauffeur")) driverCols.push(c);
    });
    if (axeCols.length === 0) continue;
    let dureeCol = findCol(row, (n) => n === "duree en minutes" || n === "duree min" || n === "duree minutes");
    let dureeIsText = false;
    if (dureeCol < 0) {
      dureeCol = findCol(row, (n) => n.startsWith("duree"));
      dureeIsText = dureeCol >= 0;
    }
    const distCol = findCol(row, (n) => n.startsWith("distance"));
    return { headerRow: h, communeCol, axeCols, driverCols, dureeCol, dureeIsText, distCol };
  }
  return null;
}

function readAxes(rows: Rows, l: AxesLayout, file: string, sheet: string): AxeTable {
  const out: AxeRow[] = [];
  // appariement colonne d'axe <-> colonne chauffeur : par position si possible, sinon par jeton horaire
  const driverFor = new Map<number, number>();
  if (l.driverCols.length === l.axeCols.length) l.axeCols.forEach((a, i) => driverFor.set(a.col, l.driverCols[i]));
  else
    for (const a of l.axeCols) {
      const tok = norm(a.name).match(/\d+\s?h/)?.[0].replace(/\s/g, "");
      const d = l.driverCols.find((c) => {
        const hv = String(rows[l.headerRow][c] ?? "").toLowerCase().replace(/\s/g, "");
        return tok && hv.includes(tok);
      });
      if (d !== undefined) driverFor.set(a.col, d);
    }
  for (let r = l.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const commune = str(row[l.communeCol]);
    if (!commune) continue;
    const axes: Record<string, string> = {};
    const chauffeurs: Record<string, string> = {};
    for (const a of l.axeCols) {
      const v = axeName(row[a.col]);
      if (v) axes[a.name] = v;
      const dc = driverFor.get(a.col);
      if (dc !== undefined) {
        const dv = str(row[dc]);
        if (dv) chauffeurs[a.name] = dv.replace(/\s*\/?\s*T[eé]l.*$/i, "").trim();
      }
    }
    if (Object.keys(axes).length === 0) continue;
    out.push({
      commune,
      axes,
      chauffeurs,
      duree: l.dureeCol >= 0 ? toNumber(row[l.dureeCol]) : undefined,
      distance: l.distCol >= 0 ? toNumber(row[l.distCol]) : undefined,
    });
  }
  return { sheet, file, rows: out, axeColumns: l.axeCols.map((a) => a.name) };
}

// ---------------------------------------------------------------------------
// AMENAGEMENTS / CONGES
// ---------------------------------------------------------------------------

interface AmenLayout {
  headerRow: number;
  matCol: number;
  nomCol: number;
  texteCol: number;
  congeCol: number;
}

function detectAmenLayout(rows: Rows): AmenLayout | null {
  for (let h = 0; h < Math.min(rows.length, 8); h++) {
    const row = rows[h] || [];
    const matCol = findCol(row, (n) => n === "matricule" || n === "matricules" || n === "mat");
    if (matCol < 0) continue;
    const texteCol = findCol(row, (n) => n.startsWith("amenagement"));
    if (texteCol < 0) continue;
    const nomCol = findCol(row, (n) => n.startsWith("nom"));
    const congeCol = findCol(row, (n) => n.startsWith("conge"));
    return { headerRow: h, matCol, nomCol, texteCol, congeCol };
  }
  return null;
}

function readAmen(rows: Rows, l: AmenLayout): { list: Amenagement[]; levels: AgentInfo[] } {
  const list: Amenagement[] = [];
  const levels: AgentInfo[] = [];
  for (let r = l.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const mat = normMatricule(row[l.matCol]);
    if (!mat || !MATRICULE_RE.test(mat)) continue;
    let texte = str(row[l.texteCol]);
    // la colonne contient parfois un niveau / statut au lieu d'un aménagement
    const lv = parseLevel(texte);
    if (lv !== "INCONNU" || /^(temps plein|temps partiel)$/i.test(texte)) {
      if (lv !== "INCONNU") levels.push({ matricule: mat, communes: [], niveau: lv, historique: 0 });
      texte = "";
    }
    const d1 = l.congeCol >= 0 ? parseDate(row[l.congeCol]) : null;
    const d2 = l.congeCol >= 0 ? parseDate(row[l.congeCol + 1]) : null;
    if (!texte && !d1) continue;
    list.push({
      matricule: mat,
      nom: l.nomCol >= 0 ? str(row[l.nomCol]) || undefined : undefined,
      texte,
      congeDebut: d1 ?? undefined,
      congeFin: d2 ?? d1 ?? undefined,
    });
  }
  return { list, levels };
}

// ---------------------------------------------------------------------------
// ORCHESTRATION
// ---------------------------------------------------------------------------

interface Candidate<T> {
  score: number;
  file: string;
  sheet: string;
  layout: T;
}

export function parseWorkbooks(files: UploadedFile[]): ParsedInputs {
  const alerts: Alert[] = [];
  const detection: DetectedSource[] = [];

  const planCands: Candidate<PlanningLayout>[] = [];
  const axeCands: Candidate<AxesLayout>[] = [];
  const agentCands: Candidate<AgentsLayout>[] = [];
  const amenCands: Candidate<AmenLayout>[] = [];
  const workbooks = new Map<string, Buffer>();

  // 1) Scan rapide : seulement les premières lignes de chaque feuille visible
  for (const f of files) {
    workbooks.set(f.name, f.buffer);
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(f.buffer, { type: "buffer", sheetRows: SCAN_ROWS });
    } catch (e) {
      alerts.push({ level: "error", code: "fichier-illisible", message: `Impossible de lire « ${f.name} » : ${(e as Error).message}` });
      continue;
    }
    wb.SheetNames.forEach((name, i) => {
      const hidden = wb.Workbook?.Sheets?.[i]?.Hidden;
      if (hidden) return;
      const rows = sheetRows(wb.Sheets[name]);
      if (rows.length === 0) return;
      const nn = norm(name);
      const pl = detectPlanningLayout(rows);
      if (pl) planCands.push({ score: pl.dateCols.length + (nn.includes("planning agents") ? 100 : 0) + (nn.includes("s 1") ? 10 : 0), file: f.name, sheet: name, layout: pl });
      const ax = detectAxesLayout(rows);
      if (ax && !pl) axeCands.push({ score: (nn === "axes" ? 1000 : 0) + (ax.dureeCol >= 0 ? 100 : 0) + ax.axeCols.length * 10 + ax.driverCols.length, file: f.name, sheet: name, layout: ax });
      const ag = detectAgentsLayout(rows);
      // priorité à la liste qui porte la fonction exacte et les axes (Personnes-par-fonction)
      if (ag && !pl && !ax) agentCands.push({ score: 1 + (ag.fonctionCol >= 0 ? 10 : 0) + (ag.axeCols.length ? 10 : 0) + (nn.includes("plat") ? 5 : 0) + (nn === "base" ? 3 : 0), file: f.name, sheet: name, layout: ag });
      const am = detectAmenLayout(rows);
      if (am && !pl) amenCands.push({ score: 1, file: f.name, sheet: name, layout: am });
    });
  }

  const loadSheet = (file: string, sheet: string): Rows => {
    const wb = XLSX.read(workbooks.get(file)!, { type: "buffer", sheets: [sheet] });
    return sheetRows(wb.Sheets[sheet]);
  };

  // 2) Planning : on garde la meilleure feuille (celle qui contient le plus d'agents)
  let planning: Planning | undefined;
  planCands.sort((a, b) => b.score - a.score);
  for (const c of planCands.slice(0, 3)) {
    const rows = loadSheet(c.file, c.sheet);
    const lay = detectPlanningLayout(rows) ?? c.layout;
    const p = readPlanning(rows, lay, c.file, c.sheet);
    if (p.agents.length > 0 && (!planning || p.agents.length > planning.agents.length + 20)) planning = p;
    if (planning && c.score >= 100) break;
  }
  if (planning) detection.push({ role: "planning", file: planning.file, sheet: planning.sheet, rows: planning.agents.length, note: `${planning.dates.length} jours : ${planning.dates[0]} → ${planning.dates[planning.dates.length - 1]}` });
  else alerts.push({ level: "error", code: "planning-absent", message: "Aucun planning détecté. Il faut une feuille avec « Matricule », des dates et des colonnes heure d'arrivée / heure de départ." });

  // 3) Axes : meilleure feuille
  let axes: AxeTable | undefined;
  axeCands.sort((a, b) => b.score - a.score);
  if (axeCands[0]) {
    const c = axeCands[0];
    const rows = loadSheet(c.file, c.sheet);
    axes = readAxes(rows, detectAxesLayout(rows) ?? c.layout, c.file, c.sheet);
    detection.push({ role: "axes", file: c.file, sheet: c.sheet, rows: axes.rows.length, note: `colonnes d'axe : ${axes.axeColumns.join(", ")}` });
  } else alerts.push({ level: "error", code: "axes-absent", message: "Aucune table commune → axe détectée. Il faut une feuille avec une colonne Commune et une colonne « Axe … »." });

  // 4) Agents (toutes les feuilles pertinentes sont fusionnées)
  const agentMap = new Map<string, AgentInfo>();
  const mergeAgent = (a: AgentInfo) => {
    const cur = agentMap.get(a.matricule);
    if (!cur) {
      agentMap.set(a.matricule, { ...a, communes: [...a.communes] });
      return;
    }
    for (const c of a.communes) if (!cur.communes.includes(c)) cur.communes.push(c);
    if (cur.niveau === "INCONNU") cur.niveau = a.niveau;
    if (!cur.fonction && a.fonction) cur.fonction = a.fonction;
    if (a.axes) cur.axes = { ...a.axes, ...(cur.axes ?? {}) };
    if (!cur.pole && a.pole) cur.pole = a.pole;
    // état et date de départ : ceux de la 1re feuille qui les donne (BASE passe avant MOUVEMENT / DEPART)
    if (cur.actif === undefined && a.actif !== undefined) {
      cur.actif = a.actif;
      cur.dateDepart = a.dateDepart;
    }
    if (a.mainList) cur.mainList = true;
    if (!cur.nom && a.nom) cur.nom = a.nom;
    cur.historique = Math.max(cur.historique, a.historique);
  };
  agentCands.sort((a, b) => b.score - a.score);
  let mainDone = false;
  for (const c of agentCands) {
    const rows = loadSheet(c.file, c.sheet);
    const lay = detectAgentsLayout(rows) ?? c.layout;
    const list = readAgents(rows, lay);
    if (list.length === 0) continue;
    // la feuille la mieux notée (ex. Personnes-par-fonction) est la liste principale : source de la réserve hors planning
    if (!mainDone) {
      list.forEach((a) => (a.mainList = true));
      mainDone = true;
    }
    list.forEach(mergeAgent);
    const withCommune = list.filter((a) => a.communes.length).length;
    const withLevel = list.filter((a) => a.niveau !== "INCONNU").length;
    const withFn = list.filter((a) => a.fonction).length;
    const withAx = list.filter((a) => a.axes).length;
    const parts = [`${withCommune} avec commune`];
    if (withFn) parts.push(`${withFn} avec fonction`);
    if (withAx) parts.push(`${withAx} avec axe`);
    const withPole = list.filter((a) => a.pole).length;
    if (withPole) parts.push(`${withPole} avec pôle`);
    parts.push(`${withLevel} avec niveau`);
    detection.push({ role: "agents", file: c.file, sheet: c.sheet, rows: list.length, note: parts.join(", ") });
  }

  // 5) Aménagements & congés
  const amenagements: Amenagement[] = [];
  for (const c of amenCands) {
    const rows = loadSheet(c.file, c.sheet);
    const lay = detectAmenLayout(rows) ?? c.layout;
    const { list, levels } = readAmen(rows, lay);
    amenagements.push(...list);
    levels.forEach(mergeAgent);
    detection.push({ role: "amenagements", file: c.file, sheet: c.sheet, rows: list.length });
  }
  // la feuille d'aménagements contient souvent aussi quartier + niveau
  const amenAgentSheets = new Set(amenCands.map((c) => c.file + "|" + c.sheet));
  void amenAgentSheets;

  return { planning, agents: [...agentMap.values()], axes, amenagements, detection, alerts };
}
