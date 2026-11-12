"use client";

import { useState } from "react";
import SettingsPanel from "./Settings";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";
import { DEFAULT_USER_VISIBLE, SETTING_GROUPS, type SettingKey } from "@/lib/settings-meta";
import { IconAlert, IconCheck, IconEye, IconLock } from "./Icons";

export default function SettingsAdmin({ initialValues, initialVisible }: { initialValues: Settings; initialVisible: SettingKey[] }) {
  const [values, setValues] = useState(initialValues);
  const [visible, setVisible] = useState(new Set(initialVisible));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const touch = () => {
    setDirty(true);
    setSaved(false);
  };
  const toggleKey = (k: SettingKey) => {
    const n = new Set(visible);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setVisible(n);
    touch();
  };
  const toggleGroup = (keys: SettingKey[], on: boolean) => {
    const n = new Set(visible);
    keys.forEach((k) => (on ? n.add(k) : n.delete(k)));
    setVisible(n);
    touch();
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values, userVisible: [...visible] }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Enregistrement impossible.");
      setValues(j.values);
      setVisible(new Set(j.userVisible));
      setSaved(true);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div className="title">
            <span className="num"><IconEye size={16} /></span>
            <div>
              <h2>Visible par les utilisateurs</h2>
              <p>Cochez ce que les utilisateurs peuvent voir et modifier. Tout le reste est masqué pour eux et prend la valeur par défaut ci-dessous (appliquée aussi côté serveur).</p>
            </div>
          </div>
          <button
            className="btn ghost small"
            onClick={() => {
              setVisible(new Set(DEFAULT_USER_VISIBLE));
              touch();
            }}
          >
            Visibilité recommandée
          </button>
        </div>
        <div className="vis-grid">
          {SETTING_GROUPS.map((g) => {
            const keys = g.keys.map((k) => k.key);
            const all = keys.every((k) => visible.has(k));
            const none = keys.every((k) => !visible.has(k));
            return (
              <div className="vis-group" key={g.id}>
                <label className="vis-head">
                  <input
                    type="checkbox"
                    checked={all}
                    ref={(el) => {
                      if (el) el.indeterminate = !all && !none;
                    }}
                    onChange={(e) => toggleGroup(keys, e.target.checked)}
                  />
                  <b>{g.label}</b>
                  <span className={"badge " + (all ? "ok" : none ? "" : "warn")}>{all ? "visible" : none ? <><IconLock size={11} />admin</> : "en partie"}</span>
                </label>
                {g.keys.map((k) => (
                  <label className="vis-item" key={k.key}>
                    <input type="checkbox" checked={visible.has(k.key)} onChange={() => toggleKey(k.key)} />
                    <span>{k.label}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="title">
            <span className="num">2</span>
            <div>
              <h2>Valeurs par défaut</h2>
              <p>Proposées à chaque nouvelle optimisation. Les utilisateurs ne peuvent pas changer les réglages qui leur sont masqués.</p>
            </div>
          </div>
          <button
            className="btn ghost small"
            onClick={() => {
              setValues(DEFAULT_SETTINGS);
              touch();
            }}
          >
            Valeurs recommandées (v2)
          </button>
        </div>
        <SettingsPanel
          settings={values}
          onChange={(s) => {
            setValues(s);
            touch();
          }}
          advancedOpen
        />
      </div>

      <div className="savebar">
        {error ? (
          <span className="callout err" style={{ margin: 0 }}><IconAlert size={16} /><span>{error}</span></span>
        ) : saved ? (
          <span className="saved"><IconCheck size={16} />Réglages enregistrés : ils s'appliquent aux prochaines optimisations.</span>
        ) : (
          <span className="muted">{dirty ? "Modifications non enregistrées." : "Aucune modification."}</span>
        )}
        <button className="btn primary" onClick={save} disabled={busy || !dirty}>
          {busy ? <span className="spinner" /> : <IconCheck size={15} />}
          Enregistrer
        </button>
      </div>
    </>
  );
}
