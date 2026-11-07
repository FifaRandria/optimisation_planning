import { NextResponse } from "next/server";
import { parseWorkbooks } from "@/lib/parse";
import { previewStats } from "@/lib/optimize";
import { readFilesFromForm, readSettings } from "@/lib/server-utils";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = await readFilesFromForm(form);
    if (files.length === 0) return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
    const settings = readSettings(form);
    const inputs = parseWorkbooks(files);
    const stats = previewStats(inputs, settings);
    return NextResponse.json({ detection: inputs.detection, alerts: inputs.alerts, stats });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
