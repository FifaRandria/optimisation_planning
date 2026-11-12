import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { changeOwnPassword } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Changement de son propre mot de passe (autorisé aussi pendant la première connexion). */
export async function POST(req: Request) {
  try {
    const user = await requireUser({ allowMustChange: true });
    const { current, next } = (await req.json()) as { current?: string; next?: string };
    await changeOwnPassword(user.id, current, next);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
