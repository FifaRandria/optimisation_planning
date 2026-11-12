"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconAlert, IconBus, IconEye, IconLock } from "./Icons";

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Connexion impossible.");
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="logo"><IconBus size={22} /></span>
          <div>
            <h1>Optimiseur de transport</h1>
            <p>Connectez-vous pour continuer</p>
          </div>
        </div>
        <div className="field">
          <label htmlFor="u">Identifiant</label>
          <input id="u" type="text" autoComplete="username" autoFocus required value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="p">Mot de passe</label>
          <div className="pw">
            <input id="p" type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? "Masquer le mot de passe" : "Afficher le mot de passe"}>
              <IconEye size={16} />
            </button>
          </div>
        </div>
        {error && (
          <div className="callout err">
            <IconAlert size={16} />
            <span>{error}</span>
          </div>
        )}
        <button className="btn primary big" style={{ width: "100%", marginTop: 18 }} disabled={busy}>
          {busy ? <span className="spinner" /> : <IconLock size={16} />}
          Se connecter
        </button>
        <p className="auth-note">Pas encore de compte ? Demandez-le à un administrateur. Mot de passe oublié : un administrateur peut le réinitialiser.</p>
      </form>
    </div>
  );
}
