import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireUser } from "@/lib/server/auth";
import { activateAxes, getAxes, listAxesVersions, saveAxes } from "@/lib/server/axis-tables";
import { computeAxesDoc, sanitizeAxesSettings, sanitizePoints } from "@/lib/server/axes-compute";
import { getAppSettings } from "@/lib/server/app-settings";
import { geocodingAvailable } from "@/lib/geo/geocode";
import { routingAvailable } from "@/lib/geo/osrm";
import { roadGraphAvailable } from "@/lib/geo/road-graph";
import { isSiteId, type SiteId } from "@/lib/sites";
import { AXE_COLS, type AxeCol } from "@/lib/axes-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function siteParam(v: string): SiteId {
  if (!isSiteId(v)) throw new HttpError(404, "Site inconnu.");
  return v;
}

/** Table d'axes active du site, historique des versions, services de carte disponibles. */
export async function GET(_req: Request, { params }: { params: { site: string } }) {
  try {
    await requireUser({ admin: true });
    const site = siteParam(params.site);
    const [active, versions] = await Promise.all([getAxes(site), listAxesVersions(site)]);
    return NextResponse.json({ active, versions, services: { routing: routingAvailable(), roads: roadGraphAvailable(), geocoding: geocodingAvailable() } });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Enregistrer : le serveur recalcule la table à partir des points et de l'affectation affichée
 * (on n'enregistre jamais un résultat envoyé tel quel par le navigateur).
 */
export async function POST(req: Request, { params }: { params: { site: string } }) {
  try {
    const admin = await requireUser({ admin: true });
    const site = siteParam(params.site);
    const body = (await req.json()) as { settings?: unknown; points?: unknown; assignment?: Partial<Record<AxeCol, number[]>>; comment?: string };
    const points = sanitizePoints(body.points);
    if (!points.length) throw new HttpError(400, "Aucun point à enregistrer.");
    const fixed: Partial<Record<AxeCol, number[]>> = {};
    for (const col of AXE_COLS) {
      const a = body.assignment?.[col];
      if (!Array.isArray(a) || a.length !== points.length) throw new HttpError(400, "Affectation des points incomplète : recalculez les axes avant d'enregistrer.");
      fixed[col] = a.map((x) => (Number.isInteger(x) && x >= 0 ? x : -1));
    }
    const { values } = await getAppSettings(site);
    const doc = await computeAxesDoc(site, values, sanitizeAxesSettings(site, body.settings), points, fixed);
    const id = await saveAxes(site, doc, admin.id, String(body.comment ?? ""));
    return NextResponse.json({ id, doc });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Réactiver une ancienne version : { id }. */
export async function PUT(req: Request, { params }: { params: { site: string } }) {
  try {
    await requireUser({ admin: true });
    const site = siteParam(params.site);
    const { id } = (await req.json()) as { id?: number };
    if (!Number.isInteger(id)) throw new HttpError(400, "Version invalide.");
    await activateAxes(site, id!);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
