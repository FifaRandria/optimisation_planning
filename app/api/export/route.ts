import { NextResponse } from "next/server";
import { buildExport, type ExportKind } from "@/lib/export";
import type { OptimizationResult } from "@/lib/types";
import { errorResponse, requireUser } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NAMES: Record<ExportKind, string> = {
  planning: "planning-corrige",
  echanges: "liste-des-echanges",
  transport: "listes-transport",
  complet: "optimisation-transport-complet",
};

export async function POST(req: Request) {
  try {
    await requireUser();
    const { result, kind } = (await req.json()) as { result: OptimizationResult; kind: ExportKind };
    if (!result || !NAMES[kind]) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
    const buf = await buildExport(result, kind);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${NAMES[kind]}-${result.dates[0] ?? "semaine"}.xlsx"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
