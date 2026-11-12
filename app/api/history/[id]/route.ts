import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { deleteOptimization, getOptimization } from "@/lib/server/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    return NextResponse.json(await getOptimization(user, Number(params.id)));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await deleteOptimization(user, Number(params.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
