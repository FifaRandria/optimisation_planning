import type {
  AgentInfo,
  Alert,
  Cell,
  Group,
  Level,
  Member,
  Metrics,
  OptimizationResult,
  ParsedInputs,
  Settings,
  Swap,
  SwapSide,
} from "./types";
import { axeKey, dayLabel, fmtShift, isWeekend, norm, weekKey } from "./util";
import { axeKeyForWave, transportEvents, waveLabel } from "./waves";

// ---------------------------------------------------------------------------
// Résolution agent -> axes ("21h" / "23h"), durée de trajet, chauffeurs
// ---------------------------------------------------------------------------

type AxeKey = "21h" | "23h";
const AXE_KEYS: AxeKey[] = ["21h", "23h"];

interface ResolvedAgent {
  axes: Partial<Record<AxeKey, string>>;
  duree?: number;
}

function buildResolver(inputs: ParsedInputs) {
  const table = inputs.axes;
  // colonne de la table pour chaque clé ("Axe 21h" -> "21h") ; une table à une seule colonne sert pour tout
  const colFor: Partial<Record<AxeKey, string>> = {};
  if (table) {
    for (const c of table.axeColumns) {
      const k = axeKey(c);
      if ((k === "21h" || k === "23h") && !colFor[k]) colFor[k] = c;
    }
    for (const k of AXE_KEYS) if (!colFor[k] && table.axeColumns.length) colFor[k] = table.axeColumns.find((c) => !axeKey(c)) ?? table.axeColumns[0];
  }
  const exact = new Map<string, NonNullable<typeof table>["rows"][number]>();
  const drivers: Record<AxeKey, Map<string, string>> = { "21h": new Map(), "23h": new Map() };
  for (const r of table?.rows ?? []) {
    exact.set(norm(r.commune), r);
    for (const k of AXE_KEYS) {
      const col = colFor[k];
      if (!col) continue;
      const axe = r.axes[col];
      const ch = r.chauffeurs[col];
      if (axe && ch && !drivers[k].has(axe)) drivers[k].set(axe, ch);
    }
  }
  const keys = [...exact.keys()];
  const findRow = (candidates: string[]) => {
    for (const c of candidates) {
      const e = exact.get(norm(c));
      if (e) return e;
    }
    for (const c of candidates) {
      const n = norm(c);
      if (n.length < 5) continue;
      const hits = keys.filter((k) => k.startsWith(n) || n.startsWith(k));
      if (hits.length >= 1) {
        const col = colFor["21h"] ?? table?.axeColumns[0];
        if (!col || new Set(hits.map((h) => exact.get(h)!.axes[col])).size === 1) return exact.get(hits[0])!;
      }
    }
    return null;
  };
  const resolve = (info: AgentInfo | undefined): ResolvedAgent => {
    if (!info) return { axes: {} };
    const row = findRow(info.communes);
    const axes: Partial<Record<AxeKey, string>> = {};
    for (const k of AXE_KEYS) {
      const direct = info.axes?.[k];
      const fromTable = row && colFor[k] ? row.axes[colFor[k]!] : undefined;
      const v = direct || fromTable;
      if (v) axes[k] = v;
    }
    return { axes, duree: row?.duree };
  };
  return { resolve, drivers };
}

