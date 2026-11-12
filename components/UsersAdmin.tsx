"use client";

import { useState } from "react";
import type { UserListItem } from "@/lib/server/users";
import { IconAlert, IconCheck, IconCopy, IconKey, IconTrash, IconUserPlus, IconX } from "./Icons";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "jamais");

interface Secret {
  title: string;
  username: string;
  password: string;
}

/** Affiche une seule fois un mot de passe provisoire, avec bouton copier. */
function SecretDialog({ secret, onClose }: { secret: Secret; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Identifiant : ${secret.username}\nMot de passe provisoire : ${secret.password}`;
  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="secret-title">
      <div className="modal">
        <h2 id="secret-title">{secret.title}</h2>
        <p className="muted small">Transmettez ces informations à la personne. Le mot de passe ne sera plus affiché : elle devra le changer à sa première connexion.</p>
        <div className="secret">
          <div><span className="muted">Identifiant</span><b>{secret.username}</b></div>
          <div><span className="muted">Mot de passe provisoire</span><b className="mono">{secret.password}</b></div>
        </div>
        <div className="row-actions">
          <button
            className="btn"
            onClick={async () => {
              await navigator.clipboard?.writeText(text).catch(() => null);
              setCopied(true);
            }}
          >
            {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
            {copied ? "Copié" : "Copier"}
          </button>
          <button className="btn primary" onClick={onClose}>J'ai transmis le mot de passe</button>
        </div>
      </div>
    </div>
  );
}

export default function UsersAdmin({ initial, meId }: { initial: UserListItem[]; meId: number }) {
  const [users, setUsers] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [form, setForm] = useState({ displayName: "", username: "", role: "user", password: "" });
  const [open, setOpen] = useState(initial.length <= 1);

  async function call(key: string, url: string, init: RequestInit) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Opération impossible.");
      const list = await fetch("/api/users").then((r) => r.json());
      if (list.users) setUsers(list.users);
      return j;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const j = await call("create", "/api/users", { method: "POST", body: JSON.stringify(form) });
    if (j) {
      setSecret({ title: `Compte créé pour ${form.displayName}`, username: form.username.trim().toLowerCase(), password: j.password });
      setForm({ displayName: "", username: "", role: "user", password: "" });
    }
  }

  async function reset(u: UserListItem) {
    if (!confirm(`Réinitialiser le mot de passe de ${u.displayName} ? Ses sessions ouvertes seront fermées.`)) return;
    const j = await call(`reset-${u.id}`, `/api/users/${u.id}/reset`, { method: "POST", body: "{}" });
    if (j) setSecret({ title: `Nouveau mot de passe pour ${u.displayName}`, username: u.username, password: j.password });
  }

  const patch = (u: UserListItem, body: Record<string, unknown>) => call(`patch-${u.id}`, `/api/users/${u.id}`, { method: "PATCH", body: JSON.stringify(body) });

  async function remove(u: UserListItem) {
    if (!confirm(`Supprimer le compte de ${u.displayName} ? Ses optimisations restent dans l'historique (auteur : « compte supprimé »).`)) return;
    await call(`del-${u.id}`, `/api/users/${u.id}`, { method: "DELETE" });
  }

  const admins = users.filter((u) => u.role === "admin" && u.active).length;

  return (
    <>
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}

      <div className="card">
        <div className="card-head">
          <h2>Nouveau compte</h2>
          <button className="btn small" onClick={() => setOpen(!open)}>
            {open ? <IconX size={14} /> : <IconUserPlus size={14} />}
            {open ? "Fermer" : "Ajouter un utilisateur"}
          </button>
        </div>
        {open && (
          <form onSubmit={create} className="form-grid">
            <div className="field">
              <label htmlFor="dn">Nom et prénom</label>
              <input id="dn" type="text" required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="ex. Rasoa Hanta" />
            </div>
            <div className="field">
              <label htmlFor="un">Identifiant de connexion</label>
              <input id="un" type="text" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="ex. hanta.rasoa" />
              <div className="help">3 à 40 caractères : lettres minuscules, chiffres, point, tiret.</div>
            </div>
            <div className="field">
              <label htmlFor="ro">Rôle</label>
              <select id="ro" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="user">Utilisateur</option>
                <option value="admin">Administrateur</option>
              </select>
              <div className="help">{form.role === "admin" ? "Gère les comptes et les réglages, voit tout l'historique." : "Lance des optimisations, voit son propre historique."}</div>
            </div>
            <div className="field">
              <label htmlFor="pw">Mot de passe par défaut</label>
              <input id="pw" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="vide = généré automatiquement" />
              <div className="help">À changer obligatoirement à la première connexion.</div>
            </div>
            <div className="form-actions">
              <button className="btn primary" disabled={busy === "create"}>
                {busy === "create" ? <span className="spinner" /> : <IconUserPlus size={15} />}
                Créer le compte
              </button>
            </div>
          </form>
        )}
      </div>

      {error && (
        <div className="callout err">
          <IconAlert size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Comptes ({users.length})</h2>
          <span className="muted small">{admins} administrateur{admins > 1 ? "s" : ""} actif{admins > 1 ? "s" : ""}</span>
        </div>
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr>
                <th>Personne</th>
                <th>Rôle</th>
                <th>Statut</th>
                <th>Dernière connexion</th>
                <th className="c">Optim.</th>
                <th className="c">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const me = u.id === meId;
                return (
                  <tr key={u.id} className={u.active ? "" : "dim"}>
                    <td className="wrap">
                      <b>{u.displayName}</b> {me && <span className="badge indigo">vous</span>}
                      <div className="muted small">{u.username} · créé le {fmtDate(u.createdAt)}{u.createdBy ? ` par ${u.createdBy}` : ""}</div>
                    </td>
                    <td>
                      <select className="select small" value={u.role} disabled={me || busy !== null} onChange={(e) => patch(u, { role: e.target.value })} aria-label={`Rôle de ${u.displayName}`}>
                        <option value="user">Utilisateur</option>
                        <option value="admin">Administrateur</option>
                      </select>
                    </td>
                    <td>
                      {!u.active ? <span className="badge">désactivé</span> : u.mustChangePassword ? <span className="badge warn">mot de passe provisoire</span> : <span className="badge ok">actif</span>}
                    </td>
                    <td className="small wrap">{fmtDate(u.lastLoginAt)}</td>
                    <td className="c">{u.runs}</td>
                    <td className="c nowrap">
                      <button className="btn small" onClick={() => reset(u)} disabled={busy !== null} title="Générer un nouveau mot de passe provisoire" aria-label={`Réinitialiser le mot de passe de ${u.displayName}`}>
                        <IconKey size={14} />
                      </button>{" "}
                      {!me && (
                        <>
                          <button className="btn small" onClick={() => patch(u, { active: !u.active })} disabled={busy !== null}>
                            {u.active ? "Désactiver" : "Réactiver"}
                          </button>{" "}
                          <button className="btn small ghost danger" onClick={() => remove(u)} disabled={busy !== null} title="Supprimer le compte" aria-label={`Supprimer ${u.displayName}`}>
                            <IconTrash size={14} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
