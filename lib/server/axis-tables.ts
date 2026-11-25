// Tables d'axes enregistrées depuis la page « Axes » : versions par site, une seule active.
// La table active est utilisée par l'optimisation quand aucun fichier d'axes n'est déposé.
import { gunzipSync, gzipSync } from "zlib";
import { toAxeTable, type AxesDoc } from "../axes-map";
import type { ParsedInputs } from "../types";
import type { SiteId } from "../sites";
import { HttpError } from "./auth";
import { pool, q, q1 } from "./db";

export interface AxesVersion {
  id: number;
  createdAt: string;
  userName: string | null;
  comment: string;
  points: number;
  axes: number;
  active: boolean;
}

interface Row {
  id: number;
  created_at: Date;
  user_name: string | null;
  comment: string;
  points: number;
  axes: number;
  active: boolean;
}

const toVersion = (r: Row): AxesVersion => ({
  id: r.id,
  createdAt: new Date(r.created_at).toISOString(),
  userName: r.user_name,
  comment: r.comment,
  points: r.points,
  axes: r.axes,
  active: r.active,
});

const COLS = `t.id, t.created_at, u.display_name AS user_name, t.comment, t.points, t.axes, t.active`;
const FROM = `axis_tables t LEFT JOIN users u ON u.id = t.user_id`;

export async function listAxesVersions(site: SiteId): Promise<AxesVersion[]> {
  return (await q<Row>(`SELECT ${COLS} FROM ${FROM} WHERE t.site = $1 ORDER BY t.created_at DESC LIMIT 50`, [site])).map(toVersion);
}

export async function getAxes(site: SiteId, id?: number): Promise<{ version: AxesVersion; doc: AxesDoc } | null> {
  const r = await q1<Row & { doc_gz: Buffer }>(
    `SELECT ${COLS}, t.doc_gz FROM ${FROM} WHERE t.site = $1 AND ${id ? "t.id = $2" : "t.active"} LIMIT 1`,
    id ? [site, id] : [site]
  );
  if (!r) return null;
  return { version: toVersion(r), doc: JSON.parse(gunzipSync(r.doc_gz).toString("utf8")) as AxesDoc };
}

/** Enregistre une table d'axes et la rend active pour le site (l'ancienne reste dans l'historique). */
export async function saveAxes(site: SiteId, doc: AxesDoc, userId: number, comment: string): Promise<number> {
  if (doc.site !== site) throw new HttpError(400, "La table d'axes ne correspond pas au site.");
  const nAxes = Object.values(doc.plans).reduce((s, p) => s + (p?.axes.filter((a) => a.stops.length).length ?? 0), 0);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE axis_tables SET active = FALSE WHERE site = $1 AND active`, [site]);
    const r = await client.query<{ id: number }>(
      `INSERT INTO axis_tables (site, user_id, comment, points, axes, active, doc_gz) VALUES ($1, $2, $3, $4, $5, TRUE, $6) RETURNING id`,
      [site, userId, comment.slice(0, 500), doc.points.length, nAxes, gzipSync(Buffer.from(JSON.stringify(doc)))]
    );
    await client.query("COMMIT");
    return r.rows[0].id;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Réactive une ancienne version. */
export async function activateAxes(site: SiteId, id: number): Promise<void> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const ok = await client.query(`SELECT 1 FROM axis_tables WHERE site = $1 AND id = $2`, [site, id]);
    if (!ok.rowCount) throw new HttpError(404, "Version d'axes introuvable.");
    await client.query(`UPDATE axis_tables SET active = FALSE WHERE site = $1 AND active`, [site]);
    await client.query(`UPDATE axis_tables SET active = TRUE WHERE id = $1`, [id]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

const fmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Indian/Antananarivo" });

/**
 * Optimisation : sans fichier d'axes déposé, on utilise la table active du site (page « Axes »).
 * Un fichier d'axes déposé reste prioritaire.
 */
export async function withSavedAxes(inputs: ParsedInputs, site: SiteId): Promise<ParsedInputs> {
  const saved = await getAxes(site);
  if (!saved) return inputs;
  if (inputs.axes) {
    inputs.alerts.push({ level: "info", code: "axes-fichier", message: `Une table d'axes a été déposée : elle remplace, pour ce calcul, les axes enregistrés du site (version du ${fmt(saved.version.createdAt)}).` });
    return inputs;
  }
  const axes = toAxeTable(saved.doc, `version du ${fmt(saved.version.createdAt)}`);
  return {
    ...inputs,
    axes,
    alerts: inputs.alerts.filter((a) => a.code !== "axes-absent"),
    detection: [...inputs.detection, { role: "axes", file: axes.file, sheet: axes.sheet, rows: axes.rows.length, note: `colonnes d'axe : ${axes.axeColumns.join(", ")}` }],
  };
}