/** Aperçu rapide (écran de dépôt des fichiers, avant l'optimisation). */
export function previewStats(inputs: ParsedInputs, settings: Settings) {
  if (!inputs.planning) return null;
  const { resolve } = buildResolver(inputs);
  const info = new Map(inputs.agents.map((a) => [a.matricule, a]));
  let withAgent = 0;
  let withAxe = 0;
  let withLevel = 0;
  let withFunction = 0;
  let withPole = 0;
  let lateShifts = 0;
  let pickups = 0;
  const lateAgents = new Set<string>();
  const fns = new Set<string>();
  // aménagements des agents du planning : figés, et parmi eux les « rôles seuls »
  const amenTexts = new Map<string, string[]>();
  for (const a of inputs.amenagements) if (a.texte) amenTexts.set(a.matricule, [...(amenTexts.get(a.matricule) ?? []), a.texte]);
  let amenFrozen = 0;
  let amenRoleOnly = 0;
  for (const pa of inputs.planning.agents) {
    const texts = amenTexts.get(pa.matricule);
    if (!texts) continue;
    if (texts.every(isRoleOnly)) amenRoleOnly++;
    if (texts.some((t) => amenFreezes(t, settings))) amenFrozen++;
  }
  for (const pa of inputs.planning.agents) {
    const a = info.get(pa.matricule);
    if (a) withAgent++;
    if (Object.keys(resolve(a).axes).length) withAxe++;
    if (a && a.niveau !== "INCONNU") withLevel++;
    if (a?.pole) withPole++;
    const fn = a?.fonction ?? pa.fonction;
    if (fn) {
      withFunction++;
      fns.add(norm(fn));
    }
    for (const c of pa.cells)
      for (const e of transportEvents(c, settings)) {
        if (e.kind === "remisage") lateShifts++;
        else pickups++;
        lateAgents.add(pa.matricule);
      }
  }
  return {
    axeColumns: inputs.axes?.axeColumns ?? [],
    dates: inputs.planning.dates,
    planningAgents: inputs.planning.agents.length,
    withAgent,
    withAxe,
    withLevel,
    withFunction,
    withPole,
    reserve: settings.useReserve ? reserveCandidates(inputs, resolve, settings).list.length : 0,
    amenFrozen,
    amenRoleOnly,
    functions: fns.size,
    lateShifts,
    pickups,
    lateAgents: lateAgents.size,
    amenagements: inputs.amenagements.length,
    communes: inputs.axes?.rows.length ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Réserve : personnes de la liste principale absentes du planning
// ---------------------------------------------------------------------------

/**
 * Candidats « hors planning » : liste principale des agents (ex. Personnes-par-fonction), absents du planning,
 * avec une fonction et un axe, sans aménagement, non INACTIF et pas partis avant le début du planning.
 * La liste fournie par l'utilisateur est considérée comme fiable (aucune autre vérification de disponibilité).
 */
function reserveCandidates(inputs: ParsedInputs, resolve: (info: AgentInfo | undefined) => ResolvedAgent, settings: Pick<Settings, "swapRoles">) {
  const planned = new Set(inputs.planning?.agents.map((a) => a.matricule) ?? []);
  const first = inputs.planning?.dates[0] ?? "";
  const amen = new Set(inputs.amenagements.filter((a) => amenFreezes(a.texte, settings)).map((a) => a.matricule));
  const list: { info: AgentInfo; res: ResolvedAgent }[] = [];
  const excluded = { amenagement: 0, inactif: 0, depart: 0, sansFonction: 0, sansAxe: 0 };
  for (const info of inputs.agents) {
    if (!info.mainList || planned.has(info.matricule)) continue;
    if (info.actif === false) { excluded.inactif++; continue; }
    if (info.dateDepart && info.dateDepart <= first) { excluded.depart++; continue; }
    if (!info.fonction) { excluded.sansFonction++; continue; }
    if (amen.has(info.matricule)) { excluded.amenagement++; continue; }
    const res = resolve(info);
    if (!Object.keys(res.axes).length) { excluded.sansAxe++; continue; }
    list.push({ info, res });
  }
  return { list, excluded };
}

// ---------------------------------------------------------------------------
// Aménagements
// ---------------------------------------------------------------------------

const AMEN_KEYWORDS: [RegExp, string][] = [
  [/nuit|tardif|\bpm\b|21h|apres midi/, "shift tardif"],
  [/\bam\b|matin|jour|admin|08h|07h|9h|8h|17h|19h|ne pas|pas de|bloque|interdit|off|samedi|dimanche|week/, "contrainte d'horaire"],
  [/enceinte|allaitement|sante|medical|hospital|ostie|enfant|famil/, "situation personnelle / santé"],
  [/team lead|renfort|digital|manager|coach/, "rôle spécifique"],
  [/conge|permission|report/, "congé / permission"],
  [/abandon/, "abandon de poste"],
];

/**
 * Aménagement de « rôle seul » : une fois retirées les mentions de rôle (RENFORT DIGITAL, TEAM LEAD),
 * il ne reste rien. « TEAM LEAD shift AM / OFF samedi » n'est PAS un rôle seul (il porte d'autres contraintes).
 */
export function isRoleOnly(texte: string): boolean {
  const n = norm(texte);
  if (!n) return false;
  return n.replace(/\brenfort digital\b|\bteam lead\b/g, " ").trim() === "";
}

/** Un aménagement fige-t-il la personne ? Oui pour tout texte, sauf rôle seul quand le réglage le permet. */
function amenFreezes(texte: string, settings: Pick<Settings, "swapRoles">): boolean {
  if (!texte) return false;
  return !(settings.swapRoles && isRoleOnly(texte));
}

function classifyAmenagement(texte: string): string | null {
  const n = norm(texte);
  for (const [re, label] of AMEN_KEYWORDS) if (re.test(n)) return label;
  return null;
}

// ---------------------------------------------------------------------------
// Optimisation
// ---------------------------------------------------------------------------

interface AgentMeta {
  matricule: string;
  nom: string;
  niveau: Level;
  fonction: string; // texte affiché
  fnKey: string; // fonction normalisée ("" = inconnue)
  commune: string;
  axes: Partial<Record<AxeKey, string>>;
  duree: number;
  frozen: string | null;
  blockedDays: Set<number>;
  pole: string; // FO / BO / SUPPORT ("" = inconnu)
  reserve: boolean; // personne hors planning (réserve)
}

const HORS: Cell = { k: "code", raw: "HORS PLANNING" };
const REMPLACE: Cell = { k: "code", raw: "REMPLACÉ" };

/** Une modification de case : l'agent i reçoit la case c le jour d. */
interface Assign {
  i: number;
  d: number;
  c: Cell;
}

interface Move {
  kind: "jour" | "off" | "reserve";
  x: number; // l'agent qui quitte le groupe
  y: number; // le partenaire
  d: number;
  k?: number; // échange OFF : l'autre jour
  week?: number[]; // remplacement par la réserve : jours de la semaine
  assigns: Assign[];
}

export function optimize(inputs: ParsedInputs, settings: Settings): OptimizationResult {
  if (!inputs.planning) throw new Error("Planning manquant");

  const planning = inputs.planning;
  const dates = planning.dates;
  const nDays = dates.length;
  const nPlan = planning.agents.length;
  const cap = Math.max(1, Math.floor(settings.capacity));
  const minRest = settings.minRestHours * 60;
  const alerts: Alert[] = [...inputs.alerts];

  const { resolve, drivers } = buildResolver(inputs);
  const agentInfo = new Map(inputs.agents.map((a) => [a.matricule, a]));
  const amenBy = new Map<string, typeof inputs.amenagements>();
  for (const a of inputs.amenagements) {
    if (!amenBy.has(a.matricule)) amenBy.set(a.matricule, []);
    amenBy.get(a.matricule)!.push(a);
  }
  const anyAxes = inputs.axes || inputs.agents.some((a) => a.axes);
  if (!anyAxes) throw new Error("Aucun axe : il faut une table commune → axe, ou une liste d'agents avec les colonnes « Axe 21h » / « Axe 23h ».");

  // -- métadonnées par agent ---------------------------------------------------
  const unknownLevel: string[] = [];
  let fnFromPlanning = 0;
  const metas: AgentMeta[] = planning.agents.map((pa) => {
    const info = agentInfo.get(pa.matricule);
    const res = resolve(info);
    const niveau = info?.niveau ?? "INCONNU";
    const am = amenBy.get(pa.matricule) ?? [];
    const blocked = new Set<number>();
    const frozenReasons: string[] = [];
    for (const a of am) {
      if (a.texte && !amenFreezes(a.texte, settings)) {
        alerts.push({
          level: "info",
          code: "amenagement-role",
          matricule: pa.matricule,
          nom: pa.nom,
          message: `Aménagement « ${a.texte} » = rôle seul : agent échangeable (réglage « rôles échangeables » activé). Ses congés restent bloqués.`,
        });
      } else if (a.texte) {
        const cat = classifyAmenagement(a.texte);
        frozenReasons.push(`Aménagement : ${a.texte}`);
        alerts.push({
          level: cat ? "info" : "warn",
          code: cat ? "amenagement" : "amenagement-non-compris",
          matricule: pa.matricule,
          nom: pa.nom,
          message: cat
            ? `Aménagement « ${a.texte} » (${cat}) → agent figé, jamais échangé.`
            : `Aménagement non interprété : « ${a.texte} ». Agent figé par précaution — vérifiez.`,
        });
      }
      if (a.congeDebut) {
        const start = a.congeDebut;
        const end = a.congeFin ?? a.congeDebut;
        dates.forEach((d, i) => {
          if (d >= start && d <= end) blocked.add(i);
        });
      }
    }
    const hasAxe = Object.keys(res.axes).length > 0;
    if (!info) {
      alerts.push({ level: "warn", code: "agent-absent", matricule: pa.matricule, nom: pa.nom, message: "Agent absent de la liste (commune, axe et fonction inconnus) → figé." });
    } else if (!hasAxe) {
      alerts.push({
        level: "warn",
        code: info.communes.length ? "commune-inconnue" : "commune-manquante",
        matricule: pa.matricule,
        nom: pa.nom,
        message: info.communes.length ? `Commune « ${info.communes[0]} » sans axe → agent figé.` : "Agent sans commune ni axe → figé.",
      });
    }
    let fonction = info?.fonction ?? "";
    if (!fonction && pa.fonction) {
      fonction = pa.fonction;
      fnFromPlanning++;
    }
    if (niveau === "INCONNU") unknownLevel.push(pa.matricule);
    if (!info) frozenReasons.push("Agent absent de la liste");
    else if (!hasAxe) frozenReasons.push("Commune / axe inconnu");
    if (settings.respectFunction && !fonction) {
      frozenReasons.push("Fonction inconnue");
      alerts.push({ level: "warn", code: "fonction-inconnue", matricule: pa.matricule, nom: pa.nom, message: "Fonction inconnue → agent figé (on n'échange qu'entre agents de même fonction)." });
    }
    if (niveau === "INCONNU" && !settings.unknownLevelSwappable && !settings.ignoreLevel) frozenReasons.push("Niveau inconnu");
    return {
      matricule: pa.matricule,
      nom: pa.nom,
      niveau,
      fonction,
      fnKey: norm(fonction),
      commune: info?.communes[0] ?? "",
      axes: res.axes,
      duree: res.duree ?? 999,
      frozen: frozenReasons.length ? frozenReasons[0] : null,
      blockedDays: blocked,
      pole: info?.pole ?? "",
      reserve: false,
    };
  });
  if (fnFromPlanning)
    alerts.push({ level: "info", code: "fonction-planning", message: `${fnFromPlanning} agent(s) sans fonction dans la liste : la fonction du planning (souvent plus générique) est utilisée.` });
  if (unknownLevel.length && unknownLevel.length < nPlan)
    alerts.push({
      level: "info",
      code: "niveau-inconnu",
      message: `${unknownLevel.length} agent(s) sans niveau (Perf/Midle/Débutant) : ${settings.ignoreLevel ? "niveau ignoré." : settings.unknownLevelSwappable ? "ils ne s'échangent qu'entre eux." : "figés."}`,
    });

  // fonctions sans partenaire possible
  if (settings.respectFunction) {
    const byFnCount = new Map<string, { label: string; n: number }>();
    metas.forEach((m) => {
      if (!m.fnKey || m.frozen) return;
      const cur = byFnCount.get(m.fnKey) ?? { label: m.fonction, n: 0 };
      cur.n++;
      byFnCount.set(m.fnKey, cur);
    });
    const alone = [...byFnCount.values()].filter((v) => v.n === 1);
    if (alone.length)
      alerts.push({
        level: "info",
        code: "fonction-seule",
        message: `${alone.length} fonction(s) n'ont qu'un seul agent échangeable : ces agents ne peuvent jamais être échangés (${alone.slice(0, 8).map((v) => v.label).join(", ")}${alone.length > 8 ? "…" : ""}).`,
      });
  }

  // codes inconnus
  planning.agents.forEach((pa) => {
    const codes = pa.cells.map((c, d) => (c.k === "code" ? `${dayLabel(dates[d])}=${c.raw}` : null)).filter(Boolean);
    if (codes.length)
      alerts.push({ level: "info", code: "code-case", matricule: pa.matricule, nom: pa.nom, message: `Code(s) non horaires conservés tels quels : ${codes.join(", ")}.` });
  });

  // semaines (lundi -> dimanche) : un échange OFF reste dans la même semaine
  const week = dates.map(weekKey);
  const weekend = dates.map(isWeekend);
  const daysOfWeek = new Map<string, number[]>();
  week.forEach((w, d) => {
    if (!daysOfWeek.has(w)) daysOfWeek.set(w, []);
    daysOfWeek.get(w)!.push(d);
  });

  // -- réserve hors planning --------------------------------------------------------
  if (settings.useReserve) {
    const { list, excluded } = reserveCandidates(inputs, resolve, settings);
    for (const { info, res } of list) {
      const blocked = new Set<number>();
      for (const a of amenBy.get(info.matricule) ?? [])
        if (a.congeDebut) dates.forEach((d, i) => d >= a.congeDebut! && d <= (a.congeFin ?? a.congeDebut!) && blocked.add(i));
      if (info.dateDepart) dates.forEach((d, i) => d >= info.dateDepart! && blocked.add(i));
      metas.push({
        matricule: info.matricule,
        nom: info.nom ?? info.matricule,
        niveau: info.niveau,
        fonction: info.fonction!,
        fnKey: norm(info.fonction),
        commune: info.communes[0] ?? "",
        axes: res.axes,
        duree: res.duree ?? 999,
        frozen: null,
        blockedDays: blocked,
        pole: info.pole ?? "",
        reserve: true,
      });
    }
    const ex = [
      excluded.inactif && `${excluded.inactif} inactif(s)`,
      excluded.depart && `${excluded.depart} parti(s)`,
      excluded.amenagement && `${excluded.amenagement} avec aménagement`,
      excluded.sansAxe && `${excluded.sansAxe} sans axe`,
      excluded.sansFonction && `${excluded.sansFonction} sans fonction`,
    ].filter(Boolean);
    alerts.push({
      level: "info",
      code: "reserve",
      message: `${list.length} personne(s) hors planning utilisables en réserve (liste des agents, considérée comme fiable)${ex.length ? ` ; écartées : ${ex.join(", ")}` : ""}.`,
    });
  }
  const nAg = metas.length;

  // pôle : contrainte seulement si les deux pôles sont connus
  const withPole = metas.filter((m) => m.pole && !m.reserve).length;
  if (withPole && withPole < nPlan)
    alerts.push({ level: "info", code: "pole-inconnu", message: `${nPlan - withPole} agent(s) du planning sans pôle (FO / BO / SUPPORT) : la règle « même pôle » ne peut pas être vérifiée pour eux.` });

  // -- état modifiable -----------------------------------------------------------
  const rowsOf = () => metas.map((m, i) => (i < nPlan ? planning.agents[i].cells.map((c) => ({ ...c }) as Cell) : dates.map(() => HORS)));
  const before: Cell[][] = rowsOf();
  const cells: Cell[][] = rowsOf();
  const locked: boolean[][] = metas.map(() => dates.map(() => false));

  const keysOf = (i: number, c: Cell): string[] =>
    transportEvents(c, settings).map((e) => {
      const axe = metas[i].axes[axeKeyForWave(e.hour, settings)];
      return `${e.prefix}|${axe ?? "?" + i}`;
    });
  const lateOf = (c: Cell) => (transportEvents(c, settings).some((e) => e.kind === "remisage") ? 1 : 0);

  // compteurs incrémentaux : personnes par groupe et par jour, coût, tardifs, week-ends OFF
  const cnt: Map<string, number>[] = dates.map(() => new Map());
  const dayCost: number[] = dates.map(() => 0);
  let totalCost = 0;
  const late: number[] = metas.map((m, i) => (agentInfo.get(m.matricule)?.historique ?? 0) + cells[i].reduce((s, c) => s + lateOf(c), 0));
  const wkOff: number[] = cells.map((row) => row.reduce((s, c, d) => s + (weekend[d] && c.k === "off" ? 1 : 0), 0));

  const bump = (d: number, key: string, delta: number) => {
    const m = cnt[d];
    const old = m.get(key) ?? 0;
    const nw = old + delta;
    if (nw) m.set(key, nw);
    else m.delete(key);
    const dc = Math.ceil(nw / cap) - Math.ceil(old / cap);
    dayCost[d] += dc;
    totalCost += dc;
  };
  const setCell = (i: number, d: number, c: Cell) => {
    const old = cells[i][d];
    for (const k of keysOf(i, old)) bump(d, k, -1);
    late[i] += lateOf(c) - lateOf(old);
    if (weekend[d]) wkOff[i] += (c.k === "off" ? 1 : 0) - (old.k === "off" ? 1 : 0);
    cells[i][d] = c;
    for (const k of keysOf(i, c)) bump(d, k, +1);
  };
  for (let i = 0; i < nAg; i++)
    for (let d = 0; d < nDays; d++) for (const k of keysOf(i, cells[i][d])) bump(d, k, +1);

  // -- règles de validité ----------------------------------------------------------
  const levelClass = (i: number): string => (settings.ignoreLevel ? "ALL" : metas[i].niveau);
  const compatible = (x: number, y: number) =>
    x !== y &&
    (!settings.respectFunction || (metas[x].fnKey !== "" && metas[x].fnKey === metas[y].fnKey)) &&
    levelClass(x) === levelClass(y) &&
    !(metas[x].pole && metas[y].pole && metas[x].pole !== metas[y].pole); // même pôle si les deux sont connus
  const canTouch = (i: number, d: number) => !metas[i].frozen && !locked[i][d] && !metas[i].blockedDays.has(d);
  const dur = (c: Cell) => (c.k === "shift" ? c.dep - c.arr : 0);
  const restPairOk = (i: number, d: number) => {
    // repos entre le jour d et le jour d+1
    if (d < 0 || d + 1 >= nDays) return true;
    const p = cells[i][d];
    const n = cells[i][d + 1];
    return !(p.k === "shift" && n.k === "shift" && n.arr + 1440 - p.dep < minRest);
  };
  const restOkAround = (i: number, days: number[]) => days.every((d) => restPairOk(i, d - 1) && restPairOk(i, d));

  /** Applique un mouvement ; renvoie de quoi l'annuler. */
  const apply = (assigns: Assign[]): Assign[] => {
    const undo = assigns.map((a) => ({ i: a.i, d: a.d, c: cells[a.i][a.d] }));
    for (const a of assigns) setCell(a.i, a.d, a.c);
    return undo.reverse();
  };

  interface Eval {
    move: Move;
    dCost: number;
    dLate: number;
    dWk: number;
    primary: number;
  }
  /** Essaie un mouvement (puis l'annule) : variation du coût et de l'équité, ou null si le repos n'est pas respecté. */
  const evaluate = (move: Move): Eval | null => {
    const ag = [move.x, move.y];
    const days = move.kind === "reserve" ? [] : move.k === undefined ? [move.d] : [move.d, move.k];
    const lb = ag.map((i) => late[i]);
    const wb = ag.map((i) => wkOff[i]);
    const c0 = totalCost;
    const undo = apply(move.assigns);
    // réserve : à l'intérieur de la semaine, R a les horaires de A (rien de nouveau) ; on vérifie seulement
    // les deux bords de la semaine (R peut remplacer quelqu'un d'autre la semaine d'avant ou d'après)
    const w = move.week;
    const ok = move.kind === "reserve" && w ? restPairOk(move.y, w[0] - 1) && restPairOk(move.y, w[w.length - 1]) : ag.every((i) => restOkAround(i, days));
    const dCost = totalCost - c0;
    const dLate = ag.reduce((s, i, j) => s + late[i] ** 2 - lb[j] ** 2, 0);
    const dWk = ag.reduce((s, i, j) => s + wkOff[i] ** 2 - wb[j] ** 2, 0);
    apply(undo);
    if (!ok) return null;
    // équité : somme des carrés des tardifs et des week-ends OFF (plus bas = mieux réparti)
    return { move, dCost, dLate, dWk, primary: dCost * 1000 + settings.fairnessWeight * dLate + settings.weekendWeight * dWk };
  };

  // candidats par fonction
  const pool = new Map<string, number[]>();
  const reservePool = new Map<string, number[]>();
  metas.forEach((m, i) => {
    if (m.frozen) return;
    const k = settings.respectFunction ? m.fnKey : "*";
    const target = m.reserve ? reservePool : pool;
    if (!target.has(k)) target.set(k, []);
    target.get(k)!.push(i);
  });

  const candidatesFor = (x: number, d: number, exclude: Set<number>): Eval[] => {
    const out: Eval[] = [];
    const cx = cells[x][d];
    if (cx.k !== "shift" || !canTouch(x, d)) return out;
    const list = pool.get(settings.respectFunction ? metas[x].fnKey : "*") ?? [];
    const sameWeek = (daysOfWeek.get(week[d]) ?? []).filter((k) => k !== d);
    for (const y of list) {
      if (exclude.has(y) || !compatible(x, y) || !canTouch(y, d)) continue;
      const cy = cells[y][d];
      // 1) échange de shifts le même jour
      if (cy.k === "shift") {
        if (cy.arr === cx.arr && cy.dep === cx.dep) continue;
        if (Math.abs(dur(cx) - dur(cy)) > settings.maxDurationDiffMin) continue;
        const e = evaluate({ kind: "jour", x, y, d, assigns: [{ i: x, d, c: cy }, { i: y, d, c: cx }] });
        if (e) out.push(e);
        continue;
      }
      // 2) échange par paire jour travaillé <-> jour OFF dans la semaine
      if (!settings.offSwap || cy.k !== "off") continue;
      for (const k of sameWeek) {
        const xk = cells[x][k];
        const yk = cells[y][k];
        if (xk.k !== "off" || yk.k !== "shift") continue;
        if (!canTouch(x, k) || !canTouch(y, k)) continue;
        if (Math.abs(dur(cx) - dur(yk)) > settings.maxDurationDiffMin) continue;
        const e = evaluate({
          kind: "off",
          x,
          y,
          d,
          k,
          assigns: [
            { i: x, d, c: cy },
            { i: y, d, c: cx },
            { i: x, d: k, c: yk },
            { i: y, d: k, c: xk },
          ],
        });
        if (e) out.push(e);
      }
    }
    // 3) remplacement de la semaine entière par une personne hors planning (réserve)
    if (settings.useReserve) {
      const wdays = daysOfWeek.get(week[d]) ?? [d];
      const xFree = wdays.every((k) => canTouch(x, k) && ["shift", "off", "empty"].includes(cells[x][k].k));
      if (xFree)
        for (const r of reservePool.get(settings.respectFunction ? metas[x].fnKey : "*") ?? []) {
          if (exclude.has(r) || !compatible(x, r)) continue;
          if (!wdays.every((k) => !locked[r][k] && !metas[r].blockedDays.has(k) && cells[r][k] === HORS)) continue;
          const assigns = wdays.flatMap((k) => [
            { i: r, d: k, c: cells[x][k] },
            { i: x, d: k, c: REMPLACE },
          ]);
          const e = evaluate({ kind: "reserve", x, y: r, d, week: wdays, assigns });
          if (e) out.push(e);
        }
    }
    return out;
  };

  const better = (a: Eval, b: Eval) => {
    if (a.primary !== b.primary) return a.primary < b.primary;
    // à note égale : on touche d'abord le planning existant (même jour, puis jour OFF), la réserve en dernier
    const rank = { jour: 0, off: 1, reserve: 2 } as const;
    if (a.move.kind !== b.move.kind) return rank[a.move.kind] < rank[b.move.kind];
    const ya = a.move.y;
    const yb = b.move.y;
    if (late[ya] !== late[yb]) return late[ya] < late[yb];
    if (metas[ya].duree !== metas[yb].duree) return metas[ya].duree < metas[yb].duree;
    return ya < yb;
  };

  // -- plan : fermer un groupe entier, ou rien --------------------------------------
  interface Applied {
    move: Move;
    undo: Assign[];
    before: { x: Cell; y: Cell; xk?: Cell; yk?: Cell; xWeek?: Cell[] };
  }
  const lockMove = (m: Move, v: boolean) => {
    for (const a of m.assigns) locked[a.i][a.d] = v;
  };
  const sumSq = (arr: number[]) => arr.reduce((s, v) => s + v * v, 0);

  const tryClose = (d: number, mem: number[]): { applied: Applied[]; gain: number } | null => {
    const cost0 = totalCost;
    const late0 = sumSq(late);
    const wk0 = sumSq(wkOff);
    const applied: Applied[] = [];
    const rollback = () => {
      for (let j = applied.length - 1; j >= 0; j--) {
        apply(applied[j].undo);
        lockMove(applied[j].move, false);
      }
    };
    const memSet = new Set(mem);
    for (const x of mem) {
      let best: Eval | null = null;
      for (const e of candidatesFor(x, d, memSet)) if (!best || better(e, best)) best = e;
      if (!best) {
        rollback();
        return null;
      }
      const m = best.move;
      const snap = {
        x: cells[m.x][m.d],
        y: cells[m.y][m.d],
        xk: m.k !== undefined ? cells[m.x][m.k] : undefined,
        yk: m.k !== undefined ? cells[m.y][m.k] : undefined,
        xWeek: m.week?.map((k) => cells[m.x][k]),
      };
      const undo = apply(m.assigns);
      lockMove(m, true);
      applied.push({ move: m, undo, before: snap });
    }
    const gain = cost0 - totalCost;
    const score = -gain * 1000 + settings.fairnessWeight * (sumSq(late) - late0) + settings.weekendWeight * (sumSq(wkOff) - wk0);
    if (gain <= 0 || score >= 0) {
      rollback();
      return null;
    }
    return { applied, gain };
  };

  // -- boucle principale ---------------------------------------------------------------
  const swaps: Swap[] = [];
  let planId = 0;
  let swapId = 0;

  const groupsOfDay = (d: number) => {
    const gm = new Map<string, number[]>();
    for (let i = 0; i < nAg; i++)
      for (const k of keysOf(i, cells[i][d])) {
        if (!gm.has(k)) gm.set(k, []);
        gm.get(k)!.push(i);
      }
    return [...gm.entries()].sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0], "fr", { numeric: true }));
  };
  const keyLabel = (key: string) => {
    const [p, axe] = key.split("|");
    const kind = p.startsWith("R") ? "ramassage" : "remisage";
    return `${axe} — ${waveLabel(kind, p.slice(1) + "h").toLowerCase()}`;
  };
  const side = (i: number, axe: string, b: string, a: string): SwapSide => ({
    matricule: metas[i].matricule,
    nom: metas[i].nom,
    commune: metas[i].commune,
    axe,
    niveau: metas[i].niveau,
    fonction: metas[i].fonction,
    pole: metas[i].pole,
    before: b,
    after: a,
  });

  const record = (key: string, res: { applied: Applied[]; gain: number }) => {
    planId++;
    const summary = `Fermeture de ${keyLabel(key)}`;
    const [prefix] = key.split("|");
    const hour = Number(prefix.slice(1));
    const ak = axeKeyForWave(hour, settings);
    for (const ap of res.applied) {
      const m = ap.move;
      const ax = metas[m.x].axes[ak] ?? "—";
      const ay = metas[m.y].axes[ak] ?? "—";
      const dl = dayLabel(dates[m.d]);
      const gainTxt = `−${res.gain} véhicule${res.gain > 1 ? "s" : ""} pour ce plan`;
      if (m.kind === "jour") {
        swaps.push({
          id: ++swapId,
          planId,
          kind: "jour",
          dayIndex: m.d,
          date: dates[m.d],
          a: side(m.x, ax, fmtShift(ap.before.x), fmtShift(ap.before.y)),
          b: side(m.y, ay, fmtShift(ap.before.y), fmtShift(ap.before.x)),
          reason: `${metas[m.x].nom} (${ax}) laisse son ${fmtShift(ap.before.x)} du ${dl} à ${metas[m.y].nom} (${ay}, même fonction « ${metas[m.y].fonction || "—"} ») et prend son ${fmtShift(ap.before.y)}. ${summary} (${gainTxt}).`,
          planSummary: summary,
          vehiclesSaved: res.gain,
        });
      } else if (m.kind === "reserve") {
        const wd = m.week!;
        const wk = ap.before.xWeek!.map((c, j) => `${dayLabel(dates[wd[j]])} ${fmtShift(c) || "—"}`).join(" · ");
        const nShifts = ap.before.xWeek!.filter((c) => c.k === "shift").length;
        const A = metas[m.x];
        const R = metas[m.y];
        const poleTxt = A.pole && R.pole ? `même pôle ${R.pole}` : "pôle non renseigné : vérifiez qu'ils sont du même pôle";
        swaps.push({
          id: ++swapId,
          planId,
          kind: "reserve",
          dayIndex: m.d,
          date: dates[m.d],
          weekDays: wd,
          a: side(m.x, ax, wk, "Hors planning cette semaine (remplacé)"),
          b: side(m.y, ay, "Hors planning", wk),
          reason: `Remplacement par la réserve (même fonction « ${R.fonction} », ${poleTxt}) : ${R.nom} (${ay}), absent du planning, reprend toute la semaine de ${A.nom} (${ax}) du ${dayLabel(dates[wd[0]])} au ${dayLabel(dates[wd[wd.length - 1]])} : ${nShifts} shift(s), mêmes horaires et mêmes OFF. ${A.nom} passe hors planning cette semaine. À CONFIRMER : vérifiez que ${R.nom} est réellement disponible (formation, congé, autre campagne…). ${summary} (${gainTxt}).`,
          planSummary: summary,
          vehiclesSaved: res.gain,
        });
      } else {
        const k = m.k!;
        const kl = dayLabel(dates[k]);
        const sx = fmtShift(ap.before.x);
        const syk = fmtShift(ap.before.yk!);
        swaps.push({
          id: ++swapId,
          planId,
          kind: "off",
          dayIndex: m.d,
          date: dates[m.d],
          dayIndex2: k,
          date2: dates[k],
          a: side(m.x, ax, `${dl} ${sx} · ${kl} OFF`, `${dl} OFF · ${kl} ${syk}`),
          b: side(m.y, ay, `${dl} OFF · ${kl} ${syk}`, `${dl} ${sx} · ${kl} OFF`),
          reason: `Échange de jour OFF (même fonction « ${metas[m.x].fonction || "—"} ») : ${metas[m.y].nom} (${ay}) fait le ${sx} de ${metas[m.x].nom} le ${dl} ; ${metas[m.x].nom} fait le ${syk} de ${metas[m.y].nom} le ${kl}. Chacun garde le même nombre de jours OFF et la couverture de chaque jour est inchangée. ${summary} (${gainTxt}).`,
          planSummary: summary,
          vehiclesSaved: res.gain,
        });
      }
    }
  };

  let guard = 0;
  let progress = true;
  while (progress && guard++ < 50) {
    progress = false;
    for (let d = 0; d < nDays; d++) {
      const tried = new Set<string>();
      for (let loops = 0; loops < 5000; loops++) {
        const next = groupsOfDay(d).find(
          ([key, mem]) =>
            !tried.has(key) &&
            mem.length <= cap &&
            !key.includes("|?") &&
            !mem.some((i) => metas[i].frozen || locked[i][d] || metas[i].blockedDays.has(d))
        );
        if (!next) break;
        const [key, mem] = next;
        tried.add(key);
        const ordered = mem.slice().sort((a, b) => metas[b].duree - metas[a].duree);
        const res = tryClose(d, ordered);
        if (res) {
          record(key, res);
          progress = true;
          tried.clear();
        }
      }
    }
  }

  // -- sorties -------------------------------------------------------------------
  const changedAll = cells.map((row, i) =>
    row.map((c, d) => {
      const b = before[i][d];
      return b.k !== c.k || (b.k === "code" && c.k === "code" && b.raw !== c.raw) || (b.k === "shift" && c.k === "shift" && (b.arr !== c.arr || b.dep !== c.dep));
    })
  );
  const keep = metas.map((m, i) => !m.reserve || changedAll[i].some(Boolean));

  const buildGroups = (state: Cell[][]): Group[] => {
    const out: Group[] = [];
    for (let d = 0; d < nDays; d++) {
      const gm = new Map<string, { kind: Group["kind"]; wave: string; hour: number; axe: string; members: Member[] }>();
      for (let i = 0; i < nAg; i++) {
        for (const e of transportEvents(state[i][d], settings)) {
          const ak = axeKeyForWave(e.hour, settings);
          const axe = metas[i].axes[ak];
          const key = `${e.prefix}|${axe ?? "?" + i}`;
          if (!gm.has(key)) gm.set(key, { kind: e.kind, wave: e.wave, hour: e.hour, axe: axe ?? "Sans axe", members: [] });
          gm.get(key)!.members.push({
            matricule: metas[i].matricule,
            nom: metas[i].nom,
            commune: metas[i].commune,
            dep: e.t,
            duree: metas[i].duree === 999 ? undefined : metas[i].duree,
            niveau: metas[i].niveau,
          });
        }
      }
      for (const g of gm.values()) {
        g.members.sort((a, b) => a.dep - b.dep || (b.duree ?? 0) - (a.duree ?? 0));
        out.push({
          dayIndex: d,
          date: dates[d],
          kind: g.kind,
          wave: g.wave,
          axe: g.axe,
          chauffeur: drivers[axeKeyForWave(g.hour, settings)].get(g.axe),
          vehicles: Math.ceil(g.members.length / cap),
          members: g.members,
        });
      }
    }
    const kindOrder = (k: Group["kind"]) => (k === "ramassage" ? 0 : 1);
    out.sort(
      (a, b) =>
        a.dayIndex - b.dayIndex ||
        kindOrder(a.kind) - kindOrder(b.kind) ||
        a.wave.localeCompare(b.wave, "fr", { numeric: true }) ||
        a.axe.localeCompare(b.axe, "fr", { numeric: true })
    );
    return out;
  };

  const metricsOf = (groups: Group[]): Metrics => {
    const perDay = dates.map((date) => ({ date, transported: 0, vehicles: 0, groups: 0, pickupVehicles: 0, dropVehicles: 0 }));
    let vehicles = 0;
    let transported = 0;
    let small = 0;
    let pickupVehicles = 0;
    let dropVehicles = 0;
    for (const g of groups) {
      vehicles += g.vehicles;
      transported += g.members.length;
      if (g.members.length <= 4) small += g.vehicles;
      if (g.kind === "ramassage") pickupVehicles += g.vehicles;
      else dropVehicles += g.vehicles;
      const p = perDay[g.dayIndex];
      p.vehicles += g.vehicles;
      p.transported += g.members.length;
      p.groups += 1;
      if (g.kind === "ramassage") p.pickupVehicles += g.vehicles;
      else p.dropVehicles += g.vehicles;
    }
    return { vehicles, transported, avgPerVehicle: vehicles ? transported / vehicles : 0, smallVehicles: small, pickupVehicles, dropVehicles, perDay };
  };

  const groupsBefore = buildGroups(before);
  const groupsAfter = buildGroups(cells);

  // alertes de repos (planning d'origine) et de capacité
  planning.agents.forEach((pa, i) => {
    for (let d = 1; d < nDays; d++) {
      if (i >= nPlan) break;
      const p = before[i][d - 1];
      const c = before[i][d];
      if (p.k === "shift" && c.k === "shift" && c.arr + 1440 - p.dep < minRest)
        alerts.push({
          level: "warn",
          code: "repos",
          matricule: pa.matricule,
          nom: pa.nom,
          message: `Repos de ${((c.arr + 1440 - p.dep) / 60).toFixed(1)} h entre ${dayLabel(dates[d - 1])} et ${dayLabel(dates[d])} dans le planning d'origine (< ${settings.minRestHours} h).`,
        });
    }
  });
  for (const sw of swaps.filter((x) => x.kind === "reserve"))
    alerts.push({
      level: "warn",
      code: "reserve-a-confirmer",
      matricule: sw.b.matricule,
      nom: sw.b.nom,
      message: `Personne hors planning proposée pour remplacer ${sw.a.nom} (${sw.a.matricule}) la semaine du ${dayLabel(dates[sw.weekDays![0]])} au ${dayLabel(dates[sw.weekDays![sw.weekDays!.length - 1]])} : confirmez sa disponibilité réelle avant de diffuser. Le repos avec sa semaine précédente n'est pas vérifiable.`,
    });
  if (swaps.some((s) => s.dayIndex === 0 || s.dayIndex2 === 0))
    alerts.push({
      level: "info",
      code: "jonction-semaine",
      message: `Le repos avec la veille du ${dayLabel(dates[0])} (semaine précédente, absente du planning) n'a pas pu être vérifié pour les cases modifiées ce jour-là.`,
    });
  for (const g of groupsAfter)
    if (g.members.length > cap)
      alerts.push({ level: "warn", code: "capacite", message: `${g.axe} — ${waveLabel(g.kind, g.wave).toLowerCase()} le ${dayLabel(g.date)} : ${g.members.length} personnes pour ${cap} places → ${g.vehicles} véhicules.` });

  const axeText = (m: AgentMeta) => {
    const a21 = m.axes["21h"];
    const a23 = m.axes["23h"];
    if (!a21 && !a23) return "—";
    if (a21 === a23 || !a23) return a21!;
    if (!a21) return a23;
    return `${a21} (21h) · ${a23} (23h)`;
  };

  return {
    settings,
    axeColumns: inputs.axes?.axeColumns ?? ["Axe 21h", "Axe 23h"],
    dates,
    agents: metas
      .filter((_, i) => keep[i])
      .map((m) => ({ matricule: m.matricule, nom: m.nom, niveau: m.niveau, fonction: m.fonction, pole: m.pole, commune: m.commune, axe: axeText(m), frozen: m.frozen, reserve: m.reserve || undefined })),
    before: before.filter((_, i) => keep[i]),
    after: cells.filter((_, i) => keep[i]),
    changed: changedAll.filter((_, i) => keep[i]),
    swaps,
    groupsBefore,
    groupsAfter,
    metricsBefore: metricsOf(groupsBefore),
    metricsAfter: metricsOf(groupsAfter),
    alerts,
    detection: inputs.detection,
    generatedAt: new Date().toISOString(),
  };
}
