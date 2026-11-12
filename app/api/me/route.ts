import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { settingsView } from "@/lib/server/app-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Compte connecté + réglages tels qu'il doit les voir. */
export async function GET() {
  try {
    const user = await requireUser({ allowMustChange: true });
    return NextResponse.json({ user, settings: await settingsView(user) });
  } catch (e) {
    return errorResponse(e);
  }
}
