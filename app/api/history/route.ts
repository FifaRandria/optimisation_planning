import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { listOptimizations } from "@/lib/server/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Historique : les siennes pour un utilisateur, toutes pour un admin. */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ items: await listOptimizations(user) });
  } catch (e) {
    return errorResponse(e);
  }
}
