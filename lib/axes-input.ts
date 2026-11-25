// Page « Axes » : lecture du fichier déposé (serveur). Accepte :
//  - une liste d'agents (Matricule + Quartier / Commune / Point de remisage…), ex. le planning SIRIUS ou Personnes-par-fonction ;
//  - une simple liste de communes (Commune, Adresse, et si possible Latitude / Longitude) ;
//  - une table d'axes existante (feuille « Axes » du fichier WFM).
// Les lignes sont regroupées par commune / quartier : un point de la carte = une ligne de la future table d'axes.
import * as XLSX from "xlsx";
import type { MapPoint } from "./axes-map";
import { isBlank, norm, str, toNumber } from "./util";

type Rows = unknown[][];

interface Layout {
  header: number;
  communeCols: number[]; // par priorité
  hintCols: number[]; // adresses, points de remisage
  latCol: number;
  lonCol: number;
  matCol: number; // liste d'agents : on compte les agents par point ; sinon la ligne ne compte pas d'agent
}

function detect(rows: Rows): Layout | null {
  for (let h = 0; h < Math.min(rows.length, 8); h++) {
    const row = (rows[h] || []).map(norm);
    const prio: [number, number][] = [];
    const hintCols: number[] = [];
    let latCol = -1;
    let lonCol = -1;
    const matCol = row.findIndex((n) => n === "matricule" || n === "matricules");
    row.forEach((n, c) => {
      if (!n) return;
      if (n.includes("commune") && (n.includes("fokotany") || n.includes("repere"))) prio.push([0, c]);
      else if (n === "quartier" || n === "quartiers") prio.push([1, c]);
      else if (n === "commune" || n.startsWith("commune") || n === "fokotany" || n === "fokontany") prio.push([2, c]);
      else if (n.startsWith("adresse") || n.includes("point de remisage") || n.includes("lieu de remisage") || n === "repere") hintCols.push(c);
      else if (n === "latitude" || n === "lat") latCol = c;
      else if (n === "longitude" || n === "lon" || n === "lng") lonCol = c;
    });
    if (!prio.length) continue;
    prio.sort((a, b) => a[0] - b[0]);
    return { header: h, communeCols: prio.map((p) => p[1]), hintCols, latCol, lonCol, matCol };
  }
  return null;
}

export interface PointsInput {
  points: MapPoint[];
  sources: { file: string; sheet: string; rows: number }[];
  warnings: string[];
}

export function readPoints(files: { name: string; buffer: Buffer }[]): PointsInput {
  const warnings: string[] = [];
  const sheets: { file: string; sheet: string; rows: Rows; layout: Layout; hidden: boolean }[] = [];
  for (const f of files) {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(f.buffer, { type: "buffer" });
    } catch (e) {
      warnings.push(`Impossible de lire « ${f.name} » : ${(e as Error).message}`);
      continue;
    }
    wb.SheetNames.forEach((name, i) => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null });
      const layout = detect(rows);
      if (layout) sheets.push({ file: f.name, sheet: name, rows, layout, hidden: !!wb.Workbook?.Sheets?.[i]?.Hidden });
    });
  }
  // feuilles masquées (planning SIRIUS « Feuil1 ») : seulement si aucune feuille visible ne convient
  const use = sheets.some((s) => !s.hidden) ? sheets.filter((s) => !s.hidden) : sheets;

  const byKey = new Map<string, { p: MapPoint; hints: Map<string, number>; lat: number[]; lon: number[] }>();
  const sources: PointsInput["sources"] = [];
  for (const s of use) {
    let n = 0;
    for (let r = s.layout.header + 1; r < s.rows.length; r++) {
      const row = s.rows[r] || [];
      const commune = s.layout.communeCols.map((c) => str(row[c])).find((v) => v && !isBlank(v));
      if (!commune) continue;
      const k = norm(commune);
      if (!k) continue;
      n++;
      let cur = byKey.get(k);
      if (!cur) {
        cur = { p: { key: commune.trim(), lat: null, lon: null, status: "none", agents: 0, hints: [] }, hints: new Map(), lat: [], lon: [] };
        byKey.set(k, cur);
      }
      if (s.layout.matCol >= 0 && str(row[s.layout.matCol])) cur.p.agents++;
      for (const c of s.layout.hintCols) {
        const h = str(row[c]);
        if (h && !isBlank(h) && norm(h) !== k) cur.hints.set(h, (cur.hints.get(h) ?? 0) + 1);
      }
      const lat = s.layout.latCol >= 0 ? toNumber(row[s.layout.latCol]) : undefined;
      const lon = s.layout.lonCol >= 0 ? toNumber(row[s.layout.lonCol]) : undefined;
      // coordonnées plausibles pour Madagascar seulement
      if (lat !== undefined && lon !== undefined && lat < -11 && lat > -26 && lon > 42 && lon < 51) {
        cur.lat.push(lat);
        cur.lon.push(lon);
      }
    }
    if (n) sources.push({ file: s.file, sheet: s.sheet, rows: n });
  }
  const points = [...byKey.values()].map(({ p, hints, lat, lon }) => {
    p.hints = [...hints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((h) => h[0]);
    if (lat.length) {
      p.lat = lat.reduce((a, b) => a + b, 0) / lat.length;
      p.lon = lon.reduce((a, b) => a + b, 0) / lon.length;
      p.status = "file";
    }
    return p;
  });
  if (!points.length) warnings.push("Aucune colonne Commune / Quartier / Commune-Fokotany-Repère trouvée dans les fichiers déposés.");
  points.sort((a, b) => b.agents - a.agents || a.key.localeCompare(b.key, "fr"));
  return { points, sources, warnings };
}
