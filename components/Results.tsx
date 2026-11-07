"use client";

import { useMemo, useState } from "react";
import type { Alert, Cell, Group, OptimizationResult, Settings, Swap } from "@/lib/types";
import { dayLabel, fmtShift, fmtTime } from "@/lib/util";
import { transportEvents, waveLabel } from "@/lib/waves";

type TabId = "synthese" | "echanges" | "planning" | "transport" | "alertes";

function Kpi({ label, before, after, unit, good, sub }: { label: string; before?: string | number; after: string | number; unit?: string; good?: boolean; sub?: string }) {
  return (
    <div className={"kpi" + (good ? " good" : "")}>
      <div className="lbl">{label}</div>
      <div className="val">
        {before !== undefined && (
          <>
            <span style={{ color: "var(--muted)", fontWeight: 600 }}>{before}</span>
            <span className="arrow">→</span>
          </>
        )}
        {after}
        {unit && <span style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)" }}> {unit}</span>}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Synthese({ r }: { r: OptimizationResult }) {
  const mb = r.metricsBefore;
  const ma = r.metricsAfter;
  const saved = mb.vehicles - ma.vehicles;
  const pct = mb.vehicles ? Math.round((saved / mb.vehicles) * 100) : 0;
  const max = Math.max(1, ...mb.perDay.map((d) => d.vehicles), ...ma.perDay.map((d) => d.vehicles));
  return (
    <>
      <div className="kpis">
        <Kpi label="Véhicules sur la semaine" before={mb.vehicles} after={ma.vehicles} good={saved > 0} sub={saved > 0 ? `−${saved} véhicules (−${pct} %)` : "Aucun gain trouvé"} />
        <Kpi label="Personnes par véhicule" before={mb.avgPerVehicle.toFixed(1)} after={ma.avgPerVehicle.toFixed(1)} sub={`${ma.transported} personnes transportées`} />
        <Kpi label="Ramassage / remisage" before={`${mb.pickupVehicles} / ${mb.dropVehicles}`} after={`${ma.pickupVehicles} / ${ma.dropVehicles}`} sub="véhicules de 6h / de 18h à 23h" />
        <Kpi label="Véhicules ≤ 4 personnes" before={mb.smallVehicles} after={ma.smallVehicles} sub="les moins rentables" />
        <Kpi
          label="Échanges proposés"
          after={r.swaps.length}
          sub={`${new Set(r.swaps.map((s) => s.planId)).size} véhicules fermés · ${r.swaps.filter((s) => s.kind === "off").length} échanges de jour OFF`}
        />
      </div>

      <h3 style={{ marginTop: 26 }}>Véhicules par jour</h3>
      <div className="legend">
        <span className="b">Avant</span>
        <span className="a">Après</span>
      </div>
      <div className="bars">
        {r.dates.map((d, i) => (
          <Row key={d} label={dayLabel(d)} b={mb.perDay[i].vehicles} a={ma.perDay[i].vehicles} max={max} />
        ))}
      </div>

      <h3 style={{ marginTop: 26 }}>Détail par jour</h3>
      <div className="tablewrap" style={{ marginTop: 8 }}>
        <table className="t">
          <thead>
            <tr>
              <th>Jour</th>
              <th className="c">Personnes</th>
              <th className="c">Véhicules avant</th>
              <th className="c">Véhicules après</th>
              <th className="c">Gain</th>
              <th className="c">Pers./véh. avant</th>
              <th className="c">Pers./véh. après</th>
            </tr>
          </thead>
          <tbody>
            {r.dates.map((d, i) => {
              const b = mb.perDay[i];
              const a = ma.perDay[i];
              return (
                <tr key={d}>
                  <td>{dayLabel(d)}</td>
                  <td className="c">{a.transported}</td>
                  <td className="c">{b.vehicles}</td>
                  <td className="c"><b>{a.vehicles}</b></td>
                  <td className="c">{b.vehicles - a.vehicles > 0 ? <span className="badge ok">−{b.vehicles - a.vehicles}</span> : <span className="muted">0</span>}</td>
                  <td className="c">{b.vehicles ? (b.transported / b.vehicles).toFixed(1) : "–"}</td>
                  <td className="c">{a.vehicles ? (a.transported / a.vehicles).toFixed(1) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="note">
        <b>Garanties :</b> chaque jour, les mêmes horaires sont couverts dans chaque fonction{r.settings.respectFunction ? " (échanges uniquement entre agents de même fonction)" : ""}. Chacun garde son nombre de jours OFF dans la semaine. Aucun repos inférieur à {r.settings.minRestHours} h n'est créé, et les agents figés ne bougent pas. « Axe 21h » est utilisé pour les vagues de {r.settings.axe21Waves.join("h, ") || "—"}h, « Axe 23h » pour les autres.
      </div>
    </>
  );
}

function Row({ label, b, a, max }: { label: string; b: number; a: number; max: number }) {
  return (
    <>
      <div className="day">{label}</div>
      <div className="barpair" style={{ paddingRight: 40 }}>
        <div className="bar before" style={{ width: `${(b / max) * 100}%` }}><i>{b}</i></div>
        <div className="bar after" style={{ width: `${(a / max) * 100}%` }}><i>{a}</i></div>
      </div>
    </>
  );
}

function Echanges({ r }: { r: OptimizationResult }) {
  const plans = useMemo(() => {
    const m = new Map<number, Swap[]>();
    for (const s of r.swaps) {
      if (!m.has(s.planId)) m.set(s.planId, []);
      m.get(s.planId)!.push(s);
    }
    return [...m.values()].sort((a, b) => a[0].dayIndex - b[0].dayIndex || a[0].planId - b[0].planId);
  }, [r]);
  if (plans.length === 0) return <div className="empty">Aucun échange n'a permis de réduire le nombre de véhicules avec ces réglages.</div>;
  return (
    <>
      {plans.map((p) => (
        <div className="plan" key={p[0].planId}>
          <header>
            <span>{dayLabel(p[0].date)}</span>
            <span>·</span>
            <span>{p[0].planSummary}</span>
            {p.some((s) => s.kind === "off") && <span className="badge warn">échange de jour OFF</span>}
            <span className="badge ok">−{p[0].vehiclesSaved} véhicule{p[0].vehiclesSaved > 1 ? "s" : ""}</span>
            <span className="badge">{p.length} échange{p.length > 1 ? "s" : ""}</span>
          </header>
          {p.map((s) => (
            <div className="swap" key={s.id}>
              <div className="who">
                <b>{s.a.nom}</b> <span className={"badge lvl-" + s.a.niveau}>{s.a.niveau.toLowerCase()}</span>
                <small>{s.a.matricule} · {s.a.fonction || "fonction ?"} · {s.a.commune} · {s.a.axe}</small>
                <div className="shift"><s>{s.a.before}</s> → <b>{s.a.after}</b></div>
              </div>
              <div className="mid">⇄</div>
              <div className="who">
                <b>{s.b.nom}</b> <span className={"badge lvl-" + s.b.niveau}>{s.b.niveau.toLowerCase()}</span>
                <small>{s.b.matricule} · {s.b.fonction || "fonction ?"} · {s.b.commune} · {s.b.axe}</small>
                <div className="shift"><s>{s.b.before}</s> → <b>{s.b.after}</b></div>
              </div>
              <div className="why">{s.reason}</div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function cellClass(c: Cell, changed: boolean, settings: Settings): string {
  let cls = "";
  if (changed) cls += " chg";
  if (c.k === "off") cls += " off";
  if (c.k === "leave") cls += " leave";
  if (transportEvents(c, settings).length) cls += " late";
  return cls;
}

function PlanningView({ r }: { r: OptimizationResult }) {
  const [onlyChanged, setOnlyChanged] = useState(true);
  const rows = r.agents.map((a, i) => ({ a, i })).filter(({ i }) => !onlyChanged || r.changed[i].some(Boolean));
  const nChanged = r.changed.reduce((s, row) => s + row.filter(Boolean).length, 0);
  return (
    <>
      <div className="toolbar">
        <label className="check">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
          <span>Seulement les agents modifiés ({r.changed.filter((row) => row.some(Boolean)).length} agents, {nChanged} cases)</span>
        </label>
        <span className="muted" style={{ fontSize: 13 }}>Jaune = case modifiée (ancien shift barré). Trait vert = shift avec transport.</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty">Aucune case modifiée.</div>
      ) : (
        <div className="pgrid">
          <table className="plan-t">
            <thead>
              <tr>
                <th className="sticky">Agent</th>
                {r.dates.map((d) => <th key={d}>{dayLabel(d)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, i }) => (
                <tr key={a.matricule}>
                  <td className="sticky">
                    <b>{a.nom}</b> <span className="muted">{a.matricule}</span>
                    {a.frozen && <span className="frozen-tag" title={a.frozen}>figé</span>}
                    <div className="muted" style={{ fontSize: 11 }}>{a.fonction || "fonction ?"} · {a.commune || "commune ?"} · {a.axe}{a.niveau !== "INCONNU" ? ` · ${a.niveau.toLowerCase()}` : ""}</div>
                  </td>
                  {r.after[i].map((c, d) => (
                    <td key={d} className={cellClass(c, r.changed[i][d], r.settings)}>
                      {r.changed[i][d] && <s>{fmtShift(r.before[i][d])}</s>}
                      {fmtShift(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function GroupCards({ groups, cap }: { groups: Group[]; cap: number }) {
  if (groups.length === 0) return <div className="empty">Aucun transport ce jour.</div>;
  const waveId = (g: Group) => `${g.kind}|${g.wave}`;
  const waves = [...new Set(groups.map(waveId))];
  return (
    <>
      {waves.map((w) => (
        <div key={w} style={{ marginBottom: 18 }}>
          <h3 style={{ margin: "6px 0 10px" }}>
            {waveLabel(w.split("|")[0] as Group["kind"], w.split("|")[1])}{" "}
            <span className="muted" style={{ fontWeight: 400 }}>— {groups.filter((g) => waveId(g) === w).reduce((s, g) => s + g.vehicles, 0)} véhicule(s)</span>
          </h3>
          <div className="gcards">
            {groups.filter((g) => waveId(g) === w).map((g) => (
              <div className={"gcard" + (g.members.length <= 4 ? " small" : "")} key={g.axe + g.wave}>
                <header>
                  <b>{g.axe}</b>
                  <span className={"badge " + (g.members.length <= 4 ? "warn" : "ok")}>{g.members.length}/{cap} pers.{g.vehicles > 1 ? ` · ${g.vehicles} véh.` : ""}</span>
                </header>
                <div className="drv">{g.chauffeur ? `Chauffeur : ${g.chauffeur}` : "Chauffeur non renseigné"}</div>
                <ul>
                  {g.members.map((m) => (
                    <li key={m.matricule}>
                      <span>{m.nom}</span>
                      <span>{fmtTime(m.dep)} · {m.commune || "?"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function Transport({ r }: { r: OptimizationResult }) {
  const [when, setWhen] = useState<"after" | "before">("after");
  const [day, setDay] = useState(0);
  const groups = (when === "after" ? r.groupsAfter : r.groupsBefore).filter((g) => g.dayIndex === day);
  const mb = r.metricsBefore.perDay[day];
  const ma = r.metricsAfter.perDay[day];
  return (
    <>
      <div className="toolbar">
        <div className="pills">
          <button className={"pill" + (when === "before" ? " on" : "")} onClick={() => setWhen("before")}>Avant ({mb.vehicles} véh.)</button>
          <button className={"pill" + (when === "after" ? " on" : "")} onClick={() => setWhen("after")}>Après ({ma.vehicles} véh.)</button>
        </div>
        <div className="pills">
          {r.dates.map((d, i) => (
            <button key={d} className={"pill" + (day === i ? " on" : "")} onClick={() => setDay(i)}>{dayLabel(d)}</button>
          ))}
        </div>
      </div>
      <GroupCards groups={groups} cap={r.settings.capacity} />
    </>
  );
}

function Alertes({ alerts }: { alerts: Alert[] }) {
  const [filter, setFilter] = useState<string>("all");
  const codes = useMemo(() => {
    const m = new Map<string, number>();
    alerts.forEach((a) => m.set(a.code, (m.get(a.code) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [alerts]);
  const LABELS: Record<string, string> = {
    "commune-manquante": "Agent sans commune",
    "commune-inconnue": "Commune inconnue",
    "agent-absent": "Agent absent de la liste",
    amenagement: "Aménagement (figé)",
    "amenagement-non-compris": "Aménagement non compris",
    "niveau-inconnu": "Niveau inconnu",
    "code-case": "Code non horaire",
    repos: "Repos < minimum (d'origine)",
    capacite: "Capacité dépassée",
    "fonction-inconnue": "Fonction inconnue",
    "fonction-seule": "Fonction sans partenaire",
    "fonction-planning": "Fonction du planning",
    "jonction-semaine": "Jonction de semaine",
  };
  const order = { error: 0, warn: 1, info: 2 } as const;
  const list = alerts.filter((a) => filter === "all" || a.code === filter).sort((a, b) => order[a.level] - order[b.level]);
  if (alerts.length === 0) return <div className="empty">Aucune alerte.</div>;
  return (
    <>
      <div className="toolbar">
        <div className="pills">
          <button className={"pill" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")}>Tout ({alerts.length})</button>
          {codes.map(([c, n]) => (
            <button key={c} className={"pill" + (filter === c ? " on" : "")} onClick={() => setFilter(c)}>{LABELS[c] ?? c} ({n})</button>
          ))}
        </div>
      </div>
      <div className="alerts">
        {list.map((a, i) => (
          <div className="alert" key={i}>
            <span className={"badge " + (a.level === "error" ? "err" : a.level === "warn" ? "warn" : "")}>{a.level === "error" ? "erreur" : a.level === "warn" ? "attention" : "info"}</span>
            <span>
              {a.nom && <b>{a.nom} </b>}
              {a.matricule && <span className="muted">{a.matricule} — </span>}
              {a.message}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Results({ r }: { r: OptimizationResult }) {
  const [tab, setTab] = useState<TabId>("synthese");
  const [busy, setBusy] = useState<string | null>(null);
  const warnCount = r.alerts.filter((a) => a.level !== "info").length;

  async function download(kind: string) {
    setBusy(kind);
    try {
      const res = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: r, kind }) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Erreur d'export");
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const name = cd.match(/filename="([^"]+)"/)?.[1] ?? "export.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const TABS: { id: TabId; label: string; n?: number }[] = [
    { id: "synthese", label: "Avant / après" },
    { id: "echanges", label: "Échanges", n: r.swaps.length },
    { id: "planning", label: "Planning corrigé" },
    { id: "transport", label: "Listes de transport" },
    { id: "alertes", label: "Alertes", n: r.alerts.length },
  ];

  return (
    <div className="card" id="resultats">
      <div className="card-head">
        <h2><span className="num">3</span>Résultat</h2>
        <div className="downloads">
          <button className="btn primary" disabled={!!busy} onClick={() => download("planning")}>{busy === "planning" ? "…" : "⬇ Planning corrigé"}</button>
          <button className="btn" disabled={!!busy} onClick={() => download("echanges")}>{busy === "echanges" ? "…" : "⬇ Échanges"}</button>
          <button className="btn" disabled={!!busy} onClick={() => download("transport")}>{busy === "transport" ? "…" : "⬇ Listes de transport"}</button>
          <button className="btn accent" disabled={!!busy} onClick={() => download("complet")}>{busy === "complet" ? "…" : "⬇ Tout en un (Excel)"}</button>
        </div>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={"tab" + (tab === t.id ? " on" : "")} onClick={() => setTab(t.id)}>
            {t.label}
            {t.n !== undefined && <span className={"badge" + (t.id === "alertes" && warnCount ? " warn" : "")}>{t.n}</span>}
          </button>
        ))}
      </div>
      {tab === "synthese" && <Synthese r={r} />}
      {tab === "echanges" && <Echanges r={r} />}
      {tab === "planning" && <PlanningView r={r} />}
      {tab === "transport" && <Transport r={r} />}
      {tab === "alertes" && <Alertes alerts={r.alerts} />}
    </div>
  );
}
