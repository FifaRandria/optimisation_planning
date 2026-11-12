// Sessions (cookie httpOnly + table sessions), utilisateur courant et contrôles d'accès.
import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { PublicUser, Role } from "../settings-meta";
import { q, q1 } from "./db";

export const SESSION_COOKIE = "to_session";
const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS) || 12;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  must_change_password: boolean;
  active: boolean;
}

export const toPublic = (u: UserRow): PublicUser => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  role: u.role,
  mustChangePassword: u.must_change_password,
});

/** Crée une session et pose le cookie. */
export async function startSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + TTL_HOURS * 3600_000);
  await q(`INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`, [sha256(token), userId, expires]);
  await q(`DELETE FROM sessions WHERE expires_at < now()`); // ménage
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    expires,
  });
}

export async function endSession(): Promise<void> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) await q(`DELETE FROM sessions WHERE id = $1`, [sha256(token)]);
  cookies().delete(SESSION_COOKIE);
}

/** Supprime toutes les sessions d'un utilisateur, sauf éventuellement la session courante. */
export async function revokeSessions(userId: number, keepCurrent = false): Promise<void> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (keepCurrent && token) await q(`DELETE FROM sessions WHERE user_id = $1 AND id <> $2`, [userId, sha256(token)]);
  else await q(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

/** Utilisateur connecté (session valide, compte actif), ou null. */
export async function currentUser(): Promise<PublicUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const u = await q1<UserRow>(
    `SELECT u.id, u.username, u.display_name, u.role, u.must_change_password, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now() AND u.active`,
    [sha256(token)]
  );
  return u ? toPublic(u) : null;
}

/**
 * Pour les pages (composants serveur) : utilisateur connecté, sinon redirection vers /login.
 * Le layout vérifie aussi la session, mais Next.js peut rendre la page en parallèle : chaque page doit se protéger.
 */
export async function pageUser(opts: { admin?: boolean } = {}): Promise<PublicUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (opts.admin && u.role !== "admin") redirect("/");
  return u;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Garde pour les routes API. Par défaut, refuse aussi un compte qui doit encore changer
 * son mot de passe (première connexion) : seules les routes de compte passent `allowMustChange`.
 */
export async function requireUser(opts: { admin?: boolean; allowMustChange?: boolean } = {}): Promise<PublicUser> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "Session expirée : reconnectez-vous.");
  if (u.mustChangePassword && !opts.allowMustChange) throw new HttpError(403, "Changez d'abord votre mot de passe (première connexion).");
  if (opts.admin && u.role !== "admin") throw new HttpError(403, "Réservé aux administrateurs.");
  return u;
}

/** Transforme une erreur en réponse JSON propre. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  const msg = (e as Error)?.message ?? "Erreur inattendue";
  console.error(e);
  const db = /ECONNREFUSED|recovery mode|password authentication|DATABASE_URL|does not exist/i.test(msg);
  return NextResponse.json({ error: db ? `Base de données indisponible : ${msg}` : msg }, { status: 500 });
}

// --- limitation des tentatives de connexion (mémoire du processus) ---------------------
const attempts = new Map<string, { n: number; until: number }>();
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60_000;

export function loginLocked(key: string): number {
  const a = attempts.get(key);
  return a && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 60_000) : 0;
}
export function loginFailed(key: string): void {
  const a = attempts.get(key) ?? { n: 0, until: 0 };
  a.n++;
  if (a.n >= MAX_FAILS) {
    a.until = Date.now() + LOCK_MS;
    a.n = 0;
  }
  attempts.set(key, a);
}
export function loginSucceeded(key: string): void {
  attempts.delete(key);
}
