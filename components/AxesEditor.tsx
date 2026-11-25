"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { AXE_COLS, AXE_COL_HEADER, GEO_STATUS_LABEL, defaultConfig, type AxeCol, type AxesDoc, type AxesSettings, type MapPoint } from "@/lib/axes-map";
import type { AxesVersion } from "@/lib/server/axis-tables";
import { SITES, type SiteId } from "@/lib/sites";
import { IconAlert, IconCheck, IconDownload, IconFile, IconMap, IconSparkles, IconUpload } from "./Icons";
import { axeColor } from "./axes-colors";

const AxesMap = dynamic(() => import("./AxesMap"), { ssr: false, loading: () => <div className="axes-map loading">Chargement de la carte…</div> });

type Assign = Record<AxeCol, number[]>;
type ColUse = Record<AxeCol, { waves: string[]; direction: "ramassage" | "remisage" }>;

interface Props {
  site: SiteId;
  colUse: ColUse;
  initialDoc: AxesDoc | null;
  versions: AxesVersion[];
  services: { routing: boolean; geocoding: boolean };
  tileUrl: string;
  tileAttribution: string;
}

const fmtMin = (m: number) => `${Math.round(m)} min`;
const fmtDate = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function assignFrom(doc: AxesDoc | null, n: number): Assign {
  const out: Assign = { "23h": Array(n).fill(-1), "21h": Array(n).fill(-1) };
  if (!doc) return out;
  for (const col of AXE_COLS) doc.plans[col]?.axes.forEach((a, k) => a.stops.forEach((s) => s < n && (out[col][s] = k)));
  return out;
}

function defaultSettings(site: SiteId): AxesSettings {
  return { site: { ...SITES[site].coords }, traffic: 1.3, configs: { "23h": defaultConfig(5), "21h": defaultConfig(5) } };
}

