// Versions du planning corrigé : lecture, création (avec contrôle des accès et des modifications concurrentes).
import { gunzipSync, gzipSync } from "zlib";
import { resolveAgentAxes } from "../optimize";
import type { OptimizationResult, ParsedInputs, PlanningEdit, VersionInfo, VersionRequest } from "../types";
import type { PublicUser } from "../settings-meta";
import { norm, todayIso } from "../util";
import { buildVersion, VersionError } from "../versions";
import { HttpError } from "./auth";
import { q, q1 } from "./db";
import { getOptimization } from "./history";

const unzip = <T,>(b: Buffer): T => JSON.parse(gunzipSync(b).toString("utf8")) as T;

async function latestVersion(optId: number): Promise<number> {
  const r = await q1<{ v: number | null }>(`SELECT max(version) AS v FROM planning_versions WHERE optimization_id = $1`, [optId]);
  return r?.v ?? 0;
}

async function loadInputs(optId: number): Promise<ParsedInputs> {
  const r = await q1<{ inputs_gz: Buffer | null }>(`SELECT inputs_gz FROM optimizations WHERE id = $1`, [optId]);
  if (!r?.inputs_gz) throw new HttpError(409, "Cette optimisation date d'avant les modifications de planning : relancez-la pour pouvoir la modifier.");
  return unzip<ParsedInputs>(r.inputs_gz);
}

export async function listVersions(user: PublicUser, optId: number): Promise<VersionInfo[]> {
  const { item, result } = await getOptimization(user, optId); // contrôle d'accès
  const rows = await q<{ version: number; created_at: Date; user_name: string | null; motif: string; comment: string; edits: PlanningEdit[]; reoptimized: boolean; vehicles: number; swaps_new: number }>(
    `SELECT v.version, v.created_at, u.display_name AS user_name, v.motif, v.comment, v.edits, v.reoptimized, v.vehicles, v.swaps_new
       FROM planning_versions v LEFT JOIN users u ON u.id = v.user_id WHERE v.optimization_id = $1 ORDER BY v.version`,
    [optId]
  );
  return [
    { version: 0, createdAt: item.createdAt, userName: item.userName, motif: null, comment: "Optimisation d'origine", edits: 0, reoptimized: true, vehicles: result.metricsAfter.vehicles, swapsNew: result.swaps.length },
    ...rows.map((r) => ({
      version: r.version,
      createdAt: new Date(r.created_at).toISOString(),
      userName: r.user_name,
      motif: r.motif as VersionInfo["motif"],
      comment: r.comment,
      edits: r.edits.length,
      reoptimized: r.reoptimized,
      vehicles: r.vehicles,
      swapsNew: r.swaps_new,
    })),
  ];
}

/** Résultat d'une version (0 = optimisation d'origine). */
export async function getVersion(user: PublicUser, optId: number, version: number): Promise<OptimizationResult> {
  const { result } = await getOptimization(user, optId);
  if (version === 0) return result;
  const r = await q1<{ result_gz: Buffer }>(`SELECT result_gz FROM planning_versions WHERE optimization_id = $1 AND version = $2`, [optId, version]);
  if (!r) throw new HttpError(404, `Version ${version} introuvable.`);
  return { ...unzip<OptimizationResult>(r.result_gz), historyId: optId, version };
}

/** Crée la version suivante (ou un aperçu si req.save = false). */
export async function createVersion(user: PublicUser, optId: number, req: VersionRequest): Promise<{ result: OptimizationResult; swapsNew: number; saved: boolean }> {
  const latest = await latestVersion(optId);
  if (req.baseVersion !== latest)
    throw new HttpError(409, `Le planning a été modifié entre-temps (version ${latest} enregistrée). Rechargez la page pour repartir de la dernière version.`);
  const base = await getVersion(user, optId, latest);
  const inputs = await loadInputs(optId);
  let built: ReturnType<typeof buildVersion>;
  try {
    built = buildVersion(base, inputs, req, { version: latest + 1, today: todayIso(), userName: user.displayName });
  } catch (e) {
    if (e instanceof VersionError) throw new HttpError(e.status, e.message);
    throw e;
  }
  const { result, newEdits, swapsNew } = built;
  if (!req.save) return { result, swapsNew, saved: false };
  try {
    await q(
      `INSERT INTO planning_versions (optimization_id, version, user_id, motif, comment, edits, reoptimized, vehicles, swaps_new, result_gz)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [optId, latest + 1, user.id, req.motif, req.comment ?? "", JSON.stringify(newEdits), req.reoptimize, result.metricsAfter.vehicles, swapsNew, gzipSync(Buffer.from(JSON.stringify(result)))]
    );
  } catch (e) {
    // deux enregistrements simultanés sur la même base : le second est refusé par UNIQUE (optimization_id, version)
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "Quelqu'un vient d'enregistrer une version : rechargez la page.");
    throw e;
  }
  return { result, swapsNew, saved: true };
}

export interface AgentHit {
  matricule: string;
  nom: string;
  fonction: string;
  pole: string;
  niveau: string;
  commune: string;
  axes: Partial<Record<"21h" | "23h", string>>;
  inPlanning: boolean;
}

/** Recherche dans la liste des agents de l'optimisation (pour ajouter un renfort). */
export async function searchAgents(user: PublicUser, optId: number, query: string): Promise<AgentHit[]> {
  const base = await getVersion(user, optId, await latestVersion(optId));
  const inputs = await loadInputs(optId);
  const planned = new Set(base.agents.map((a) => a.matricule));
  const nq = norm(query);
  if (nq.length < 2) return [];
  return inputs.agents
    .filter((a) => [a.matricule, a.nom, a.fonction].some((t) => norm(t).includes(nq)))
    .slice(0, 20)
    .map((a) => ({
      matricule: a.matricule,
      nom: a.nom ?? a.matricule,
      fonction: a.fonction ?? "",
      pole: a.pole ?? "",
      niveau: a.niveau,
      commune: a.communes[0] ?? "",
      axes: resolveAgentAxes(inputs, a),
      inPlanning: planned.has(a.matricule),
    }));
}

/** Axes connus (table des axes + axes des agents) : liste de choix pour un renfort saisi à la main. */
export async function knownAxes(optId: number): Promise<string[]> {
  const inputs = await loadInputs(optId);
  const s = new Set<string>();
  for (const r of inputs.axes?.rows ?? []) for (const v of Object.values(r.axes)) if (v) s.add(v);
  for (const a of inputs.agents) for (const v of Object.values(a.axes ?? {})) if (v) s.add(v);
  return [...s].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
}
