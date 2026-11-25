import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireUser } from "@/lib/server/auth";
import { computeAxesDoc, sanitizeAxesSettings, sanitizePoints } from "@/lib/server/axes-compute";
import { getAppSettings } from "@/lib/server/app-settings";
import { isSiteId } from "@/lib/sites";
import { AXE_COLS, type AxeCol } from "@/lib/axes-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Calcul des axes (aperçu, rien n'est enregistré). `fixed[col]` : affectation imposée à réévaluer. */
export async function POST(req: Request, { params }: { params: { site: string } }) {
  try {
    await requireUser({ admin: true });
    if (!isSiteId(params.site)) throw new HttpError(404, "Site inconnu.");
    const body = (await req.json()) as { settings?: unknown; points?: unknown; fixed?: Partial<Record<AxeCol, number[]>> };
    const points = sanitizePoints(body.points);
    const fixed: Partial<Record<AxeCol, number[]>> = {};
    for (const col of AXE_COLS) {
      const a = body.fixed?.[col];
      if (Array.isArray(a) && a.length === points.length) fixed[col] = a.map((x) => (Number.isInteger(x) && x >= 0 ? x : -1));
    }
    const { values } = await getAppSettings(params.site);
    return NextResponse.json(await computeAxesDoc(params.site, values, sanitizeAxesSettings(params.site, body.settings), points, fixed));
  } catch (e) {
    return errorResponse(e);
  }
}
