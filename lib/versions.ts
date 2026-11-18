// Versions du planning corrigé : modifications manuelles (renforts, absences, horaires…) puis recalcul
// du transport, et ré-optimisation « autour » des modifications. Aucune dépendance base de données :
// utilisé par l'API (lib/server/versions.ts) et par scripts/test-versions.ts.
import { optimize } from "./optimize";
import type {
  AgentInfo,
  Cell,
  EditInput,
  Group,
  NewAgentInput,
  OptimizationResult,
  ParsedInputs,
  PlanningAgent,
  PlanningEdit,
  TransportChange,
  VersionRequest,
} from "./types";
import { EDIT_MOTIFS } from "./types";
import { fmtShift, normMatricule, parseLevel, str } from "./util";

export class VersionError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const HORS_RAW = "HORS PLANNING";
const hors = (): Cell => ({ k: "code", raw: HORS_RAW });
const sameCell = (a: Cell, b: Cell) => JSON.stringify(a) === JSON.stringify(b);

/** Valide une case reçue du client. */
export function sanitizeCell(input: unknown): Cell {
  const c = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const raw = (v: unknown, d: string) => (str(v) || d).slice(0, 30);
  switch (c.k) {
    case "shift": {
      const arr = Number(c.arr);
      let dep = Number(c.dep);
      if (!Number.isInteger(arr) || !Number.isInteger(dep) || arr < 0 || arr >= 1440 || dep < 0 || dep > 2880) throw new VersionError(400, "Horaire invalide.");
      if (dep <= arr) dep += 1440; // shift de nuit
      if (dep - arr > 16 * 60) throw new VersionError(400, "Un shift ne peut pas dépasser 16 h.");
      return { k: "shift", arr, dep };
    }
    case "off":
      return { k: "off", raw: "OFF" };
    case "leave":
      return { k: "leave", raw: raw(c.raw, "CONGE") };
    case "code":
      return { k: "code", raw: raw(c.raw, "ABSENT") };
    case "empty":
      return { k: "empty" };
    default:
      throw new VersionError(400, "Type de case inconnu.");
  }
}

/** Valide une requête de version (le client n'est jamais cru sur parole). */
export function sanitizeRequest(input: unknown): VersionRequest {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const motif = typeof r.motif === "string" && r.motif in EDIT_MOTIFS ? (r.motif as VersionRequest["motif"]) : null;
  if (!motif) throw new VersionError(400, "Indiquez le motif de la modification.");
  const edits: EditInput[] = (Array.isArray(r.edits) ? r.edits : []).map((e) => {
    const x = (e ?? {}) as Record<string, unknown>;
    return { matricule: normMatricule(x.matricule), dayIndex: Number(x.dayIndex), cell: sanitizeCell(x.cell) };
  });
  const newAgents: NewAgentInput[] = (Array.isArray(r.newAgents) ? r.newAgents : []).map((a) => {
    const x = (a ?? {}) as Record<string, unknown>;
    const out: NewAgentInput = {
      matricule: normMatricule(x.matricule),
      nom: str(x.nom).slice(0, 80),
      fonction: str(x.fonction).slice(0, 80),
      pole: str(x.pole).slice(0, 20) || undefined,
      niveau: x.niveau ? parseLevel(x.niveau) : undefined,
      commune: str(x.commune).slice(0, 80) || undefined,
      axe21: str(x.axe21).slice(0, 40) || undefined,
      axe23: str(x.axe23).slice(0, 40) || undefined,
    };
    if (!out.matricule) throw new VersionError(400, "Renfort : matricule obligatoire.");
    return out;
  });
  if (!edits.length) throw new VersionError(400, "Aucune modification.");
  if (edits.length > 2000) throw new VersionError(400, "Trop de modifications en une fois.");
  return {
    baseVersion: Number(r.baseVersion) || 0,
    motif,
    comment: str(r.comment).slice(0, 500) || undefined,
    edits,
    newAgents,
    reoptimize: r.reoptimize !== false,
    save: r.save === true,
  };
}

