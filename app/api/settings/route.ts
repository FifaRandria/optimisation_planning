import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { saveAppSettings, settingsView } from "@/lib/server/app-settings";
import { sanitizeSettings } from "@/lib/server-utils";
import type { SettingKey } from "@/lib/settings-meta";
import { SITES, siteOf } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Réglages d'un site : /api/settings?site=sirius (Connecteo par défaut). */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    return NextResponse.json(await settingsView(user, siteOf(new URL(req.url).searchParams.get("site"))));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Admin : valeurs par défaut d'un site + réglages visibles par les utilisateurs. */
export async function PUT(req: Request) {
  try {
    const admin = await requireUser({ admin: true });
    const body = (await req.json()) as { site?: unknown; values?: unknown; userVisible?: SettingKey[] };
    const site = siteOf(body.site);
    await saveAppSettings(site, sanitizeSettings(body.values, SITES[site].defaults), Array.isArray(body.userVisible) ? body.userVisible : [], admin.id);
    return NextResponse.json(await settingsView(admin, site));
  } catch (e) {
    return errorResponse(e);
  }
}