export default function AxesEditor({ site, colUse, initialDoc, versions, services, tileUrl, tileAttribution }: Props) {
  const router = useRouter();
  const [points, setPoints] = useState<MapPoint[]>(initialDoc?.points ?? []);
  const [settings, setSettings] = useState<AxesSettings>(initialDoc?.settings ?? defaultSettings(site));
  const [doc, setDoc] = useState<AxesDoc | null>(initialDoc);
  const [assign, setAssign] = useState<Assign>(assignFrom(initialDoc, initialDoc?.points.length ?? 0));
  const [dirty, setDirty] = useState(false); // corrections (affectation, positions, réglages) non recalculées
  const [col, setCol] = useState<AxeCol>("21h");
  const [selected, setSelected] = useState<number | null>(null);
  const [placing, setPlacing] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sources, setSources] = useState<{ file: string; sheet: string; rows: number }[]>([]);
  const [comment, setComment] = useState("");
  const [fitKey, setFitKey] = useState("init");
  const [savedOnce, setSavedOnce] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const placed = points.filter((p) => p.lat !== null).length;
  const unplacedIdx = points.map((p, i) => (p.lat === null ? i : -1)).filter((i) => i >= 0);
  const plan = doc?.plans[col] ?? null;
  const cfg = settings.configs[col];

  // détail de chaque point dans le découpage affiché : axe, rang, temps, détour
  const pointInfo = useMemo(() => {
    const m = new Map<number, { axe: number; pos: number; time: number; detour: number; over: boolean }>();
    plan?.axes.forEach((a, k) => a.stops.forEach((s, pos) => m.set(s, { axe: k, pos, time: a.times[pos], detour: a.detours[pos], over: a.overDetour[pos] })));
    return m;
  }, [plan]);
  const outsideReason = useMemo(() => new Map((plan?.outside ?? []).map((o) => [o.index, o.reason])), [plan]);

  const touch = () => {
    setDirty(true);
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

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const fd = new FormData();
    Array.from(list).forEach((f) => fd.append("files", f, f.name));
    const j = await call<{ points: MapPoint[]; sources: typeof sources; warnings: string[] }>("Lecture et géocodage des adresses…", () => fetch(`/api/axes/${site}/points`, { method: "POST", body: fd }));
    if (!j) return;
    setPoints(j.points);
    setSources(j.sources);
    setDoc(null);
    setAssign(assignFrom(null, j.points.length));
    setSelected(null);
    setDirty(true);
    setFitKey(String(Date.now()));
    if (j.warnings.length) setError(j.warnings.join(" "));
    else setInfo(`${j.points.length} quartiers lus, ${j.points.filter((p) => p.lat !== null).length} placés sur la carte.`);
  }

  async function compute(keepAssignment: boolean) {
    const body = { settings, points, fixed: keepAssignment ? assign : undefined };
    const d = await call<AxesDoc>(keepAssignment ? "Réévaluation des axes…" : "Calcul des axes…", () =>
      fetch(`/api/axes/${site}/compute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    );
    if (!d) return;
    setDoc(d);
    setAssign(assignFrom(d, points.length));
    setDirty(false);
    setInfo(keepAssignment ? "Corrections réévaluées : durées et contrôles mis à jour." : "Axes calculés. Vérifiez-les sur la carte, corrigez si besoin, puis enregistrez.");
  }

  async function save() {
    const j = await call<{ id: number; doc: AxesDoc }>("Enregistrement…", () =>
      fetch(`/api/axes/${site}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings, points, assignment: assign, comment }) })
    );
    if (!j) return;
    setDoc(j.doc);
    setAssign(assignFrom(j.doc, points.length));
    setDirty(false);
    setComment("");
    setSavedOnce(true);
    setInfo(`Table d'axes enregistrée (n° ${j.id}) : elle est utilisée par les prochaines optimisations ${SITES[site].name} sans fichier d'axes.`);
    router.refresh();
  }

  async function activate(id: number) {
    const ok = await call<{ ok: boolean }>("Activation…", () => fetch(`/api/axes/${site}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }));
    if (ok) {
      setInfo("Version réactivée. Rechargement…");
      window.location.reload();
    }
  }

  const onSiteMove = useCallback((p: { lat: number; lon: number }) => {
    setSettings((s) => ({ ...s, site: p }));
    setDirty(true);
  }, []);
  const onMapClick = useCallback(
    (p: { lat: number; lon: number }) => {
      if (placing && selected !== null) {
        setPoints((pts) => pts.map((x, i) => (i === selected ? { ...x, lat: p.lat, lon: p.lon, status: "manual" } : x)));
        setPlacing(false);
        setDirty(true);
      } else setSelected(null);
    },
    [placing, selected]
  );
  const onPointClick = useCallback((i: number) => {
    setSelected(i);
    setPlacing(false);
  }, []);

  const setAxeOf = (c: AxeCol, i: number, axe: number) => {
    setAssign((a) => ({ ...a, [c]: a[c].map((v, j) => (j === i ? axe : v)) }));
    touch();
  };

  const mapAxes = (plan?.axes ?? []).map((a, k) => ({ index: k, geometry: dirty ? [] : a.geometry, highlighted: highlight === k }));
  const sel = selected !== null ? points[selected] : null;
  const nOutside = assign[col].filter((a, i) => a < 0 && points[i]).length;
  const violations = (plan?.axes ?? []).reduce((s, a) => s + (a.overDuration ? 1 : 0) + a.overDetour.filter(Boolean).length, 0);
  const canSave = !!doc && !busy && points.length > 0 && AXE_COLS.every((c) => assign[c].length === points.length);
  const axeChoices = Math.max(cfg.vehicles, plan?.axes.length ?? 0);

  return (
    <>
      {(!services.routing || !services.geocoding) && (
        <div className="callout info">
          <IconAlert size={16} />
          <span>
            {!services.routing && <><b>Serveur d'itinéraires non installé</b> : les durées sont <b>estimées à vol d'oiseau</b> (× 1,4, 22 km/h) et les tracés sont des lignes droites. </>}
            {!services.geocoding && <><b>Géocodage non installé</b> : les quartiers sont placés au centre de leur fokontany (répertoire officiel COD-AB, sans connexion) ; les autres se placent à la main, ou via des colonnes Latitude / Longitude. </>}
            Voir « make map-init » dans le README pour installer OpenStreetMap sur le serveur (aucune adresse ne sort du serveur).
          </span>
        </div>
      )}

      <div className="axes-layout">
        <div className="axes-side">
          <section className="card">
            <h2><IconUpload size={16} /> Communes et adresses</h2>
            <p className="muted small">
              Liste des agents (Quartier, Commune, Point de remisage…) ou liste de communes (Commune, Adresse, Latitude, Longitude). Les positions déjà enregistrées pour {SITES[site].name} sont reprises.
            </p>
            <div className="row-actions">
              <button className="btn primary" onClick={() => inputRef.current?.click()} disabled={!!busy}><IconFile size={15} />Déposer un fichier…</button>
              <input ref={inputRef} type="file" accept=".xlsx,.xlsm" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            </div>
            {sources.length > 0 && <p className="muted small">{sources.map((s) => `${s.file} › ${s.sheet} (${s.rows} lignes)`).join(" · ")}</p>}
            {points.length > 0 && (
              <ul className="kv">
                <li><span>Quartiers</span><b>{points.length}</b></li>
                <li><span>Placés sur la carte</span><b>{placed}</b></li>
                <li>
                  <span>À placer à la main</span>
                  <b>
                    {unplacedIdx.length}
                    {unplacedIdx.length > 0 && <button className="btn small ghost" style={{ marginLeft: 8 }} onClick={() => { setSelected(unplacedIdx[0]); setPlacing(true); }}>Placer le suivant</button>}
                  </b>
                </li>
              </ul>
            )}
          </section>

          <section className="card">
            <h2><IconSparkles size={16} /> Contraintes</h2>
            <div className="axes-tabs" role="tablist">
              {AXE_COLS.map((c) => (
                <button key={c} role="tab" aria-selected={col === c} className={"axes-tab" + (col === c ? " on" : "")} onClick={() => { setCol(c); setHighlight(null); }}>
                  <b>« {AXE_COL_HEADER[c]} »</b>
                  <small>{colUse[c].waves.length ? colUse[c].waves.join(", ") : "aucune vague"}</small>
                </button>
              ))}
            </div>
            <p className="muted small">Trajet optimisé dans le sens du <b>{colUse[col].direction}</b>{colUse[col].direction === "ramassage" ? " (des quartiers vers le site)" : " (du site vers les quartiers)"}.</p>
            <div className="axes-form">
              <label>Chauffeurs (axes)<input type="number" min={1} max={40} value={cfg.vehicles} onChange={(e) => setCfg(col, { vehicles: Number(e.target.value) || 1 })} /></label>
              <label>Durée max d'un axe<span className="unit"><input type="number" min={5} max={240} value={cfg.maxDurationMin} onChange={(e) => setCfg(col, { maxDurationMin: Number(e.target.value) || 5 })} />min</span></label>
              <label>Détour max par arrêt<span className="unit"><input type="number" min={0} max={120} value={cfg.maxDetourMin} onChange={(e) => setCfg(col, { maxDetourMin: Number(e.target.value) || 0 })} />min</span></label>
              <label>Coefficient de trafic<span className="unit"><input type="number" min={0.5} max={3} step={0.1} value={settings.traffic} onChange={(e) => { setSettings({ ...settings, traffic: Number(e.target.value) || 1 }); touch(); }} />×</span></label>
            </div>
            <label className="axes-drivers">
              Chauffeurs (un par ligne, dans l'ordre des axes)
              <textarea rows={3} value={cfg.drivers.join("\n")} placeholder={"Mr Rivo 1001TAA\nMr Haja 1002TAA"} onChange={(e) => setCfg(col, { drivers: e.target.value.split("\n") })} />
            </label>
            <p className="muted small">
              Durée max : du site au dernier arrêt. Détour : temps ajouté aux passagers encore à bord à cause d'un arrêt. Le marqueur du site se déplace sur la carte ({settings.site.lat.toFixed(4)}, {settings.site.lon.toFixed(4)}).
            </p>
            <div className="row-actions">
              <button className="btn primary" disabled={!!busy || placed === 0} onClick={() => compute(false)}><IconSparkles size={15} />Calculer les axes</button>
              <button className="btn" disabled={!!busy || !doc || !dirty} onClick={() => compute(true)} title="Garde vos affectations et recalcule durées, ordre des arrêts et contrôles">Réévaluer mes corrections</button>
            </div>
          </section>

          {plan && (
            <section className="card">
              <h2>Axes « {AXE_COL_HEADER[col]} »</h2>
              {dirty && <p className="callout warn small" style={{ margin: "6px 0" }}><IconAlert size={14} /><span>Modifications non recalculées : réévaluez avant d'enregistrer.</span></p>}
              <ul className="axes-list">
                {plan.axes.map((a, k) => {
                  const agents = a.stops.reduce((s, i) => s + (points[i]?.agents ?? 0), 0);
                  return (
                    <li key={k} className={highlight === k ? "on" : ""} onMouseEnter={() => setHighlight(k)} onMouseLeave={() => setHighlight(null)}>
                      <i style={{ background: axeColor(k) }} />
                      <span className="nm"><b>{a.name}</b>{a.driver ? ` · ${a.driver}` : ""}<small>{a.stops.length} arrêt{a.stops.length > 1 ? "s" : ""} · {agents} agent{agents > 1 ? "s" : ""} · {a.km.toFixed(1)} km</small></span>
                      <span className={"dur" + (a.overDuration ? " bad" : "")}>{fmtMin(a.total)}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="muted small">
                {nOutside} quartier{nOutside > 1 ? "s" : ""} hors axe{violations ? ` · ${violations} dépassement(s) de contrainte` : " · contraintes respectées"} · durées {doc?.source === "osrm" ? "OpenStreetMap" : "estimées"}.
              </p>
            </section>
          )}

          <section className="card">
            <h2><IconCheck size={16} /> Enregistrer</h2>
            <p className="muted small">La table enregistrée devient celle du site : l'optimisation l'utilise quand aucun fichier d'axes n'est déposé. Les deux découpages sont enregistrés ensemble.</p>
            <input className="input" placeholder="Commentaire (facultatif)" value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="row-actions">
              <button className="btn primary" disabled={!canSave} onClick={save}><IconCheck size={15} />Enregistrer la table d'axes</button>
              {(versions.some((v) => v.active) || savedOnce) && <a className="btn" href={`/api/axes/${site}/export`}><IconDownload size={15} />Excel</a>}
            </div>
            {versions.length > 0 && (
              <table className="t small" style={{ marginTop: 12 }}>
                <thead><tr><th>Version</th><th className="c">Quartiers</th><th className="c">Axes</th><th /></tr></thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id}>
                      <td>{fmtDate(v.createdAt)}{v.userName ? ` · ${v.userName}` : ""}{v.comment ? <div className="muted small">{v.comment}</div> : null}</td>
                      <td className="c">{v.points}</td>
                      <td className="c">{v.axes}</td>
                      <td className="c nowrap">
                        {v.active ? <span className="badge ok">active</span> : <button className="btn small ghost" onClick={() => activate(v.id)} disabled={!!busy}>Réactiver</button>}{" "}
                        <a className="btn small ghost" href={`/api/axes/${site}/export?id=${v.id}`} title="Télécharger cette version"><IconDownload size={13} /></a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <div className="axes-main">
          <div className="axes-mapwrap">
            <AxesMap
              tileUrl={tileUrl}
              tileAttribution={tileAttribution}
              site={settings.site}
              siteName={`${SITES[site].name} · ${SITES[site].place}`}
              points={points}
              axeOf={assign[col]}
              axes={mapAxes}
              selected={selected}
              placing={placing}
              onSiteMove={onSiteMove}
              onPointClick={onPointClick}
              onMapClick={onMapClick}
              fitKey={fitKey}
            />
            {placing && sel && <div className="map-hint">Cliquez sur la carte pour placer <b>{sel.key}</b> · <button className="linklike" onClick={() => setPlacing(false)}>annuler</button></div>}
            {busy && <div className="map-hint"><span className="spinner dark" /> {busy}</div>}
          </div>
          {error && <div className="callout err"><IconAlert size={16} /><span>{error}</span></div>}
          {info && !error && <div className="callout ok"><IconCheck size={16} /><span>{info}</span></div>}

          {sel && selected !== null && (
            <section className="card point-card">
              <div className="card-head" style={{ marginBottom: 6 }}>
                <h2>{sel.key}</h2>
                <button className="btn small ghost" onClick={() => setSelected(null)}>Fermer</button>
              </div>
              <p className="muted small">
                {sel.agents} agent{sel.agents > 1 ? "s" : ""} · position : {GEO_STATUS_LABEL[sel.status]}
                {sel.lat !== null ? ` (${sel.lat.toFixed(5)}, ${sel.lon!.toFixed(5)})` : ""}
                {sel.place ? ` · reconnu comme ${sel.place}` : ""}
                {sel.hints.length ? ` · adresses citées : ${sel.hints.join(" ; ")}` : ""}
              </p>
              <div className="row-actions">
                <button className="btn small" onClick={() => setPlacing(true)}><IconMap size={14} />{sel.lat === null ? "Placer sur la carte" : "Déplacer sur la carte"}</button>
                {AXE_COLS.map((c) => (
                  <label key={c} className="inline-select">
                    {AXE_COL_HEADER[c]} :
                    <select className="select" value={assign[c][selected] ?? -1} onChange={(e) => setAxeOf(c, selected, Number(e.target.value))} disabled={!doc}>
                      <option value={-1}>hors axe</option>
                      {Array.from({ length: Math.max(settings.configs[c].vehicles, doc?.plans[c]?.axes.length ?? 0) }, (_, k) => (
                        <option key={k} value={k}>Axe {k + 1}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {pointInfo.get(selected) && !dirty && (
                <p className="small">
                  Sur « {AXE_COL_HEADER[col]} » : arrêt n° {pointInfo.get(selected)!.pos + 1}, {fmtMin(pointInfo.get(selected)!.time)} de trajet, détour imposé {fmtMin(pointInfo.get(selected)!.detour)}
                  {pointInfo.get(selected)!.over ? " (au-delà du maximum)" : ""}.
                </p>
              )}
              {outsideReason.get(selected) && <p className="small" style={{ color: "var(--warn)" }}>Hors axe : {outsideReason.get(selected)}</p>}
            </section>
          )}

          {points.length > 0 && (
            <section className="card">
              <h2>Quartiers · « {AXE_COL_HEADER[col]} »</h2>
              <div className="tablewrap" style={{ maxHeight: 420 }}>
                <table className="t small">
                  <thead>
                    <tr><th>Quartier</th><th className="c">Agents</th><th>Position</th><th>Axe</th><th className="c">Trajet</th></tr>
                  </thead>
                  <tbody>
                    {points
                      .map((p, i) => ({ p, i, a: assign[col][i] ?? -1 }))
                      .sort((x, y) => (x.a < 0 ? 1e9 : x.a) - (y.a < 0 ? 1e9 : y.a) || (pointInfo.get(x.i)?.pos ?? 0) - (pointInfo.get(y.i)?.pos ?? 0) || x.p.key.localeCompare(y.p.key, "fr"))
                      .map(({ p, i, a }) => (
                        <tr key={i} className={selected === i ? "sel" : ""} onClick={() => { setSelected(i); setPlacing(p.lat === null); }} style={{ cursor: "pointer" }}>
                          <td><i className="dot" style={{ background: axeColor(a) }} /> {p.key}</td>
                          <td className="c">{p.agents || "—"}</td>
                          <td className={p.lat === null ? "warn-text" : "muted"}>{GEO_STATUS_LABEL[p.status]}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <select className="select small" value={a} onChange={(e) => setAxeOf(col, i, Number(e.target.value))} disabled={!doc}>
                              <option value={-1}>hors axe</option>
                              {Array.from({ length: axeChoices }, (_, k) => <option key={k} value={k}>Axe {k + 1}</option>)}
                            </select>
                          </td>
                          <td className="c">{!dirty && pointInfo.get(i) ? fmtMin(pointInfo.get(i)!.time) : "—"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
