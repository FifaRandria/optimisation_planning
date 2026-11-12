import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { saveAppSettings, settingsView } from "@/lib/server/app-settings";
import { sanitizeSettings } from "@/lib/server-utils";
import type { SettingKey } from "@/lib/settings-meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await settingsView(user));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Admin : valeurs par défaut de l'organisation + réglages visibles par les utilisateurs. */
export async function PUT(req: Request) {
  try {
    const admin = await requireUser({ admin: true });
    const body = (await req.json()) as { values?: unknown; userVisible?: SettingKey[] };
    await saveAppSettings(sanitizeSettings(body.values), Array.isArray(body.userVisible) ? body.userVisible : [], admin.id);
    return NextResponse.json(await settingsView(admin));
  } catch (e) {
    return errorResponse(e);
  }
}