/** Différences de transport entre deux versions (par jour × vague × axe). */
export function transportDiff(prev: Group[], next: Group[]): TransportChange[] {
  const key = (g: Group) => `${g.dayIndex}|${g.kind}|${g.wave}|${g.axe}`;
  const label = (m: Group["members"][number]) => `${m.nom} (${m.matricule})`;
  const a = new Map(prev.map((g) => [key(g), g]));
  const b = new Map(next.map((g) => [key(g), g]));
  const out: TransportChange[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const ga = a.get(k);
    const gb = b.get(k);
    const ma = new Map((ga?.members ?? []).map((m) => [m.matricule, m]));
    const mb = new Map((gb?.members ?? []).map((m) => [m.matricule, m]));
    const added = [...mb.values()].filter((m) => !ma.has(m.matricule)).map(label);
    const removed = [...ma.values()].filter((m) => !mb.has(m.matricule)).map(label);
    if (!added.length && !removed.length) continue;
    const g = (gb ?? ga)!;
    out.push({
      dayIndex: g.dayIndex,
      date: g.date,
      kind: g.kind,
      wave: g.wave,
      axe: g.axe,
      chauffeur: g.chauffeur,
      vehiclesBefore: ga?.vehicles ?? 0,
      vehiclesAfter: gb?.vehicles ?? 0,
      added,
      removed,
    });
  }
  return out.sort((x, y) => x.dayIndex - y.dayIndex || x.kind.localeCompare(y.kind) || x.wave.localeCompare(y.wave, "fr", { numeric: true }) || x.axe.localeCompare(y.axe, "fr", { numeric: true }));
}

export interface BuildContext {
  version: number; // numéro de la nouvelle version
  today: string; // ISO : les jours strictement antérieurs sont figés
  userName?: string;
}

/**
 * Construit la version suivante à partir de la version de base (son résultat) et des entrées analysées
 * de l'optimisation d'origine. Cases verrouillées pendant la ré-optimisation :
 *  - les jours passés (pour tout le monde, réserve comprise) ;
 *  - toutes les cases modifiées à la main (cette version et les précédentes) ;
 *  - les cases déjà changées par rapport au planning publié (échanges annoncés aux agents).
 */
