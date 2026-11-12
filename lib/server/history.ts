// Historique des optimisations : chacun voit les siennes, un admin voit tout.
import { gunzipSync, gzipSync } from "zlib";
import type { OptimizationResult } from "../types";
import type { PublicUser } from "../settings-meta";
import { dayLabel } from "../util";
import { HttpError } from "./auth";
import { q, q1 } from "./db";

export interface HistoryItem {
  id: number;
  createdAt: string;
  label: string;
  userId: number | null;
  userName: string | null;
  files: string[];
  periodStart: string | null;
  periodEnd: string | null;
  agents: number;
  vehiclesBefore: number;
  vehiclesAfter: number;
  swaps: number;
  swapsOff: number;
  swapsReserve: number;
  durationMs: number;
}

const COLS = `o.id, o.created_at, o.label, o.user_id, u.display_name AS user_name, o.files, o.period_start, o.period_end, o.agents,
  o.vehicles_before, o.vehicles_after, o.swaps, o.swaps_off, o.swaps_reserve, o.duration_ms`;

interface Row {
  id: number;
  created_at: Date;
  label: string;
  user_id: number | null;
  user_name: string | null;
  files: string[];
  period_start: Date | string | null;
  period_end: Date | string | null;
  agents: number;
  vehicles_before: number;
  vehicles_after: number;
  swaps: number;
  swaps_off: number;
  swaps_reserve: number;
  duration_ms: number;
}

const iso = (d: Date | string | null) => (d == null ? null : typeof d === "string" ? d.slice(0, 10) : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10));

const toItem = (r: Row): HistoryItem => ({
  id: r.id,
  createdAt: new Date(r.created_at).toISOString(),
  label: r.label,
  userId: r.user_id,
  userName: r.user_name,
  files: r.files,
  periodStart: iso(r.period_start),
  periodEnd: iso(r.period_end),
  agents: r.agents,
  vehiclesBefore: r.vehicles_before,
  vehiclesAfter: r.vehicles_after,
  swaps: r.swaps,
  swapsOff: r.swaps_off,
  swapsReserve: r.swaps_reserve,
  durationMs: r.duration_ms,
});

/** Filtre de visibilité : un utilisateur ne voit que ses optimisations. */
const scope = (user: PublicUser, alias = "o") => (user.role === "admin" ? { sql: "TRUE", params: [] as unknown[] } : { sql: `${alias}.user_id = $1`, params: [user.id] as unknown[] });

