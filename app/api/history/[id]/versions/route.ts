import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireUser } from "@/lib/server/auth";
import { createVersion, listVersions } from "@/lib/server/versions";
import { sanitizeRequest, VersionError } from "@/lib/versions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Versions du planning corrigé d'une optimisation. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    return NextResponse.json({ versions: await listVersions(user, Number(params.id)) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Modifie le planning corrigé : aperçu (save: false) ou nouvelle version (save: true). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    let body: ReturnType<typeof sanitizeRequest>;
    try {
      body = sanitizeRequest(await req.json());
    } catch (e) {
      if (e instanceof VersionError) throw new HttpError(e.status, e.message);
      throw new HttpError(400, "Requête invalide.");
    }
    return NextResponse.json(await createVersion(user, Number(params.id), body));
  } catch (e) {
    return errorResponse(e);
  }
}
