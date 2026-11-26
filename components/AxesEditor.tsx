"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { AXE_COLS, AXE_COL_HEADER, GEO_STATUS_LABEL, defaultConfig, type AxeCol, type AxesDoc, type AxesSettings, type MapPoint } from "@/lib/axes-map";
import type { AxesVersion } from "@/lib/server/axis-tables";
import { SITES, type SiteId } from "@/lib/sites";
import { norm } from "@/lib/util";
import { IconAlert, IconCheck, IconDownload, IconFile, IconHistory, IconMap, IconSearch, IconSparkles, IconUpload, IconX } from "./Icons";
import { axeColor } from "./axes-colors";

const AxesMap = dynamic(() => import("./AxesMap"), { ssr: false, loading: () => <div className="axes-map loading"><span className="spinner dark" /> Chargement de la carte…</div> });

type Assign = Record<AxeCol, number[]>;
type ColUse = Record<AxeCol, { waves: string[]; direction: "ramassage" | "remisage" }>;
type Tab = "prepare" | "axes" | "points" | "save";
type Filter = "all" | "outside" | "unplaced";

interface Props {
  site: SiteId;
  colUse: ColUse;
  initialDoc: AxesDoc | null;
  versions: AxesVersion[];
  services: { routing: boolean; roads: boolean; geocoding: boolean };
  tileUrl: string;
  tileAttribution: string;
}

const fmtMin = (m: number) => `${Math.round(m)} min`;
const fmtDate = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;

function assignFrom(doc: AxesDoc | null, n: number): Assign {
  const out: Assign = { "23h": Array(n).fill(-1), "21h": Array(n).fill(-1) };
  if (!doc) return out;
  for (const col of AXE_COLS) doc.plans[col]?.axes.forEach((a, k) => a.stops.forEach((s) => s < n && (out[col][s] = k)));
  return out;
}

function defaultSettings(site: SiteId): AxesSettings {
  return { site: { ...SITES[site].coords }, traffic: 1.3, configs: { "23h": defaultConfig(5), "21h": defaultConfig(5) } };
}

const SOURCE: Record<AxesDoc["source"], { label: string; cls: string; help: string }> = {
  osrm: { label: "Routes réelles · serveur OSRM", cls: "ok", help: "Durées et tracés calculés sur le réseau routier OpenStreetMap par le serveur d'itinéraires." },
  routes: { label: "Routes réelles · OpenStreetMap", cls: "ok", help: "Durées et tracés calculés sur le réseau routier OpenStreetMap d'Antananarivo (graphe local, sans Docker)." },
  estimation: { label: "Estimation à vol d'oiseau", cls: "warn", help: "Aucun réseau routier installé : lignes droites, durées estimées (× 1,4, 22 km/h). Lancez « make map-routes »." },
};

