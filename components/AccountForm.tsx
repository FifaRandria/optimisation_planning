"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconAlert, IconCheck, IconKey, IconLock } from "./Icons";

const RULES: [string, (p: string) => boolean][] = [
  ["Au moins 10 caractères", (p) => p.length >= 10],
  ["Des minuscules et des majuscules", (p) => /[a-z]/.test(p) && /[A-Z]/.test(p)],
  ["Au moins un chiffre", (p) => /\d/.test(p)],
];

export default function AccountForm({ mustChange }: { mustChange: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const okRules = RULES.every(([, f]) => f(next));
  const same = next.length > 0 && next === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!okRules || !same) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current, next }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Changement impossible.");
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
      if (mustChange) {
        router.replace("/");
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      {mustChange && (
        <div className="callout warn" style={{ marginTop: 0, marginBottom: 18 }}>
          <IconLock size={16} />
          <span>
            <b>Première connexion :</b> votre mot de passe est provisoire. Choisissez-en un nouveau pour accéder à l'application.
          </span>
        </div>
      )}
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}><IconKey size={18} />Changer le mot de passe</h2>
      <p className="muted small" style={{ marginBottom: 14 }}>Vos autres sessions ouvertes (autres navigateurs, autres postes) seront déconnectées.</p>
      <div className="field">
        <label htmlFor="cur">{mustChange ? "Mot de passe provisoire" : "Mot de passe actuel"}</label>
        <input id="cur" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="new">Nouveau mot de passe</label>
        <input id="new" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
        <ul className="pw-rules">
          {RULES.map(([label, f]) => (
            <li key={label} className={f(next) ? "ok" : ""}>
              <IconCheck size={13} />
              {label}
            </li>
          ))}
        </ul>
      </div>
      <div className="field">
        <label htmlFor="conf">Confirmer le nouveau mot de passe</label>
        <input id="conf" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {confirm.length > 0 && !same && <div className="help" style={{ color: "var(--danger)" }}>Les deux mots de passe ne correspondent pas.</div>}
      </div>
      {error && (
        <div className="callout err">
          <IconAlert size={16} />
          <span>{error}</span>
        </div>
      )}
      {done && !mustChange && (
        <div className="callout ok">
          <IconCheck size={16} />
          <span>Mot de passe modifié.</span>
        </div>
      )}
      <button className="btn primary" style={{ marginTop: 16 }} disabled={busy || !okRules || !same || !current}>
        {busy ? <span className="spinner" /> : <IconKey size={15} />}
        Enregistrer le nouveau mot de passe
      </button>
    </form>
  );
}
