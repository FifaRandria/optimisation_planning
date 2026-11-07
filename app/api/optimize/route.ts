import { NextResponse } from "next/server";
import { parseWorkbooks } from "@/lib/parse";
import { optimize } from "@/lib/optimize";
import { readFilesFromForm, readSettings } from "@/lib/server-utils";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = await readFilesFromForm(form);
    if (files.length === 0) return NextResponse.json({ error: "Aucun fichier reçu." }, { status: 400 });
    const settings = readSettings(form);
    const inputs = parseWorkbooks(files);
    const fatal = inputs.alerts.find((a) => a.level === "error");
    if (!inputs.planning) return NextResponse.json({ error: fatal?.message ?? "Fichiers incomplets (planning manquant)." }, { status: 422 });
    const result = optimize(inputs, settings);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