export default function AxesEditor({ site, colUse, initialDoc, versions, services, tileUrl, tileAttribution }: Props) {
  const router = useRouter();
  const [points, setPoints] = useState<MapPoint[]>(initialDoc?.points ?? []);
  const [settings, setSettings] = useState<AxesSettings>(initialDoc?.settings ?? defaultSettings(site));
  const [doc, setDoc] = useState<AxesDoc | null>(initialDoc);
  const [assign, setAssign] = useState<Assign>(assignFrom(initialDoc, initialDoc?.points.length ?? 0));
  const [dirty, setDirty] = useState(false); // corrections (affectation, positions, réglages) non recalculées
  const [savedClean, setSavedClean] = useState(!!initialDoc); // affiché = version enregistrée
  const [col, setCol] = useState<AxeCol>("21h");
  const [tab, setTab] = useState<Tab>(initialDoc ? "axes" : "prepare");
  const [selected, setSelected] = useState<number | null>(null);
  const [placing, setPlacing] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sources, setSources] = useState<{ file: string; sheet: string; rows: number }[]>([]);
  const [comment, setComment] = useState("");
  const [fitKey, setFitKey] = useState("init");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const placed = points.filter((p) => p.lat !== null).length;
  const unplacedIdx = points.map((p, i) => (p.lat === null ? i : -1)).filter((i) => i >= 0);
  const plan = doc?.plans[col] ?? null;
  const cfg = settings.configs[col];
  const source = doc?.source ?? (services.routing ? "osrm" : services.roads ? "routes" : "estimation");

  // détail de chaque point dans le découpage affiché : axe, rang, temps, détour
  const pointInfo = useMemo(() => {
    const m = new Map<number, { axe: number; pos: number; time: number; detour: number; over: boolean }>();
    plan?.axes.forEach((a, k) => a.stops.forEach((s, pos) => m.set(s, { axe: k, pos, time: a.times[pos], detour: a.detours[pos], over: a.overDetour[pos] })));
    return m;
  }, [plan]);
  const outsideReason = useMemo(() => new Map((plan?.outside ?? []).map((o) => [o.index, o.reason])), [plan]);

  const touch = () => {
    setDirty(true);
    setSavedClean(false);
    setInfo(null);
  };
  const setCfg = (c: AxeCol, patch: Partial<AxesSettings["configs"][AxeCol]>) => {
    setSettings((s) => ({ ...s, configs: { ...s.configs, [c]: { ...s.configs[c], ...patch } } }));
    touch();
  };

  async function call<T>(label: string, f: () => Promise<Response>): Promise<T | null> {
    setBusy(label);
    setError(null);
    try {
      const r = await f();
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Erreur");
      return j as T;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function upload(list: FileList | File[] | null) {
    const files = Array.from(list ?? []).filter((f) => /\.(xlsx|xlsm|xls)$/i.test(f.name));
    if (!files.length) {
      setError("Déposez un fichier Excel (.xlsx).");
      return;
    }
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    const j = await call<{ points: MapPoint[]; sources: typeof sources; warnings: string[] }>("Lecture des adresses et placement des quartiers…", () => fetch(`/api/axes/${site}/points`, { method: "POST", body: fd }));
    if (!j) return;
    setPoints(j.points);
    setSources(j.sources);
    setDoc(null);
    setAssign(assignFrom(null, j.points.length));
    setSelected(null);
    setFocus(null);
    setHidden(new Set());
    setDirty(true);
    setSavedClean(false);
    setFitKey(String(Date.now()));
    if (j.warnings.length) setError(j.warnings.join(" "));
    else setInfo(`${plural(j.points.length, "quartier")} lus, ${j.points.filter((p) => p.lat !== null).length} placés sur la carte.`);
  }

  async function compute(keepAssignment: boolean) {
    const body = { settings, points, fixed: keepAssignment ? assign : undefined };
    const d = await call<AxesDoc>(keepAssignment ? "Réévaluation des axes…" : "Calcul des axes sur les routes…", () =>
      fetch(`/api/axes/${site}/compute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    );
    if (!d) return;
    setDoc(d);
    setAssign(assignFrom(d, points.length));
    setDirty(false);
    setFocus(null);
    setTab("axes");
    setInfo(keepAssignment ? "Corrections réévaluées : ordre des arrêts, durées et contrôles mis à jour." : "Axes calculés. Vérifiez-les sur la carte, corrigez si besoin, puis enregistrez.");
  }

  async function save() {
    const j = await call<{ id: number; doc: AxesDoc }>("Enregistrement…", () =>
      fetch(`/api/axes/${site}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings, points, assignment: assign, comment }) })
    );
    if (!j) return;
    setDoc(j.doc);
    setAssign(assignFrom(j.doc, points.length));
    setDirty(false);
    setSavedClean(true);
    setComment("");
    setInfo(`Table d'axes enregistrée (n° ${j.id}) : elle sert aux prochaines optimisations ${SITES[site].name} sans fichier d'axes.`);
    router.refresh();
  }

  async function activate(id: number) {
    const ok = await call<{ ok: boolean }>("Activation…", () => fetch(`/api/axes/${site}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }));
    if (ok) window.location.reload();
  }

  const onSiteMove = useCallback((p: { lat: number; lon: number }) => {
    setSettings((s) => ({ ...s, site: p }));
    setDirty(true);
    setSavedClean(false);
  }, []);
  const onMapClick = useCallback(
    (p: { lat: number; lon: number }) => {
      if (placing && selected !== null) {
        setPoints((pts) => pts.map((x, i) => (i === selected ? { ...x, lat: p.lat, lon: p.lon, status: "manual" } : x)));
        setPlacing(false);
        setDirty(true);
        setSavedClean(false);
        // enchaîner : quartier suivant à placer
        const next = points.findIndex((x, i) => i !== selected && x.lat === null);
        if (next >= 0) {
          setSelected(next);
          setPlacing(true);
        }
      } else {
        setSelected(null);
        setFocus(null);
      }
    },
    [placing, selected, points]
  );
  const onPointClick = useCallback((i: number) => {
    setSelected(i);
    setPlacing(false);
  }, []);

  const setAxeOf = (c: AxeCol, i: number, axe: number) => {
    setAssign((a) => ({ ...a, [c]: a[c].map((v, j) => (j === i ? axe : v)) }));
    touch();
  };
  const toggleHidden = (k: number) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const mapAxes = (plan?.axes ?? []).map((a, k) => ({ index: k, geometry: dirty ? [] : a.geometry, stops: a.stops }));
  const sel = selected !== null ? points[selected] : null;
  const outsideIdx = points.map((_, i) => i).filter((i) => (assign[col][i] ?? -1) < 0 && points[i].lat !== null);
  const outsideAgents = outsideIdx.reduce((s, i) => s + points[i].agents, 0);
  const totalAgents = points.reduce((s, p) => s + p.agents, 0);
  const violations = (plan?.axes ?? []).reduce((s, a) => s + (a.overDuration ? 1 : 0) + a.overDetour.filter(Boolean).length, 0);
  const maxDur = Math.max(0, ...(plan?.axes ?? []).map((a) => a.total));
  const canSave = !!doc && !busy && !dirty && points.length > 0 && AXE_COLS.every((c) => assign[c].length === points.length);
  const axeChoices = Math.max(cfg.vehicles, plan?.axes.length ?? 0);

  const steps = [
    { label: "Quartiers", done: points.length > 0, hint: points.length ? `${placed}/${points.length} placés` : "déposer un fichier" },
    { label: "Contraintes", done: !!doc || (points.length > 0 && tab !== "prepare"), hint: `${cfg.vehicles} chauffeurs · ${cfg.maxDurationMin} min` },
    { label: "Axes", done: !!doc && !dirty, hint: doc ? (dirty ? "à réévaluer" : `${plural(plan?.axes.filter((a) => a.stops.length).length ?? 0, "axe")}`) : "à calculer" },
    { label: "Enregistré", done: savedClean, hint: savedClean ? "table active" : "non enregistré" },
  ];

  // « Matin / Soir » quand les deux colonnes ont des sens différents (SIRIUS), sinon le nom de la colonne (Connecteo)
  const sameDir = colUse["23h"].direction === colUse["21h"].direction;
  const colName = (c: AxeCol) => (sameDir ? AXE_COL_HEADER[c] : colUse[c].direction === "ramassage" ? "Matin" : "Soir");

  const nq = norm(q);
  const rows = points
    .map((p, i) => ({ p, i, a: assign[col][i] ?? -1 }))
    .filter((r) => (filter === "all" ? true : filter === "unplaced" ? r.p.lat === null : r.p.lat !== null && r.a < 0))
    .filter((r) => !nq || norm(r.p.key).includes(nq) || norm(r.p.place ?? "").includes(nq))
    .sort((x, y) => (x.a < 0 ? 1e9 : x.a) - (y.a < 0 ? 1e9 : y.a) || (pointInfo.get(x.i)?.pos ?? 0) - (pointInfo.get(y.i)?.pos ?? 0) || x.p.key.localeCompare(y.p.key, "fr"));

  return (
    <div className="ax">
      {/* ---------------- barre d'étapes + actions principales ---------------- */}
      <div className="ax-top card">
        <ol className="ax-steps">
          {steps.map((s, i) => (
            <li key={s.label} className={s.done ? "done" : ""}>
              <span className="n">{s.done ? <IconCheck size={12} /> : i + 1}</span>
              <span><b>{s.label}</b><small>{s.hint}</small></span>
            </li>
          ))}
        </ol>
        <div className="ax-actions">
          <span className={"ax-source " + SOURCE[source].cls} title={SOURCE[source].help}>
            <i />{SOURCE[source].label}
          </span>
          <button className="btn" disabled={!!busy || !doc || !dirty} onClick={() => compute(true)} title="Garde vos affectations et recalcule l'ordre des arrêts, les durées et les contrôles">Réévaluer</button>
          <button className="btn primary" disabled={!!busy || placed === 0} onClick={() => compute(false)}><IconSparkles size={15} />{doc ? "Recalculer" : "Calculer les axes"}</button>
        </div>
      </div>

      {error && <div className="callout err"><IconAlert size={16} /><span>{error}</span><button className="x" onClick={() => setError(null)} aria-label="Fermer"><IconX size={14} /></button></div>}
      {info && !error && <div className="callout ok"><IconCheck size={16} /><span>{info}</span><button className="x" onClick={() => setInfo(null)} aria-label="Fermer"><IconX size={14} /></button></div>}

      <div className="ax-body">
        {/* ---------------- panneau de gauche ---------------- */}
        <aside className="ax-panel card">
          <nav className="ax-tabs" role="tablist">
            {([
              ["prepare", "Préparer"],
              ["axes", "Axes"],
              ["points", "Quartiers"],
              ["save", "Enregistrer"],
            ] as [Tab, string][]).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
                {label}
                {id === "points" && unplacedIdx.length > 0 && <span className="pill warn">{unplacedIdx.length}</span>}
                {id === "axes" && doc && dirty && <span className="pill warn">!</span>}
              </button>
            ))}
          </nav>

          {tab === "prepare" && (
            <div className="ax-pane">
              <section>
                <h3>1. Quartiers et adresses</h3>
                <div
                  className={"ax-drop" + (over ? " over" : "")}
                  onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
                  onClick={() => inputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                >
                  <IconUpload size={20} />
                  <b>Déposez la liste des agents ou des communes</b>
                  <small>Quartier, Commune, Point de remisage… ou Latitude / Longitude. Le planning {SITES[site].name} convient tel quel.</small>
                </div>
                <input ref={inputRef} type="file" accept=".xlsx,.xlsm" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
                {sources.length > 0 && <p className="muted small"><IconFile size={12} /> {sources.map((s) => `${s.file} › ${s.sheet} (${s.rows} lignes)`).join(" · ")}</p>}
                {points.length > 0 && (
                  <div className="ax-progress">
                    <div className="bar"><i style={{ width: `${(100 * placed) / points.length}%` }} /></div>
                    <span><b>{placed}</b> / {plural(points.length, "quartier")} placés · {plural(totalAgents, "agent")}</span>
                    {unplacedIdx.length > 0 && (
                      <button className="btn small" onClick={() => { setSelected(unplacedIdx[0]); setPlacing(true); }}><IconMap size={13} />Placer les {unplacedIdx.length} restants</button>
                    )}
                  </div>
                )}
              </section>

              <section>
                <h3>2. Contraintes · « {AXE_COL_HEADER[col]} »</h3>
                <p className="muted small">
                  {colUse[col].waves.length ? colUse[col].waves.join(", ") : "aucune vague"} — trajet {colUse[col].direction === "ramassage" ? "des quartiers vers le site" : "du site vers les quartiers"}. Changez de découpage avec le sélecteur en haut à gauche de la carte.
                </p>
                <div className="ax-form">
                  <label>Chauffeurs<input type="number" min={1} max={40} value={cfg.vehicles} onChange={(e) => setCfg(col, { vehicles: Number(e.target.value) || 1 })} /></label>
                  <label>Durée max d'un axe<span className="unit"><input type="number" min={5} max={240} value={cfg.maxDurationMin} onChange={(e) => setCfg(col, { maxDurationMin: Number(e.target.value) || 5 })} />min</span></label>
                  <label>Détour max par arrêt<span className="unit"><input type="number" min={0} max={120} value={cfg.maxDetourMin} onChange={(e) => setCfg(col, { maxDetourMin: Number(e.target.value) || 0 })} />min</span></label>
                  <label title="Les durées des routes sont « route libre » : 1,3 = 30 % de plus pour les embouteillages">Trafic<span className="unit"><input type="number" min={0.5} max={3} step={0.1} value={settings.traffic} onChange={(e) => { setSettings({ ...settings, traffic: Number(e.target.value) || 1 }); touch(); }} />×</span></label>
                </div>
                <label className="ax-drivers">
                  Noms des chauffeurs <small>(un par ligne, dans l'ordre des axes)</small>
                  <textarea rows={3} value={cfg.drivers.join("\n")} placeholder={"Mr Rivo 1001TAA\nMr Haja 1002TAA"} onChange={(e) => setCfg(col, { drivers: e.target.value.split("\n") })} />
                </label>
                <p className="muted small">Le marqueur noir du site se déplace à la souris s'il est mal placé.</p>
              </section>
              <button className="btn primary block" disabled={!!busy || placed === 0} onClick={() => compute(false)}><IconSparkles size={15} />Calculer les axes</button>
            </div>
          )}

          {tab === "axes" && (
            <div className="ax-pane">
              {!plan ? (
                <div className="ax-empty"><IconSparkles size={22} /><p>Aucun axe calculé. Déposez les quartiers puis lancez le calcul.</p><button className="btn small" onClick={() => setTab("prepare")}>Préparer</button></div>
              ) : (
                <>
                  {dirty && <div className="callout warn small"><IconAlert size={14} /><span>Modifications non recalculées : cliquez sur « Réévaluer » avant d'enregistrer.</span></div>}
                  <p className="muted small">Cliquez sur un axe pour le voir seul, avec ses arrêts numérotés. Les durées sont limitées à {cfg.maxDurationMin} min.</p>
                  <ul className="ax-axes">
                    {plan.axes.map((a, k) => {
                      const agents = a.stops.reduce((s, i) => s + (points[i]?.agents ?? 0), 0);
                      const on = focus === k;
                      return (
                        <li key={k} className={(on ? "on " : "") + (hidden.has(k) ? "off" : "")}>
                          <button className="ax-axe" onClick={() => setFocus(on ? null : k)}>
                            <i style={{ background: axeColor(k) }} />
                            <span className="nm">
                              <b>{a.name}</b>{a.driver ? <span className="drv"> · {a.driver}</span> : null}
                              <small>{plural(a.stops.length, "arrêt")} · {plural(agents, "agent")} · {a.km.toFixed(1)} km</small>
                            </span>
                            <span className={"dur" + (a.overDuration ? " bad" : "")}>{fmtMin(a.total)}</span>
                          </button>
                          <div className="meter thin"><i style={{ width: `${Math.min(100, (100 * a.total) / Math.max(1, cfg.maxDurationMin))}%`, background: a.overDuration ? "var(--danger)" : axeColor(k) }} /></div>
                          {on && (
                            <ol className="ax-stops">
                              {a.stops.map((s, pos) => (
                                <li key={s} onClick={() => setSelected(s)} className={selected === s ? "sel" : ""}>
                                  <span className="num" style={{ background: axeColor(k) }}>{pos + 1}</span>
                                  <span className="nm">{points[s]?.key}</span>
                                  <span className="muted">{fmtMin(a.times[pos])}{a.overDetour[pos] ? " · détour !" : ""}</span>
                                </li>
                              ))}
                            </ol>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {outsideIdx.length > 0 && (
                    <button className="ax-outside" onClick={() => { setTab("points"); setFilter("outside"); }}>
                      <IconAlert size={14} /> {plural(outsideIdx.length, "quartier")} hors axe ({plural(outsideAgents, "agent")}) : à affecter à la main, ou ajoutez un chauffeur / des minutes.
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {tab === "points" && (
            <div className="ax-pane">
              <div className="ax-filter">
                <div className="search grow"><IconSearch size={14} /><input type="search" placeholder="Chercher un quartier…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
                <div className="seg small">
                  {([
                    ["all", `Tous ${points.length}`],
                    ["outside", `Hors axe ${outsideIdx.length}`],
                    ["unplaced", `À placer ${unplacedIdx.length}`],
                  ] as [Filter, string][]).map(([id, label]) => (
                    <button key={id} className={filter === id ? "on" : ""} onClick={() => setFilter(id)}>{label}</button>
                  ))}
                </div>
              </div>
              <ul className="ax-points">
                {rows.map(({ p, i, a }) => (
                  <li key={i} className={selected === i ? "sel" : ""} onClick={() => { setSelected(i); setPlacing(p.lat === null); }}>
                    <i className="dot" style={{ background: p.lat === null ? "transparent" : axeColor(a), borderColor: axeColor(a) }} />
                    <span className="nm">
                      <b>{p.key}</b>
                      <small className={p.lat === null ? "warn-text" : ""}>{p.lat === null ? "à placer sur la carte" : p.place ?? GEO_STATUS_LABEL[p.status]}</small>
                    </span>
                    <span className="ag">{p.agents || "—"}</span>
                    <select className="select small" value={a} onClick={(e) => e.stopPropagation()} onChange={(e) => setAxeOf(col, i, Number(e.target.value))} disabled={!doc} aria-label={`Axe de ${p.key}`}>
                      <option value={-1}>hors axe</option>
                      {Array.from({ length: axeChoices }, (_, k) => <option key={k} value={k}>Axe {k + 1}</option>)}
                    </select>
                  </li>
                ))}
                {!rows.length && <li className="muted small">Aucun quartier.</li>}
              </ul>
            </div>
          )}

          {tab === "save" && (
            <div className="ax-pane">
              <section>
                <h3>Enregistrer la table d'axes</h3>
                <p className="muted small">Elle devient la table du site {SITES[site].name} : l'optimisation l'utilise quand aucun fichier d'axes n'est déposé. Les deux découpages (matin et soir) sont enregistrés ensemble.</p>
                {doc && unplacedIdx.length + outsideIdx.length > 0 && (
                  <div className="callout warn small"><IconAlert size={14} /><span>{plural(unplacedIdx.length + outsideIdx.length, "quartier")} sans axe sur « {AXE_COL_HEADER[col]} » : leurs agents seront figés (non échangés) dans l'optimisation.</span></div>
                )}
                <input className="input" placeholder="Commentaire (facultatif)" value={comment} onChange={(e) => setComment(e.target.value)} />
                <div className="row-actions">
                  <button className="btn primary" disabled={!canSave} onClick={save} title={dirty ? "Réévaluez d'abord vos modifications" : undefined}><IconCheck size={15} />Enregistrer</button>
                  {(versions.some((v) => v.active) || savedClean) && <a className="btn" href={`/api/axes/${site}/export`}><IconDownload size={15} />Excel</a>}
                </div>
              </section>
              {versions.length > 0 && (
                <section>
                  <h3><IconHistory size={14} /> Versions</h3>
                  <ul className="ax-versions">
                    {versions.map((v) => (
                      <li key={v.id}>
                        <span className="nm">
                          <b>{fmtDate(v.createdAt)}</b>
                          <small>{v.userName ?? "—"} · {plural(v.points, "quartier")} · {plural(v.axes, "axe")}{v.comment ? ` · ${v.comment}` : ""}</small>
                        </span>
                        {v.active ? <span className="badge ok">active</span> : <button className="btn small ghost" onClick={() => activate(v.id)} disabled={!!busy}>Réactiver</button>}
                        <a className="btn small ghost" href={`/api/axes/${site}/export?id=${v.id}`} title="Télécharger cette version" aria-label="Télécharger cette version"><IconDownload size={13} /></a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </aside>

        {/* ---------------- carte ---------------- */}
        <div className="ax-mapwrap">
          <AxesMap
            tileUrl={tileUrl}
            tileAttribution={tileAttribution}
            site={settings.site}
            siteName={`${SITES[site].name} · ${SITES[site].place}`}
            points={points}
            axeOf={assign[col]}
            axes={mapAxes}
            focus={focus}
            hidden={hidden}
            roads={source !== "estimation"}
            selected={selected}
            placing={placing}
            onSiteMove={onSiteMove}
            onPointClick={onPointClick}
            onMapClick={onMapClick}
            fitKey={fitKey}
          />

          {/* découpage affiché */}
          <div className="ax-ov tl seg">
            {AXE_COLS.map((c) => (
              <button key={c} className={col === c ? "on" : ""} onClick={() => { setCol(c); setFocus(null); setHidden(new Set()); }} title={colUse[c].waves.join(", ")}>
                {colName(c)} {!sameDir && <small>« {AXE_COL_HEADER[c]} »</small>}
              </button>
            ))}
          </div>

          {/* légende : un clic isole l'axe, la case le masque */}
          {plan && plan.axes.length > 0 && (
            <div className="ax-ov tr ax-legend">
              {plan.axes.map((a, k) => (
                <div key={k} className={"row" + (focus === k ? " on" : "") + (hidden.has(k) ? " off" : "")}>
                  <input type="checkbox" checked={!hidden.has(k)} onChange={() => toggleHidden(k)} aria-label={`Afficher ${a.name}`} />
                  <button onClick={() => setFocus(focus === k ? null : k)}>
                    <i style={{ background: axeColor(k) }} />
                    {a.name}
                    <span className={a.overDuration ? "bad" : ""}>{fmtMin(a.total)}</span>
                  </button>
                </div>
              ))}
              <div className="row legend-foot">
                <i className="dot-out" /> hors axe
                <span className="line-key">{source === "estimation" ? "- - - estimation" : "—— routes"}</span>
              </div>
            </div>
          )}

          {/* indicateurs */}
          {points.length > 0 && (
            <div className="ax-ov bl ax-kpis">
              <span><b>{placed}</b>/{points.length} placés</span>
              {plan && <span className={outsideIdx.length ? "warn" : ""}><b>{outsideIdx.length}</b> hors axe</span>}
              {plan && <span><b>{fmtMin(maxDur)}</b> axe le plus long</span>}
              {plan && <span className={violations ? "bad" : "ok"}>{violations ? `${violations} dépassement(s)` : "contraintes respectées"}</span>}
            </div>
          )}

          <button className="ax-ov br2 btn small" onClick={() => setFitKey(String(Date.now()))} title="Recadrer sur tous les quartiers"><IconMap size={13} />Recentrer</button>

          {placing && sel && <div className="ax-ov tc map-hint">Cliquez sur la carte pour placer <b>{sel.key}</b>{sel.hints[0] ? <> (adresse citée : {sel.hints[0]})</> : null} · <button className="linklike" onClick={() => setPlacing(false)}>arrêter</button></div>}
          {busy && <div className="ax-ov tc map-hint"><span className="spinner dark" /> {busy}</div>}

          {/* fiche du quartier sélectionné */}
          {sel && selected !== null && !placing && (
            <div className="ax-ov bc ax-card">
              <div className="head">
                <b>{sel.key}</b>
                <button className="x" onClick={() => setSelected(null)} aria-label="Fermer"><IconX size={14} /></button>
              </div>
              <p className="muted small">
                {plural(sel.agents, "agent")} · {sel.place ? `reconnu : ${sel.place}` : GEO_STATUS_LABEL[sel.status]}
                {sel.hints.length ? ` · adresses : ${sel.hints.join(" ; ")}` : ""}
              </p>
              {pointInfo.get(selected) && !dirty && (
                <p className="small">Arrêt n° {pointInfo.get(selected)!.pos + 1} de l'Axe {pointInfo.get(selected)!.axe + 1} · {fmtMin(pointInfo.get(selected)!.time)} de trajet · détour imposé {fmtMin(pointInfo.get(selected)!.detour)}{pointInfo.get(selected)!.over ? " (au-delà du maximum)" : ""}</p>
              )}
              {outsideReason.get(selected) && <p className="small warn-text">Hors axe : {outsideReason.get(selected)}</p>}
              <div className="row-actions">
                <button className="btn small" onClick={() => setPlacing(true)}><IconMap size={13} />{sel.lat === null ? "Placer" : "Déplacer"}</button>
                {AXE_COLS.map((c) => (
                  <label key={c} className="inline-select">
                    {colName(c)}
                    <select className="select small" value={assign[c][selected] ?? -1} onChange={(e) => setAxeOf(c, selected, Number(e.target.value))} disabled={!doc}>
                      <option value={-1}>hors axe</option>
                      {Array.from({ length: Math.max(settings.configs[c].vehicles, doc?.plans[c]?.axes.length ?? 0) }, (_, k) => <option key={k} value={k}>Axe {k + 1}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
