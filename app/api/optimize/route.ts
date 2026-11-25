import { NextResponse } from "next/server";
import { parseWorkbooks } from "@/lib/parse";
import { optimize } from "@/lib/optimize";
import { readFilesFromForm, readSettings, readSite } from "@/lib/server-utils";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { effectiveSettings } from "@/lib/server/app-settings";
import { withSavedAxes } from "@/lib/server/axis-tables";
import { saveOptimization } from "@/lib/server/history";
import { SITES } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const site = readSite(form); // chaque site est optimisé séparément, avec ses propres axes et réglages
    const files = await readFilesFromForm(form, site);
    if (files.length === 0) return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
    // un utilisateur ne peut modifier que les réglages que l'admin lui a rendus visibles
    const settings = await effectiveSettings(user, site, readSettings(form, site));
    // sans fichier d'axes déposé : table d'axes enregistrée du site (page « Axes »)
    const inputs = await withSavedAxes(parseWorkbooks(files), site);
    const fatal = inputs.alerts.find((a) => a.level === "error");
    if (!inputs.planning) return NextResponse.json({ error: fatal?.message ?? "Fichiers incomplets (planning manquant)." }, { status: 422 });
    const t0 = Date.now();
    const result = { ...optimize(inputs, settings), site };
    const names = form.get("demo") === "1" ? [`Données d'exemple ${SITES[site].name} (fictives)`] : files.map((f) => f.name);
    result.historyId = await saveOptimization(user, names, result, Date.now() - t0, inputs);
    result.version = 0;
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
