import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { createUser, listUsers } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser({ admin: true });
    return NextResponse.json({ users: await listUsers() });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Création d'un compte par un admin : renvoie le mot de passe provisoire (affiché une seule fois). */
export async function POST(req: Request) {
  try {
    const admin = await requireUser({ admin: true });
    const body = (await req.json()) as { username?: string; displayName?: string; role?: string; password?: string };
    const created = await createUser(body, admin.id);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
