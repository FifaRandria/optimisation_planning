"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import FormatGuide from "@/components/FormatGuide";
import SettingsPanel from "@/components/Settings";
import Results from "@/components/Results";
import { DEFAULT_SETTINGS, type Alert, type DetectedSource, type OptimizationResult, type Settings } from "@/lib/types";
import { dayLabel } from "@/lib/util";

interface Stats {
  axeColumns: string[];
  dates: string[];
  planningAgents: number;
  withAgent: number;
  withAxe: number;
  withLevel: number;
  withFunction: number;
  functions: number;
  lateShifts: number;
  pickups: number;
  lateAgents: number;
  amenagements: number;
  communes: number;
}
interface Inspect {
  detection: DetectedSource[];
  alerts: Alert[];
  stats: Stats | null;
}

const ROLES: { id: DetectedSource["role"]; label: string; required: boolean; help: string }[] = [
  { id: "planning", label: "Planning de la semaine", required: true, help: "Matricule + dates + heures d'arrivée / départ" },
  { id: "agents", label: "Agents (fonction, commune, axe)", required: true, help: "Matricule + fonction + commune ou Axe 21h / Axe 23h (ex. Personnes-par-fonction)" },
  { id: "axes", label: "Table commune → axe", required: false, help: "Commune + « Axe 21h » / « Axe 23h » (+ chauffeurs, durées)" },
  { id: "amenagements", label: "Aménagements & congés", required: false, help: "Matricule + aménagement (+ congés)" },
];

