import { NextResponse } from "next/server";
import { parseWorkbooks } from "@/lib/parse";
import { previewStats } from "@/lib/optimize";
import { readFilesFromForm, readSettings } from "@/lib/server-utils";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { effectiveSettings } from "@/lib/server/app-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const files = await readFilesFromForm(form);
    if (files.length === 0) return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
    const settings = await effectiveSettings(user, readSettings(form));
    const inputs = parseWorkbooks(files);
    const stats = previewStats(inputs, settings);
    return NextResponse.json({ detection: inputs.detection, alerts: inputs.alerts, stats });
  } catch (e) {
    return errorResponse(e);
  }
}
