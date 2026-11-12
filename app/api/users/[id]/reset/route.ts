import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { resetPassword } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Nouveau mot de passe provisoire (changement obligatoire à la prochaine connexion). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser({ admin: true });
    const body = (await req.json().catch(() => ({}))) as { password?: string };
    const password = await resetPassword(Number(params.id), body.password);
    return NextResponse.json({ password });
  } catch (e) {
    return errorResponse(e);
  }
}