export function buildVersion(base: OptimizationResult, inputs: ParsedInputs, req: VersionRequest, ctx: BuildContext): { result: OptimizationResult; newEdits: PlanningEdit[]; swapsNew: number } {
  if (!inputs.planning) throw new VersionError(422, "Entrées d'origine incomplètes.");
  const dates = base.dates;
  const nDays = dates.length;
  const past = dates.map((d) => d < ctx.today);
  if (past.every(Boolean)) throw new VersionError(409, "Cette période est terminée : ses jours ne peuvent plus être modifiés.");

  // -- planning de départ = planning de la version de base ---------------------------------
  const agents: PlanningAgent[] = base.agents.map((a, i) => ({ matricule: a.matricule, nom: a.nom, fonction: a.fonction, row: i + 1, cells: base.after[i].map((c) => ({ ...c }) as Cell) }));
  const index = new Map(agents.map((a, i) => [a.matricule, i]));
  const agentInfos: AgentInfo[] = inputs.agents.slice();
  const infoBy = new Map(agentInfos.map((a) => [a.matricule, a]));

  // renforts absents du planning : nouvelle ligne « hors planning » (sauf les jours modifiés)
  const addedRows = new Set<string>();
  for (const na of req.newAgents ?? []) {
    if (index.has(na.matricule)) continue; // déjà dans le planning : simple modification de case
    let info = infoBy.get(na.matricule);
    if (!info) {
      if (!na.fonction) throw new VersionError(400, `Renfort ${na.matricule} : fonction obligatoire (il n'est pas dans la liste des agents).`);
      if (!na.commune && !na.axe21 && !na.axe23) throw new VersionError(400, `Renfort ${na.matricule} : indiquez sa commune ou son axe.`);
      const axes: Record<string, string> = {};
      if (na.axe21) axes["21h"] = na.axe21;
      if (na.axe23) axes["23h"] = na.axe23;
      info = {
        matricule: na.matricule,
        nom: na.nom || na.matricule,
        communes: na.commune ? [na.commune] : [],
        niveau: na.niveau ?? "INCONNU",
        historique: 0,
        fonction: na.fonction,
        axes: Object.keys(axes).length ? axes : undefined,
        pole: na.pole,
      };
      agentInfos.push(info);
      infoBy.set(info.matricule, info);
    }
    index.set(na.matricule, agents.length);
    addedRows.add(na.matricule);
    agents.push({ matricule: na.matricule, nom: info.nom ?? na.nom ?? na.matricule, fonction: info.fonction, row: agents.length + 1, cells: dates.map(hors) });
  }

  // -- application des modifications ---------------------------------------------------------
  const at = new Date().toISOString();
  const newEdits: PlanningEdit[] = [];
  const seen = new Set<string>();
  for (const e of req.edits) {
    const i = index.get(e.matricule);
    if (i === undefined) throw new VersionError(400, `Agent ${e.matricule} absent du planning : ajoutez-le comme renfort.`);
    if (!Number.isInteger(e.dayIndex) || e.dayIndex < 0 || e.dayIndex >= nDays) throw new VersionError(400, "Jour invalide.");
    if (past[e.dayIndex]) throw new VersionError(400, `Le ${dates[e.dayIndex]} est passé : il ne peut plus être modifié.`);
    const k = `${e.matricule}|${e.dayIndex}`;
    if (seen.has(k)) throw new VersionError(400, `Deux modifications pour ${e.matricule} le même jour.`);
    seen.add(k);
    const old = agents[i].cells[e.dayIndex];
    if (sameCell(old, e.cell)) continue;
    agents[i].cells[e.dayIndex] = e.cell;
    newEdits.push({
      version: ctx.version,
      matricule: e.matricule,
      nom: agents[i].nom,
      dayIndex: e.dayIndex,
      date: dates[e.dayIndex],
      before: addedRows.has(e.matricule) ? "Hors planning" : fmtShift(old) || "—",
      after: fmtShift(e.cell) || "—",
      motif: req.motif,
      comment: req.comment,
      by: ctx.userName,
      at,
    });
  }
  if (!newEdits.length) throw new VersionError(400, "Les modifications ne changent aucune case.");

  // -- verrous -------------------------------------------------------------------------------
  const manual = new Set([...(base.edits ?? []), ...newEdits].map((e) => `${e.matricule}|${e.dayIndex}`));
  const baseIdx = new Map(base.agents.map((a, i) => [a.matricule, i]));
  const locked = agents.map((a) => {
    const bi = baseIdx.get(a.matricule);
    return dates.map((_, d) => past[d] || manual.has(`${a.matricule}|${d}`) || (bi !== undefined && base.changed[bi][d]) || bi === undefined);
  });

  const modified: ParsedInputs = { ...inputs, agents: agentInfos, planning: { ...inputs.planning, dates, agents } };
  const r = optimize(modified, base.settings, {
    locked,
    lockedDays: req.reoptimize ? past : dates.map(() => true),
    baseLabel: `planning modifié (version ${ctx.version})`,
  });

  // -- « avant » = planning publié d'origine (cases jaunes et indicateurs avant restent ceux du départ) --
  const before = r.agents.map((a) => {
    const bi = baseIdx.get(a.matricule);
    return bi !== undefined ? base.before[bi] : dates.map(hors);
  });
  const changed = r.after.map((row, i) => row.map((c, d) => !sameCell(c, before[i][d])));
  const maxId = Math.max(0, ...base.swaps.map((s) => s.id));
  const maxPlan = Math.max(0, ...base.swaps.map((s) => s.planId));
  const fresh = r.swaps.map((s) => ({ ...s, id: s.id + maxId, planId: s.planId + maxPlan, version: ctx.version }));
  // codes posés par les versions précédentes (HORS PLANNING / REMPLACÉ) : pas d'alerte « code non horaire »
  const alerts = r.alerts.filter((a) => !(a.code === "code-case" && /^Code\(s\) non horaires conservés tels quels : (\S+ \S+=(HORS PLANNING|REMPLACÉ)(, )?)+\.$/.test(a.message)));

  const result: OptimizationResult = {
    ...r,
    agents: r.agents.map((a) => {
      const prev = base.agents[baseIdx.get(a.matricule) ?? -1];
      // une personne de la réserve utilisée dans une version précédente est devenue une ligne du planning : on garde l'étiquette
      return { ...a, reserve: a.reserve || prev?.reserve || undefined, added: addedRows.has(a.matricule) || prev?.added || undefined };
    }),
    before,
    changed,
    swaps: [...base.swaps, ...fresh],
    groupsBefore: base.groupsBefore,
    metricsBefore: base.metricsBefore,
    alerts,
    detection: base.detection,
    historyId: base.historyId,
    version: ctx.version,
    edits: [...(base.edits ?? []), ...newEdits],
    transportChanges: transportDiff(base.groupsAfter, r.groupsAfter),
  };
  return { result, newEdits, swapsNew: fresh.length };
}
