import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { knownAxes, searchAgents } from "@/lib/server/versions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recherche d'une personne de la liste des agents (renfort) ; sans « q » : la liste des axes connus. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const id = Number(params.id);
    const q = new URL(req.url).searchParams.get("q") ?? "";
    if (!q) {
      await searchAgents(user, id, ""); // contrôle d'accès
      return NextResponse.json({ axes: await knownAxes(id) });
    }
    return NextResponse.json({ hits: await searchAgents(user, id, q) });
  } catch (e) {
    return errorResponse(e);
  }
}
