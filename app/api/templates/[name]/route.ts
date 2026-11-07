import { NextResponse } from "next/server";
import { buildTemplate, type TemplateName } from "@/lib/templates";

export const runtime = "nodejs";

const FILES: Record<TemplateName, string> = {
  planning: "modele-planning",
  agents: "modele-agents",
  axes: "modele-axes",
  amenagements: "modele-amenagements",
};

export async function GET(req: Request, { params }: { params: { name: string } }) {
  const name = params.name as TemplateName;
  if (!FILES[name]) return NextResponse.json({ error: "Modèle inconnu." }, { status: 404 });
  const full = new URL(req.url).searchParams.get("full") === "1";
  const buf = await buildTemplate(name, full);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${FILES[name]}${full ? "-complet" : ""}.xlsx"`,
    },
  });
}