export default function Page() {
  const [files, setFiles] = useState<File[]>([]);
  const [demo, setDemo] = useState(false);
  const [over, setOver] = useState(false);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const inspectSeq = useRef(0);

  const buildForm = useCallback(
    (withSettings: boolean) => {
      const fd = new FormData();
      if (demo) fd.append("demo", "1");
      else files.forEach((f) => fd.append("files", f, f.name));
      fd.append("settings", JSON.stringify(withSettings ? settings : { ...DEFAULT_SETTINGS, pickupHours: settings.pickupHours, dropHours: settings.dropHours, axe21Waves: settings.axe21Waves }));
      return fd;
    },
    [demo, files, settings]
  );

  // Aperçu automatique dès que les fichiers changent
  useEffect(() => {
    if (!demo && files.length === 0) {
      setInspect(null);
      return;
    }
    const seq = ++inspectSeq.current;
    setInspecting(true);
    setError(null);
    fetch("/api/inspect", { method: "POST", body: buildForm(false) })
      .then(async (r) => {
        const j = await r.json();
        if (seq !== inspectSeq.current) return;
        if (!r.ok) throw new Error(j.error ?? "Erreur d'analyse");
        setInspect(j);
      })
      .catch((e) => seq === inspectSeq.current && setError((e as Error).message))
      .finally(() => seq === inspectSeq.current && setInspecting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, demo, settings.pickupHours, settings.dropHours, settings.axe21Waves]);

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).filter((f) => /\.(xlsx|xlsm|xls)$/i.test(f.name));
    if (incoming.length === 0) {
      setError("Seuls les fichiers Excel (.xlsx, .xlsm) sont acceptés.");
      return;
    }
    setDemo(false);
    setResult(null);
    setFiles((cur) => {
      const names = new Set(cur.map((f) => f.name + f.size));
      return [...cur, ...incoming.filter((f) => !names.has(f.name + f.size))];
    });
  }

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/optimize", { method: "POST", body: buildForm(true) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Erreur d'optimisation");
      setResult(j);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const found = (role: DetectedSource["role"]) => inspect?.detection.filter((d) => d.role === role) ?? [];
  const ready = !!inspect && found("planning").length > 0 && found("agents").length > 0 && (found("axes").length > 0 || (inspect.stats?.withAxe ?? 0) > 0);
  const hasInput = demo || files.length > 0;
  const st = inspect?.stats;

  return (
    <>
      <div className="topbar">
        <div className="wrap">
          <div>
            <h1>Optimiseur de transport des shifts</h1>
            <p>On échange les noms entre les cases d'horaires : même couverture, moins de véhicules.</p>
          </div>
          <div className="steps">
            <span className={"step" + (!result ? " on" : "")}>1 · Fichiers</span>
            <span className={"step" + (!result ? " on" : "")}>2 · Réglages</span>
            <span className={"step" + (result ? " on" : "")}>3 · Résultat</span>
          </div>
        </div>
      </div>

      <main className="wrap">
        <div className="card">
          <div className="card-head">
            <h2><span className="num">1</span>Déposez vos fichiers Excel</h2>
            <span className="hint">Planning S+1 · liste des agents · table des axes · aménagements. Un ou plusieurs fichiers, dans n'importe quel ordre.</span>
          </div>
          <div
            className={"dropzone" + (over ? " over" : "")}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
          >
            <strong>Glissez-déposez vos fichiers .xlsx ici</strong>
            <span>ou</span>
            <div className="row center" style={{ marginTop: 6 }}>
              <button className="btn primary" onClick={() => inputRef.current?.click()}>Choisir des fichiers…</button>
              <button className="btn" onClick={() => { setFiles([]); setResult(null); setDemo(true); }}>Essayer avec des données d'exemple</button>
            </div>
            <input ref={inputRef} type="file" accept=".xlsx,.xlsm" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          </div>

          {(files.length > 0 || demo) && (
            <div className="chips">
              {demo && (
                <span className="chip">
                  Données d'exemple (80 agents, 7 jours)
                  <button onClick={() => { setDemo(false); setInspect(null); setResult(null); }} aria-label="Retirer">×</button>
                </span>
              )}
              {files.map((f, i) => (
                <span className="chip" key={f.name + i}>
                  {f.name} <span style={{ color: "var(--muted)" }}>{(f.size / 1024 / 1024).toFixed(1)} Mo</span>
                  <button onClick={() => { setFiles(files.filter((_, j) => j !== i)); setResult(null); }} aria-label="Retirer">×</button>
                </span>
              ))}
              {inspecting && <span className="chip">Analyse…</span>}
            </div>
          )}

          {hasInput && (
            <div className="roles">
              {ROLES.map((role) => {
                const f = found(role.id);
                const ok = f.length > 0;
                return (
                  <div key={role.id} className={"role " + (ok ? "ok" : role.required && inspect ? "miss" : "opt")}>
                    <h3><span className="dot" />{role.label}{!role.required && <span className="optl">facultatif</span>}</h3>
                    {ok ? (
                      f.slice(0, 3).map((d, i) => (
                        <small key={i}>
                          <b>{d.sheet}</b> — {d.file}<br />
                          {d.rows} ligne{d.rows > 1 ? "s" : ""}{d.note ? ` · ${d.note}` : ""}
                        </small>
                      ))
                    ) : (
                      <small>{inspect ? (role.required ? "Non trouvé : " : "Non fourni : ") : ""}{role.help}</small>
                    )}
                    {f.length > 3 && <small>+ {f.length - 3} autre(s) feuille(s) fusionnée(s)</small>}
                  </div>
                );
              })}
            </div>
          )}

          {inspect?.alerts.map((a, i) => (
            <div className="err" key={i}>{a.message}</div>
          ))}

          {st && (
            <div className="stats">
              <span><b>{st.planningAgents}</b> agents au planning</span>
              <span><b>{st.dates.length}</b> jours ({dayLabel(st.dates[0])} → {dayLabel(st.dates[st.dates.length - 1])})</span>
              <span><b>{st.pickups}</b> ramassages · <b>{st.lateShifts}</b> remisages ({st.lateAgents} agents)</span>
              <span><b>{st.withAxe}</b>/{st.planningAgents} avec un axe</span>
              <span><b>{st.withFunction}</b>/{st.planningAgents} avec une fonction ({st.functions} fonctions)</span>
              {st.withLevel > 0 && <span><b>{st.withLevel}</b>/{st.planningAgents} avec un niveau</span>}
            </div>
          )}
          {st && st.withAxe < st.planningAgents * 0.8 && (
            <div className="note">
              <b>Attention :</b> {st.planningAgents - st.withAxe} agents n'ont pas d'axe (commune absente ou inconnue). Ils seront <b>figés</b> (jamais échangés) et listés dans les alertes. Plus la liste des agents est complète, plus il y a d'échanges possibles.
            </div>
          )}
        </div>

        <FormatGuide open={!hasInput} />

        <div className="card">
          <div className="card-head">
            <h2><span className="num">2</span>Réglages</h2>
            <button className="link" onClick={() => setSettings(DEFAULT_SETTINGS)}>Valeurs par défaut</button>
          </div>
          <SettingsPanel settings={settings} onChange={setSettings} />
          <div className="runbar">
            <button className="btn primary big" disabled={!ready || running} onClick={run}>
              {running ? <><span className="spinner" /> Optimisation…</> : "Optimiser"}
            </button>
            {!hasInput && <span className="hint" style={{ color: "var(--muted)" }}>Déposez vos fichiers (ou lancez l'exemple) pour commencer.</span>}
            {hasInput && !ready && !inspecting && <span style={{ color: "var(--danger)", fontSize: 14 }}>Il manque le planning, la liste des agents (fonction) ou les axes.</span>}
          </div>
          {error && <div className="err">{error}</div>}
        </div>

        <div ref={resultRef}>{result && <Results r={result} />}</div>
      </main>
    </>
  );
}
