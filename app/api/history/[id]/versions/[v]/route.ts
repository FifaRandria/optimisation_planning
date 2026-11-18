import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { getVersion } from "@/lib/server/versions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string; v: string } }) {
  try {
    const user = await requireUser();
    return NextResponse.json(await getVersion(user, Number(params.id), Number(params.v)));
  } catch (e) {
    return errorResponse(e);
  }
}
