import { errorResponse, HttpError, requireUser } from "@/lib/server/auth";
import { getAxes } from "@/lib/server/axis-tables";
import { axesTableWorkbook } from "@/lib/templates";
import { toAxeTable } from "@/lib/axes-map";
import { isSiteId, SITES } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Table d'axes enregistrée (active, ou ?id=…) au format Excel de la feuille « Axes ». */
export async function GET(req: Request, { params }: { params: { site: string } }) {
  try {
    await requireUser({ admin: true });
    if (!isSiteId(params.site)) throw new HttpError(404, "Site inconnu.");
    const id = Number(new URL(req.url).searchParams.get("id")) || undefined;
    const saved = await getAxes(params.site, id);
    if (!saved) throw new HttpError(404, "Aucune table d'axes enregistrée pour ce site.");
    const buf = await axesTableWorkbook(toAxeTable(saved.doc, "Axes"), `${SITES[params.site].name} · ${SITES[params.site].place}`);
    const name = `axes-${params.site}-${saved.version.createdAt.slice(0, 10)}.xlsx`;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
