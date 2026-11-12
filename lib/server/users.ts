// Gestion des comptes : création par un admin (mot de passe provisoire), rôle, activation, réinitialisation.
import type { Role } from "../settings-meta";
import { HttpError, revokeSessions } from "./auth";
import { q, q1 } from "./db";
import { hashPassword, passwordProblem, temporaryPassword, verifyPassword } from "./password";

export interface UserListItem {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  createdBy: string | null;
  lastLoginAt: string | null;
  runs: number;
}

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

export function normalizeUsername(u: unknown): string {
  return String(u ?? "").trim().toLowerCase();
}

export async function listUsers(): Promise<UserListItem[]> {
  const rows = await q<{
    id: number;
    username: string;
    display_name: string;
    role: Role;
    active: boolean;
    must_change_password: boolean;
    created_at: Date;
    created_by_name: string | null;
    last_login_at: Date | null;
    runs: string;
  }>(
    `SELECT u.id, u.username, u.display_name, u.role, u.active, u.must_change_password, u.created_at, c.display_name AS created_by_name,
            u.last_login_at, (SELECT count(*) FROM optimizations o WHERE o.user_id = u.id) AS runs
       FROM users u LEFT JOIN users c ON c.id = u.created_by
      ORDER BY u.active DESC, u.role, u.display_name`
  );
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    role: r.role,
    active: r.active,
    mustChangePassword: r.must_change_password,
    createdAt: new Date(r.created_at).toISOString(),
    createdBy: r.created_by_name,
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
    runs: Number(r.runs),
  }));
}

/** Crée un compte ; renvoie le mot de passe provisoire (à transmettre à la personne, affiché une seule fois). */
export async function createUser(input: { username?: unknown; displayName?: unknown; role?: unknown; password?: unknown }, by: number): Promise<{ id: number; password: string }> {
  const username = normalizeUsername(input.username);
  const displayName = String(input.displayName ?? "").trim();
  const role: Role = input.role === "admin" ? "admin" : "user";
  if (!USERNAME_RE.test(username)) throw new HttpError(400, "Identifiant invalide : 3 à 40 caractères parmi a-z, 0-9, point, tiret, souligné.");
  if (displayName.length < 2) throw new HttpError(400, "Indiquez le nom de la personne.");
  const password = String(input.password ?? "").trim() || temporaryPassword();
  const pb = passwordProblem(password);
  if (pb) throw new HttpError(400, `Mot de passe par défaut refusé : ${pb}`);
  const exists = await q1(`SELECT 1 FROM users WHERE username = $1`, [username]);
  if (exists) throw new HttpError(409, `L'identifiant « ${username} » existe déjà.`);
  const row = await q1<{ id: number }>(
    `INSERT INTO users (username, display_name, role, password_hash, must_change_password, created_by)
     VALUES ($1, $2, $3, $4, TRUE, $5) RETURNING id`,
    [username, displayName, role, await hashPassword(password), by]
  );
  return { id: row!.id, password };
}

async function activeAdminsExcept(id: number): Promise<number> {
  const r = await q1<{ n: string }>(`SELECT count(*) AS n FROM users WHERE role = 'admin' AND active AND id <> $1`, [id]);
  return Number(r?.n ?? 0);
}

/** Modifie un compte (nom, rôle, activation) avec les garde-fous : jamais sans admin actif, pas d'auto-rétrogradation. */
export async function updateUser(id: number, patch: { displayName?: unknown; role?: unknown; active?: unknown }, by: number): Promise<void> {
  const u = await q1<{ role: Role; active: boolean }>(`SELECT role, active FROM users WHERE id = $1`, [id]);
  if (!u) throw new HttpError(404, "Compte introuvable.");
  const role: Role | undefined = patch.role === "admin" || patch.role === "user" ? patch.role : undefined;
  const active = typeof patch.active === "boolean" ? patch.active : undefined;
  if (id === by && ((role && role !== "admin") || active === false)) throw new HttpError(400, "Vous ne pouvez pas retirer vos propres droits d'administrateur ni désactiver votre compte.");
  const losesAdmin = u.role === "admin" && u.active && (role === "user" || active === false);
  if (losesAdmin && (await activeAdminsExcept(id)) === 0) throw new HttpError(400, "Il doit rester au moins un administrateur actif.");
  const displayName = typeof patch.displayName === "string" && patch.displayName.trim().length >= 2 ? patch.displayName.trim() : undefined;
  await q(
    `UPDATE users SET display_name = COALESCE($2, display_name), role = COALESCE($3, role), active = COALESCE($4, active) WHERE id = $1`,
    [id, displayName ?? null, role ?? null, active ?? null]
  );
  if (active === false) await revokeSessions(id);
}

/** Nouveau mot de passe provisoire : la personne devra le changer à sa prochaine connexion. */
export async function resetPassword(id: number, password?: unknown): Promise<string> {
  const pw = String(password ?? "").trim() || temporaryPassword();
  const pb = passwordProblem(pw);
  if (pb) throw new HttpError(400, `Mot de passe refusé : ${pb}`);
  const r = await q(`UPDATE users SET password_hash = $2, must_change_password = TRUE WHERE id = $1 RETURNING id`, [id, await hashPassword(pw)]);
  if (!r.length) throw new HttpError(404, "Compte introuvable.");
  await revokeSessions(id);
  return pw;
}

export async function deleteUser(id: number, by: number): Promise<void> {
  if (id === by) throw new HttpError(400, "Vous ne pouvez pas supprimer votre propre compte.");
  const u = await q1<{ role: Role; active: boolean }>(`SELECT role, active FROM users WHERE id = $1`, [id]);
  if (!u) throw new HttpError(404, "Compte introuvable.");
  if (u.role === "admin" && u.active && (await activeAdminsExcept(id)) === 0) throw new HttpError(400, "Il doit rester au moins un administrateur actif.");
  await q(`DELETE FROM users WHERE id = $1`, [id]); // l'historique est conservé (auteur = « compte supprimé »)
}

/** Changement de mot de passe par la personne elle-même (mot de passe actuel exigé). */
export async function changeOwnPassword(id: number, current: unknown, next: unknown): Promise<void> {
  const u = await q1<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [id]);
  if (!u) throw new HttpError(404, "Compte introuvable.");
  if (!(await verifyPassword(String(current ?? ""), u.password_hash))) throw new HttpError(400, "Mot de passe actuel incorrect.");
  const pw = String(next ?? "");
  const pb = passwordProblem(pw);
  if (pb) throw new HttpError(400, pb);
  if (await verifyPassword(pw, u.password_hash)) throw new HttpError(400, "Le nouveau mot de passe doit être différent de l'actuel.");
  await q(`UPDATE users SET password_hash = $2, must_change_password = FALSE, password_changed_at = now() WHERE id = $1`, [id, await hashPassword(pw)]);
  await revokeSessions(id, true); // déconnecte les autres appareils
}

/** Vérifie identifiant + mot de passe ; renvoie l'id du compte ou null. */
export async function checkCredentials(username: unknown, password: unknown): Promise<number | null> {
  const u = await q1<{ id: number; password_hash: string; active: boolean }>(`SELECT id, password_hash, active FROM users WHERE username = $1`, [normalizeUsername(username)]);
  // on calcule un hachage même si le compte n'existe pas, pour ne pas révéler son existence par le temps de réponse
  const ok = await verifyPassword(String(password ?? ""), u?.password_hash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  if (!u || !u.active || !ok) return null;
  await q(`UPDATE users SET last_login_at = now() WHERE id = $1`, [u.id]);
  return u.id;
}
