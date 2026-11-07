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
  let lateShifts = 0;
  let pickups = 0;
  const lateAgents = new Set<string>();
  const fns = new Set<string>();
  for (const pa of inputs.planning.agents) {
    const a = info.get(pa.matricule);
    if (a) withAgent++;
    if (Object.keys(resolve(a).axes).length) withAxe++;
    if (a && a.niveau !== "INCONNU") withLevel++;
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
    functions: fns.size,
    lateShifts,
    pickups,
    lateAgents: lateAgents.size,
    amenagements: inputs.amenagements.length,
    communes: inputs.axes?.rows.length ?? 0,
  };
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
}

/** Une modification de case : l'agent i reçoit la case c le jour d. */
interface Assign {
  i: number;
  d: number;
  c: Cell;
}

interface Move {
  kind: "jour" | "off";
  x: number; // l'agent qui quitte le groupe
  y: number; // le partenaire
  d: number;
  k?: number; // échange OFF : l'autre jour
  assigns: Assign[];
}

export function optimize(inputs: ParsedInputs, settings: Settings): OptimizationResult {
  if (!inputs.planning) throw new Error("Planning manquant");

  const planning = inputs.planning;
  const dates = planning.dates;
  const nDays = dates.length;
  const nAg = planning.agents.length;
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
      if (a.texte) {
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
    };
  });
  if (fnFromPlanning)
    alerts.push({ level: "info", code: "fonction-planning", message: `${fnFromPlanning} agent(s) sans fonction dans la liste : la fonction du planning (souvent plus générique) est utilisée.` });
  if (unknownLevel.length && unknownLevel.length < nAg)
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

  // -- état modifiable -----------------------------------------------------------
  const before: Cell[][] = planning.agents.map((a) => a.cells.map((c) => ({ ...c }) as Cell));
  const cells: Cell[][] = planning.agents.map((a) => a.cells.map((c) => ({ ...c }) as Cell));
  const locked: boolean[][] = planning.agents.map(() => dates.map(() => false));

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
    x !== y && (!settings.respectFunction || (metas[x].fnKey !== "" && metas[x].fnKey === metas[y].fnKey)) && levelClass(x) === levelClass(y);
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
    const days = move.k === undefined ? [move.d] : [move.d, move.k];
    const lb = ag.map((i) => late[i]);
    const wb = ag.map((i) => wkOff[i]);
    const c0 = totalCost;
    const undo = apply(move.assigns);
    const ok = ag.every((i) => restOkAround(i, days));
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
  metas.forEach((m, i) => {
    if (m.frozen) return;
    const k = settings.respectFunction ? m.fnKey : "*";
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k)!.push(i);
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
    return out;
  };

  const better = (a: Eval, b: Eval) => {
    if (a.primary !== b.primary) return a.primary < b.primary;
    // à note égale : l'échange du même jour (moins de changements) avant l'échange OFF
    if (a.move.kind !== b.move.kind) return a.move.kind === "jour";
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
    before: { x: Cell; y: Cell; xk?: Cell; yk?: Cell };
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
  const changed = cells.map((row, i) =>
    row.map((c, d) => {
      const b = before[i][d];
      return b.k !== c.k || (b.k === "shift" && c.k === "shift" && (b.arr !== c.arr || b.dep !== c.dep));
    })
  );

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
    agents: metas.map((m) => ({ matricule: m.matricule, nom: m.nom, niveau: m.niveau, fonction: m.fonction, commune: m.commune, axe: axeText(m), frozen: m.frozen })),
    before,
    after: cells,
    changed,
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
