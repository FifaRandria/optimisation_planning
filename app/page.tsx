"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import FormatGuide from "@/components/FormatGuide";
import SettingsPanel from "@/components/Settings";
import Results from "@/components/Results";
import { IconAlert, IconBook, IconBus, IconCalendar, IconCheck, IconFile, IconSparkles, IconSwap, IconUpload, IconUsers, IconX } from "@/components/Icons";
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
  { id: "planning", label: "Planning S+1", required: true, help: "Matricule + dates + heures d'arrivée / de départ" },
  { id: "agents", label: "Agents et fonctions", required: true, help: "Matricule + Fonction + Axe 21h / Axe 23h ou commune (ex. Personnes-par-fonction)" },
  { id: "axes", label: "Table des axes", required: false, help: "Commune → Axe 21h / Axe 23h, chauffeurs, durées" },
  { id: "amenagements", label: "Aménagements et congés", required: false, help: "Matricule + aménagement (+ dates de congé)" },
];

const fmtNum = (n: number) => n.toLocaleString("fr-FR");
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function Meter({ value }: { value: number }) {
  return (
    <div className={"meter" + (value < 60 ? " bad" : value < 85 ? " warn" : "")}>
      <i style={{ width: `${value}%` }} />
    </div>
  );
}

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
  const [stale, setStale] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
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

  // un réglage modifié après un calcul : le résultat affiché n'est plus à jour
  useEffect(() => {
    if (result) setStale(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

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
      setStale(false);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const found = (role: DetectedSource["role"]) => inspect?.detection.filter((d) => d.role === role) ?? [];
  const hasAxes = found("axes").length > 0 || (inspect?.stats?.withAxe ?? 0) > 0;
  const missing: string[] = [];
  if (inspect) {
    if (!found("planning").length) missing.push("le planning");
    if (!found("agents").length) missing.push("la liste des agents (fonction)");
    if (!hasAxes) missing.push("les axes");
  }
  const ready = !!inspect && missing.length === 0;
  const hasInput = demo || files.length > 0;
  const st = inspect?.stats;
  const step = result ? 3 : ready ? 2 : 1;

  let statusCls = "";
  let statusTxt: React.ReactNode = "Déposez vos fichiers Excel, ou lancez l'exemple, pour commencer.";
  if (inspecting) statusTxt = "Analyse des fichiers…";
  else if (hasInput && inspect && !ready) {
    statusCls = "bad";
    statusTxt = <>Il manque <b>{missing.join(", ")}</b>.</>;
  } else if (ready && st) {
    statusCls = "ready";
    statusTxt = (
      <>
        <b>Prêt</b> · {fmtNum(st.planningAgents)} agents · {st.dates.length} jours · {fmtNum(st.pickups + st.lateShifts)} trajets à optimiser
        {result && stale && <> · <span style={{ color: "var(--warn)" }}>réglages modifiés : relancez le calcul</span></>}
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <div className="brand">
            <div className="logo"><IconBus size={20} /></div>
            <div>
              <h1>Optimiseur de transport<span className="version">v2</span></h1>
              <p>Moins de véhicules, même couverture : on échange les cases entre agents de même fonction.</p>
            </div>
          </div>
          <nav className="stepper" aria-label="Étapes">
            {["Fichiers", "Réglages", "Résultat"].map((l, i) => (
              <span key={l} style={{ display: "contents" }}>
                {i > 0 && <span className="stp-sep" />}
                <span className={"stp" + (step === i + 1 ? " active" : step > i + 1 ? " done" : "")}>
                  <span className="n">{step > i + 1 ? <IconCheck size={13} /> : i + 1}</span>
                  <span className="lbl">{l}</span>
                </span>
              </span>
            ))}
          </nav>
        </div>
      </header>

      <main className="wrap">
        <section className="rules" aria-label="Règles appliquées">
          <div className="rule">
            <span className="ic indigo"><IconUsers size={18} /></span>
            <div><h4>Même fonction</h4><p>Deux agents ne s'échangent que s'ils ont exactement la même fonction.</p></div>
          </div>
          <div className="rule">
            <span className="ic sky"><IconBus size={18} /></span>
            <div><h4>Vagues réelles</h4><p>Ramassage des arrivées à 6h ; remisage des sorties de 18h à 23h, une vague par heure.</p></div>
          </div>
          <div className="rule">
            <span className="ic violet"><IconCalendar size={18} /></span>
            <div><h4>Axe selon la vague</h4><p>« Axe 21h » pour 21h et 22h ; « Axe 23h » pour 6h, 18h, 19h, 20h et 23h.</p></div>
          </div>
          <div className="rule">
            <span className="ic amber"><IconSwap size={18} /></span>
            <div><h4>Échange jour ↔ OFF</h4><p>Par paire, dans la même semaine : chaque jour reste couvert, chacun garde ses OFF.</p></div>
          </div>
        </section>

        <div className="card">
          <div className="card-head">
            <div className="title">
              <span className={"num" + (ready ? " done" : "")}>{ready ? <IconCheck size={16} /> : 1}</span>
              <div>
                <h2>Fichiers Excel</h2>
                <p>Planning S+1, liste des agents (Personnes-par-fonction), table des axes, aménagements. Un ou plusieurs fichiers, dans n'importe quel ordre.</p>
              </div>
            </div>
          </div>

          <div
            className={"dropzone" + (over ? " over" : "")}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
          >
            <div className="bigic"><IconUpload size={24} /></div>
            <strong>Glissez-déposez vos fichiers .xlsx ici</strong>
            <div className="sub">Les feuilles utiles sont reconnues automatiquement grâce à leurs en-têtes.</div>
            <div className="actions">
              <button className="btn primary" onClick={() => inputRef.current?.click()}><IconFile size={16} />Choisir des fichiers…</button>
              <button className="btn" onClick={() => { setFiles([]); setResult(null); setDemo(true); }}><IconSparkles size={16} />Essayer avec des données d'exemple</button>
            </div>
            <input ref={inputRef} type="file" accept=".xlsx,.xlsm" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          </div>

          {hasInput && (
            <div className="files">
              {demo && (
                <span className="file demo">
                  <IconSparkles size={15} />
                  <span className="nm">Données d'exemple (fictives)</span>
                  <button className="x" onClick={() => { setDemo(false); setInspect(null); setResult(null); }} aria-label="Retirer les données d'exemple"><IconX size={14} /></button>
                </span>
              )}
              {files.map((f, i) => (
                <span className="file" key={f.name + i}>
                  <IconFile size={15} />
                  <span className="nm" title={f.name}>{f.name}</span>
                  <span className="sz">{(f.size / 1024 / 1024).toFixed(1)} Mo</span>
                  <button className="x" onClick={() => { setFiles(files.filter((_, j) => j !== i)); setResult(null); }} aria-label={`Retirer ${f.name}`}><IconX size={14} /></button>
                </span>
              ))}
              {inspecting && <span className="file"><span className="spinner dark" />Analyse…</span>}
            </div>
          )}

          {hasInput && inspect && (
            <div className="roles fade">
              {ROLES.map((role) => {
                const f = found(role.id);
                const ok = f.length > 0 || (role.id === "axes" && hasAxes);
                const cls = ok ? "ok" : role.required ? "miss" : "";
                return (
                  <div key={role.id} className={"role " + cls}>
                    <h3>
                      <span className="st">{ok ? <IconCheck size={12} /> : role.required ? <IconX size={12} /> : null}</span>
                      {role.label}
                      <span className="tag">{role.required ? "obligatoire" : "facultatif"}</span>
                    </h3>
                    {f.length > 0 ? (
                      f.slice(0, 2).map((d, i) => (
                        <small key={i}>
                          <b>{d.sheet}</b> — {d.file}
                          <br />
                          {fmtNum(d.rows)} ligne{d.rows > 1 ? "s" : ""}
                          {d.note ? ` · ${d.note}` : ""}
                        </small>
                      ))
                    ) : role.id === "axes" && hasAxes ? (
                      <small>Pas de table : les axes viennent directement de la liste des agents.</small>
                    ) : (
                      <small>{role.required ? "Non trouvé. Attendu : " : "Non fourni : "}{role.help}</small>
                    )}
                    {f.length > 2 && <small>+ {f.length - 2} autre(s) feuille(s) fusionnée(s)</small>}
                  </div>
                );
              })}
            </div>
          )}

          {inspect?.alerts.map((a, i) => (
            <div className={"callout " + (a.level === "error" ? "err" : "warn")} key={i}>
              <IconAlert size={16} />
              <span>{a.message}</span>
            </div>
          ))}

          {st && (
            <div className="overview fade">
              <div className="tile">
                <div className="lbl"><IconUsers size={13} />Agents</div>
                <div className="v">{fmtNum(st.planningAgents)}</div>
                <div className="s">{st.functions} fonctions différentes</div>
              </div>
              <div className="tile">
                <div className="lbl"><IconCalendar size={13} />Période</div>
                <div className="v">{st.dates.length} <small>jours</small></div>
                <div className="s">{dayLabel(st.dates[0])} → {dayLabel(st.dates[st.dates.length - 1])}</div>
              </div>
              <div className="tile">
                <div className="lbl" style={{ color: "var(--pickup)" }}>Ramassages</div>
                <div className="v">{fmtNum(st.pickups)}</div>
                <div className="s">arrivées à {settings.pickupHours.map((h) => h + "h").join(", ") || "—"}</div>
              </div>
              <div className="tile">
                <div className="lbl" style={{ color: "var(--drop)" }}>Remisages</div>
                <div className="v">{fmtNum(st.lateShifts)}</div>
                <div className="s">sorties de {settings.dropHours[0] ?? "—"}h à {settings.dropHours[settings.dropHours.length - 1] ?? "—"}h</div>
              </div>
              <div className="tile">
                <div className="lbl">Avec une fonction</div>
                <div className="v">{pct(st.withFunction, st.planningAgents)} <small>%</small></div>
                <Meter value={pct(st.withFunction, st.planningAgents)} />
              </div>
              <div className="tile">
                <div className="lbl">Avec un axe</div>
                <div className="v">{pct(st.withAxe, st.planningAgents)} <small>%</small></div>
                <Meter value={pct(st.withAxe, st.planningAgents)} />
              </div>
            </div>
          )}
          {st && st.withAxe < st.planningAgents && (
            <div className={"callout " + (st.withAxe < st.planningAgents * 0.8 ? "warn" : "info")}>
              <IconAlert size={16} />
              <span>
                <b>{fmtNum(st.planningAgents - st.withAxe)} agents n'ont pas d'axe</b> (commune absente ou inconnue). Ils seront figés, et leur véhicule ne pourra pas être fermé. Compléter leurs communes augmente directement le gain.
              </span>
            </div>
          )}
          {st && st.withFunction < st.planningAgents && (
            <div className="callout warn">
              <IconAlert size={16} />
              <span><b>{fmtNum(st.planningAgents - st.withFunction)} agents n'ont pas de fonction</b> : ils seront figés. Ajoutez la liste Personnes-par-fonction.</span>
            </div>
          )}
        </div>

        <FormatGuide open={!hasInput} />

        <div className="card" ref={settingsRef}>
          <div className="card-head">
            <div className="title">
              <span className="num">2</span>
              <div>
                <h2>Réglages</h2>
                <p>Les valeurs par défaut suivent les directives v2. Ne les modifiez que si l'organisation change.</p>
              </div>
            </div>
            <button className="btn ghost small" onClick={() => setSettings(DEFAULT_SETTINGS)}>Rétablir les valeurs par défaut</button>
          </div>
          <SettingsPanel settings={settings} onChange={setSettings} />
          {error && (
            <div className="callout err">
              <IconAlert size={16} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div ref={resultRef} style={{ scrollMarginTop: 80 }}>{result && <Results r={result} stale={stale} />}</div>
      </main>

      <div className="actionbar">
        <div className="wrap">
          <div className={"status " + statusCls}>
            <span className="dot" />
            <span className="txt">{statusTxt}</span>
          </div>
          {!hasInput && (
            <a className="btn ghost" href="#guide"><IconBook size={16} />Format des fichiers</a>
          )}
          <button className="btn primary big" disabled={!ready || running} onClick={run}>
            {running ? <><span className="spinner" />Optimisation…</> : result && !stale ? <><IconSparkles size={17} />Relancer</> : <><IconSparkles size={17} />Optimiser</>}
          </button>
        </div>
      </div>
    </>
  );
}