export async function saveOptimization(user: PublicUser, files: string[], result: OptimizationResult, durationMs: number): Promise<number> {
  const d = result.dates;
  const label = d.length ? `Planning du ${dayLabel(d[0])} au ${dayLabel(d[d.length - 1])}` : "Planning";
  const row = await q1<{ id: number }>(
    `INSERT INTO optimizations (user_id, label, files, period_start, period_end, agents, vehicles_before, vehicles_after,
       swaps, swaps_off, swaps_reserve, duration_ms, settings, result_gz)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      user.id,
      label,
      JSON.stringify(files),
      d[0] ?? null,
      d[d.length - 1] ?? null,
      result.agents.filter((a) => !a.reserve).length,
      result.metricsBefore.vehicles,
      result.metricsAfter.vehicles,
      result.swaps.length,
      result.swaps.filter((s) => s.kind === "off").length,
      result.swaps.filter((s) => s.kind === "reserve").length,
      Math.round(durationMs),
      JSON.stringify(result.settings),
      gzipSync(Buffer.from(JSON.stringify(result))),
    ]
  );
  return row!.id;
}

export async function listOptimizations(user: PublicUser, limit = 500): Promise<HistoryItem[]> {
  const s = scope(user);
  const rows = await q<Row>(
    `SELECT ${COLS} FROM optimizations o LEFT JOIN users u ON u.id = o.user_id WHERE ${s.sql} ORDER BY o.created_at DESC LIMIT ${Number(limit)}`,
    s.params
  );
  return rows.map(toItem);
}

export async function getOptimization(user: PublicUser, id: number): Promise<{ item: HistoryItem; result: OptimizationResult }> {
  const r = await q1<Row & { result_gz: Buffer }>(`SELECT ${COLS}, o.result_gz FROM optimizations o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`, [id]);
  if (!r) throw new HttpError(404, "Optimisation introuvable.");
  if (user.role !== "admin" && r.user_id !== user.id) throw new HttpError(403, "Cette optimisation ne vous appartient pas.");
  const result = JSON.parse(gunzipSync(r.result_gz).toString("utf8")) as OptimizationResult;
  return { item: toItem(r), result: { ...result, historyId: r.id } };
}

export async function deleteOptimization(user: PublicUser, id: number): Promise<void> {
  const r = await q1<{ user_id: number | null }>(`SELECT user_id FROM optimizations WHERE id = $1`, [id]);
  if (!r) throw new HttpError(404, "Optimisation introuvable.");
  if (user.role !== "admin" && r.user_id !== user.id) throw new HttpError(403, "Cette optimisation ne vous appartient pas.");
  await q(`DELETE FROM optimizations WHERE id = $1`, [id]);
}

export interface Dashboard {
  scope: "all" | "mine";
  runs: number;
  vehiclesSaved: number;
  vehiclesBefore: number;
  avgGainPct: number;
  swaps: { jour: number; off: number; reserve: number };
  lastRunAt: string | null;
  series: { id: number; label: string; date: string; before: number; after: number }[];
  recent: HistoryItem[];
  perUser: { name: string; runs: number; saved: number }[];
  users?: { total: number; admins: number; active: number; pendingPassword: number };
}

export async function dashboard(user: PublicUser): Promise<Dashboard> {
  const items = await listOptimizations(user, 1000);
  const runs = items.length;
  const vehiclesBefore = items.reduce((s, i) => s + i.vehiclesBefore, 0);
  const vehiclesSaved = items.reduce((s, i) => s + (i.vehiclesBefore - i.vehiclesAfter), 0);
  const gains = items.filter((i) => i.vehiclesBefore > 0).map((i) => (100 * (i.vehiclesBefore - i.vehiclesAfter)) / i.vehiclesBefore);
  const perUserMap = new Map<string, { runs: number; saved: number }>();
  for (const i of items) {
    const k = i.userName ?? "Compte supprimé";
    const cur = perUserMap.get(k) ?? { runs: 0, saved: 0 };
    cur.runs++;
    cur.saved += i.vehiclesBefore - i.vehiclesAfter;
    perUserMap.set(k, cur);
  }
  const out: Dashboard = {
    scope: user.role === "admin" ? "all" : "mine",
    runs,
    vehiclesSaved,
    vehiclesBefore,
    avgGainPct: gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : 0,
    swaps: {
      jour: items.reduce((s, i) => s + i.swaps - i.swapsOff - i.swapsReserve, 0),
      off: items.reduce((s, i) => s + i.swapsOff, 0),
      reserve: items.reduce((s, i) => s + i.swapsReserve, 0),
    },
    lastRunAt: items[0]?.createdAt ?? null,
    series: items
      .slice(0, 12)
      .reverse()
      .map((i) => ({ id: i.id, label: i.label, date: i.createdAt, before: i.vehiclesBefore, after: i.vehiclesAfter })),
    recent: items.slice(0, 6),
    perUser: [...perUserMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.saved - a.saved),
  };
  if (user.role === "admin") {
    const u = await q1<{ total: string; admins: string; active: string; pending: string }>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE role = 'admin') AS admins, count(*) FILTER (WHERE active) AS active,
              count(*) FILTER (WHERE must_change_password AND active) AS pending FROM users`
    );
    out.users = { total: Number(u?.total ?? 0), admins: Number(u?.admins ?? 0), active: Number(u?.active ?? 0), pendingPassword: Number(u?.pending ?? 0) };
  }
  return out;
}
