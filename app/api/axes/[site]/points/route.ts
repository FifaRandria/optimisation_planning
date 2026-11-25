import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireUser } from "@/lib/server/auth";
import { getAxes } from "@/lib/server/axis-tables";
import { readPoints } from "@/lib/axes-input";
import { geocodeAll, geocodePlace, geocodingAvailable } from "@/lib/geo/geocode";
import { lookupPlace } from "@/lib/geo/gazetteer";
import { isSiteId, SITES } from "@/lib/sites";
import { norm } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Fichier déposé -> points de la carte. Position de chaque quartier, dans l'ordre :
 * coordonnées du fichier, position déjà enregistrée pour ce site (corrections à la main conservées),
 * répertoire officiel des fokontany d'Analamanga (COD-AB, HDX : hors ligne), puis géocodage local (Nominatim) s'il est installé.
 */
export async function POST(req: Request, { params }: { params: { site: string } }) {
  try {
    await requireUser({ admin: true });
    if (!isSiteId(params.site)) throw new HttpError(404, "Site inconnu.");
    const form = await req.formData();
    const files: { name: string; buffer: Buffer }[] = [];
    for (const v of form.getAll("files")) if (typeof v !== "string") files.push({ name: v.name, buffer: Buffer.from(await v.arrayBuffer()) });
    if (!files.length) throw new HttpError(400, "Aucun fichier reçu.");
    const { points, sources, warnings } = readPoints(files);

    const saved = await getAxes(params.site);
    const known = new Map((saved?.doc.points ?? []).filter((p) => p.lat !== null).map((p) => [norm(p.key), p]));
    const todo = points.filter((p) => {
      if (p.lat !== null) return false;
      const k = known.get(norm(p.key));
      if (!k) return true;
      p.lat = k.lat;
      p.lon = k.lon;
      p.status = "saved";
      return false;
    });
    const near = saved?.doc.settings.site ?? SITES[params.site].coords;
    const rest = todo.filter((p) => {
      const hit = lookupPlace([p.key, ...p.hints], near);
      if (!hit) return true;
      Object.assign(p, { lat: hit.lat, lon: hit.lon, status: "gazetteer", place: hit.label });
      return false;
    });
    if (geocodingAvailable())
      await geocodeAll(rest, async (p) => {
        const r = await geocodePlace(p.key, p.hints);
        if (r.pos) Object.assign(p, { lat: r.pos.lat, lon: r.pos.lon, status: r.status });
      });
    return NextResponse.json({ points, sources, warnings, geocoding: geocodingAvailable() });
  } catch (e) {
    return errorResponse(e);
  }
}
