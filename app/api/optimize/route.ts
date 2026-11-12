import { NextResponse } from "next/server";
import { parseWorkbooks } from "@/lib/parse";
import { optimize } from "@/lib/optimize";
import { readFilesFromForm, readSettings } from "@/lib/server-utils";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { effectiveSettings } from "@/lib/server/app-settings";
import { saveOptimization } from "@/lib/server/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const files = await readFilesFromForm(form);
    if (files.length === 0) return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
    // un utilisateur ne peut modifier que les réglages que l'admin lui a rendus visibles
    const settings = await effectiveSettings(user, readSettings(form));
    const inputs = parseWorkbooks(files);
    const fatal = inputs.alerts.find((a) => a.level === "error");
    if (!inputs.planning) return NextResponse.json({ error: fatal?.message ?? "Fichiers incomplets (planning manquant)." }, { status: 422 });
    const t0 = Date.now();
    const result = optimize(inputs, settings);
    const names = form.get("demo") === "1" ? ["Données d'exemple (fictives)"] : files.map((f) => f.name);
    result.historyId = await saveOptimization(user, names, result, Date.now() - t0);
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
