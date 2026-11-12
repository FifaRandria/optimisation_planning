import { NextResponse } from "next/server";
import { pool, ensureSchema } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Santé de l'application (healthcheck Docker, supervision) : base joignable et schéma prêt.
 * Sans authentification ; ne renvoie aucune donnée. Au premier appel, crée les tables et l'admin initial.
 */
export async function GET() {
  try {
    await ensureSchema();
    await pool().query("SELECT 1");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
