import { NextResponse } from "next/server";
import { errorResponse, loginFailed, loginLocked, loginSucceeded, startSession } from "@/lib/server/auth";
import { checkCredentials, normalizeUsername } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { username, password } = (await req.json()) as { username?: string; password?: string };
    const key = normalizeUsername(username);
    const locked = loginLocked(key);
    if (locked) return NextResponse.json({ error: `Trop de tentatives. Réessayez dans ${locked} min.` }, { status: 429 });
    const id = await checkCredentials(username, password);
    if (!id) {
      loginFailed(key);
      return NextResponse.json({ error: "Identifiant ou mot de passe incorrect." }, { status: 401 });
    }
    loginSucceeded(key);
    await startSession(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
