import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/server/auth";
import { deleteUser, updateUser } from "@/lib/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const admin = await requireUser({ admin: true });
    await updateUser(Number(params.id), (await req.json()) as Record<string, unknown>, admin.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const admin = await requireUser({ admin: true });
    await deleteUser(Number(params.id), admin.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
