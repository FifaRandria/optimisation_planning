"use client";

import { useMemo, useState } from "react";
import type { Alert, Cell, Group, OptimizationResult, Settings, Swap, SwapSide } from "@/lib/types";
import { dayLabel, fmtShift, fmtTime, norm } from "@/lib/util";
import { transportEvents, waveLabel } from "@/lib/waves";
import { IconAlert, IconBus, IconCalendar, IconCheck, IconChevron, IconDownload, IconInfo, IconSearch, IconShield, IconSwap, IconUsers } from "./Icons";

type TabId = "synthese" | "echanges" | "planning" | "transport" | "alertes";
const fmtNum = (n: number) => n.toLocaleString("fr-FR");

// ---------------------------------------------------------------------------
// Synthèse
// ---------------------------------------------------------------------------

function Kpi({ label, before, after, sub, icon }: { label: string; before?: string | number; after: string | number; sub?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="kpi">
      <div className="lbl">{icon}{label}</div>
      <div className="val">
        {before !== undefined && (
          <>
            <span className="was">{before}</span>
            <span className="arrow">→</span>
          </>
        )}
        {after}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Synthese({ r }: { r: OptimizationResult }) {
  const mb = r.metricsBefore;
  const ma = r.metricsAfter;
  const max = Math.max(1, ...mb.perDay.map((d) => d.vehicles), ...ma.perDay.map((d) => d.vehicles));
  const s = r.settings;
  return (
    <>
      <h3>Véhicules par jour</h3>
      <div className="legend">
        <span><i style={{ background: "#bae6fd" }} />Ramassage avant</span>
        <span><i style={{ background: "var(--before)" }} />Remisage avant</span>
        <span><i style={{ background: "var(--pickup)" }} />Ramassage après</span>
        <span><i style={{ background: "var(--accent)" }} />Remisage après</span>
      </div>
      <div className="chart">
        {r.dates.map((d, i) => {
          const b = mb.perDay[i];
          const a = ma.perDay[i];
          return (
            <div className="chart-row" key={d}>
              <div className="day">{dayLabel(d)}</div>
              <div className="bars2">
                <div className="seg b" title={`Avant : ${b.pickupVehicles} ramassage + ${b.dropVehicles} remisage`}>
                  <i className="p" style={{ width: `${(b.pickupVehicles / max) * 100}%` }} />
                  <i className="d" style={{ width: `${(b.dropVehicles / max) * 100}%` }} />
                </div>
                <div className="seg a" title={`Après : ${a.pickupVehicles} ramassage + ${a.dropVehicles} remisage`}>
                  <i className="p" style={{ width: `${(a.pickupVehicles / max) * 100}%` }} />
                  <i className="d" style={{ width: `${(a.dropVehicles / max) * 100}%` }} />
                </div>
              </div>
              <div className="nums">
                {b.vehicles} → <b>{a.vehicles}</b>
                {b.vehicles > a.vehicles && <span className="delta">−{b.vehicles - a.vehicles}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <h3 style={{ marginTop: 26 }}>Détail par jour</h3>
      <div className="tablewrap" style={{ marginTop: 10 }}>
        <table className="t">
          <thead>
            <tr>
              <th>Jour</th>
              <th className="c">Personnes</th>
              <th className="c">Ramassage</th>
              <th className="c">Remisage</th>
              <th className="c">Total avant</th>
              <th className="c">Total après</th>
              <th className="c">Gain</th>
              <th className="c">Pers. / véh.</th>
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
                  <td className="c">{b.pickupVehicles} → {a.pickupVehicles}</td>
                  <td className="c">{b.dropVehicles} → {a.dropVehicles}</td>
                  <td className="c">{b.vehicles}</td>
                  <td className="c"><b>{a.vehicles}</b></td>
                  <td className="c">{b.vehicles - a.vehicles > 0 ? <span className="badge ok">−{b.vehicles - a.vehicles}</span> : <span className="muted">0</span>}</td>
                  <td className="c">{b.vehicles ? (b.transported / b.vehicles).toFixed(1) : "–"} → {a.vehicles ? (a.transported / a.vehicles).toFixed(1) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="c">{fmtNum(ma.transported)}</td>
              <td className="c">{mb.pickupVehicles} → {ma.pickupVehicles}</td>
              <td className="c">{mb.dropVehicles} → {ma.dropVehicles}</td>
              <td className="c">{mb.vehicles}</td>
              <td className="c">{ma.vehicles}</td>
              <td className="c">−{mb.vehicles - ma.vehicles}</td>
              <td className="c">{mb.avgPerVehicle.toFixed(1)} → {ma.avgPerVehicle.toFixed(1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h3 style={{ marginTop: 26, display: "flex", alignItems: "center", gap: 8 }}><IconShield size={17} />Garanties</h3>
      <div className="guarantees">
        <div className="guarantee"><IconCheck size={16} /><span>Chaque jour, les mêmes horaires restent couverts{s.respectFunction ? " dans chaque fonction" : ""}.</span></div>
        {s.respectFunction && <div className="guarantee"><IconCheck size={16} /><span>Échanges uniquement entre agents de même fonction.</span></div>}
        <div className="guarantee"><IconCheck size={16} /><span>Chacun garde son nombre de jours OFF dans la semaine.</span></div>
        <div className="guarantee"><IconCheck size={16} /><span>Aucun repos de moins de {s.minRestHours} h n'est créé.</span></div>
        <div className="guarantee"><IconCheck size={16} /><span>Congés, codes et agents figés ne bougent pas.</span></div>
        <div className="guarantee"><IconCheck size={16} /><span>Aménagements vérifiés pour les 2 personnes de chaque échange : aucune personne avec un aménagement n'est échangée{s.swapRoles ? " (sauf rôle seul : RENFORT DIGITAL, TEAM LEAD)" : ""}.</span></div>
        <div className="guarantee"><IconCheck size={16} /><span>« Axe 21h » pour {s.axe21Waves.map((h) => h + "h").join(", ") || "aucune vague"} ; « Axe 23h » pour les autres vagues.</span></div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Échanges
// ---------------------------------------------------------------------------

function Person({ s, role, hideChange }: { s: SwapSide; role: string; hideChange?: boolean }) {
  return (
    <div className="person">
      <div className="role-lbl">{role}</div>
      <div className="nm">{s.nom}</div>
      <div className="meta">
        {s.matricule} · {s.fonction || "fonction ?"}
        {s.pole ? ` · ${s.pole}` : ""} · {s.commune || "commune ?"} · {s.axe}
      </div>
      {!hideChange && <div className="chg"><s>{s.before}</s>→<b>{s.after}</b></div>}
    </div>
  );
}

/** Remplacement par la réserve : la semaine de l'agent remplacé, reprise telle quelle par le remplaçant. */
function WeekGrid({ s }: { s: Swap }) {
  // "lun 09/11 OFF · mar 10/11 12:00-21:00" -> [["lun 09/11", "OFF"], ["mar 10/11", "12:00-21:00"]]
  const days = s.a.before.split(" · ").map((p) => {
    const t = p.split(" ");
    return [t.slice(0, 2).join(" "), t.slice(2).join(" ")] as const;
  });
  const cls = (v: string) => (v === "OFF" ? "to off" : "to late");
  return (
    <div className="offgrid">
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            {days.map(([d]) => <th key={d}>{d}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><b>{s.a.nom}</b><div className="muted" style={{ fontSize: 11 }}>passe hors planning</div></td>
            {days.map(([d, v]) => (
              <td key={d}>
                <span className="from">{v}</span>
                <span className="to off">REMPLACÉ</span>
              </td>
            ))}
          </tr>
          <tr>
            <td><b>{s.b.nom}</b><div className="muted" style={{ fontSize: 11 }}>hors planning → remplaçant</div></td>
            {days.map(([d, v]) => (
              <td key={d}>
                <span className="from">—</span>
                <span className={cls(v)}>{v}</span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Échange OFF : on rejoue les 2 jours sous forme de grille avant → après. */
function OffGrid({ s }: { s: Swap }) {
  // before "lun 12/10 12:00-21:00 · sam 17/10 OFF" -> ["12:00-21:00", "OFF"]
  const parts = (txt: string) => txt.split(" · ").map((p) => p.split(" ").slice(2).join(" "));
  const rows = [
    { nm: s.a.nom, b: parts(s.a.before), a: parts(s.a.after) },
    { nm: s.b.nom, b: parts(s.b.before), a: parts(s.b.after) },
  ];
  const cls = (v: string, dIdx: number) => (v === "OFF" ? "to off" : dIdx === 0 ? "to late" : "to");
  return (
    <div className="offgrid">
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>{dayLabel(s.date)} <span className="badge drop" style={{ marginLeft: 4 }}>jour du véhicule fermé</span></th>
            <th>{dayLabel(s.date2!)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.nm}>
              <td><b>{row.nm}</b></td>
              {[0, 1].map((k) => (
                <td key={k}>
                  <span className="from">{row.b[k]}</span>
                  <span className={cls(row.a[k], k)}>{row.a[k]}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Echanges({ r }: { r: OptimizationResult }) {
  const [kind, setKind] = useState<"all" | Swap["kind"]>("all");
  const [day, setDay] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const plans = useMemo(() => {
    const m = new Map<number, Swap[]>();
    for (const s of r.swaps) {
      if (!m.has(s.planId)) m.set(s.planId, []);
      m.get(s.planId)!.push(s);
    }
    return [...m.values()].sort((a, b) => a[0].dayIndex - b[0].dayIndex || a[0].planId - b[0].planId);
  }, [r]);
  if (plans.length === 0) return <div className="empty">Aucun échange n'a permis de réduire le nombre de véhicules avec ces réglages.</div>;

  const nq = norm(q);
  const match = (s: Swap) =>
    (kind === "all" || s.kind === kind) &&
    (day === null || s.dayIndex === day || s.dayIndex2 === day) &&
    (!nq || [s.a.nom, s.a.matricule, s.b.nom, s.b.matricule, s.a.fonction, s.planSummary].some((t) => norm(t).includes(nq)));
  const shown = plans.map((p) => p.filter(match)).filter((p) => p.length);
  const nOff = r.swaps.filter((s) => s.kind === "off").length;
  const nRes = r.swaps.filter((s) => s.kind === "reserve").length;
  const days = [...new Set(r.swaps.map((s) => s.dayIndex))].sort((a, b) => a - b);

  return (
    <>
      <div className="toolbar">
        <div className="seg-ctl" role="tablist" aria-label="Type d'échange">
          <button className={kind === "all" ? "on" : ""} onClick={() => setKind("all")}>Tous<span className="c">{r.swaps.length}</span></button>
          <button className={kind === "jour" ? "on" : ""} onClick={() => setKind("jour")}>Même jour<span className="c">{r.swaps.length - nOff - nRes}</span></button>
          <button className={kind === "off" ? "on" : ""} onClick={() => setKind("off")}>Jour OFF<span className="c">{nOff}</span></button>
          {(nRes > 0 || r.settings.useReserve) && (
            <button className={kind === "reserve" ? "on" : ""} onClick={() => setKind("reserve")}>Réserve<span className="c">{nRes}</span></button>
          )}
        </div>
        <div className="search grow">
          <IconSearch size={15} />
          <input type="search" placeholder="Rechercher un agent, un matricule, une fonction, un axe…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {days.length > 1 && (
        <div className="pills" style={{ marginBottom: 12 }}>
          <button className={"pill" + (day === null ? " on" : "")} onClick={() => setDay(null)}>Tous les jours</button>
          {days.map((d) => (
            <button key={d} className={"pill" + (day === d ? " on" : "")} onClick={() => setDay(d)}>{dayLabel(r.dates[d])}</button>
          ))}
        </div>
      )}
      <div className="count-line">{shown.length} véhicule{shown.length > 1 ? "s" : ""} fermé{shown.length > 1 ? "s" : ""} · {shown.reduce((s, p) => s + p.length, 0)} échange(s) affiché(s)</div>
      {shown.length === 0 && <div className="empty">Aucun échange ne correspond à ces filtres.</div>}
      {shown.slice(0, 200).map((p) => (
        <div className="plan" key={p[0].planId}>
          <header>
            <span className="day">{dayLabel(p[0].date)}</span>
            <span className="sum">{p[0].planSummary}</span>
            <span className="right">
              {p.some((s) => s.kind === "off") && <span className="badge off"><IconCalendar size={12} />jour OFF</span>}
              {p.some((s) => s.kind === "reserve") && <span className="badge err"><IconAlert size={12} />réserve · à confirmer</span>}
              <span className="badge ok">−{p[0].vehiclesSaved} véhicule{p[0].vehiclesSaved > 1 ? "s" : ""}</span>
            </span>
          </header>
          {p.map((s) => (
            <div className="swap" key={s.id}>
              <Person s={s.a} role={s.kind === "reserve" ? "Passe hors planning (semaine)" : "Quitte le transport"} hideChange={s.kind === "reserve"} />
              <div className="mid"><span><IconSwap size={16} /></span></div>
              <Person
                s={s.b}
                role={s.kind === "off" ? "Échange son jour OFF" : s.kind === "reserve" ? "Remplaçant (hors planning)" : "Prend le shift"}
                hideChange={s.kind === "reserve"}
              />
              {s.kind === "off" && <OffGrid s={s} />}
              {s.kind === "reserve" && <WeekGrid s={s} />}
              <details className="why">
                <summary><IconChevron size={13} />Pourquoi cet échange ?</summary>
                <div>{s.reason}</div>
              </details>
            </div>
          ))}
        </div>
      ))}
      {shown.length > 200 && <div className="note">Seuls les 200 premiers plans sont affichés : affinez avec les filtres, ou téléchargez « Échanges » pour la liste complète.</div>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function cellClass(c: Cell, changed: boolean, settings: Settings): string {
  let cls = "";
  if (changed) cls += " chg";
  if (c.k === "off") cls += " off";
  if (c.k === "leave") cls += " leave";
  for (const e of transportEvents(c, settings)) cls += e.kind === "ramassage" ? " tr-p" : " tr-d";
  return cls;
}

function PlanningView({ r }: { r: OptimizationResult }) {
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [q, setQ] = useState("");
  const nq = norm(q);
  const rows = r.agents
    .map((a, i) => ({ a, i }))
    .filter(({ a, i }) => (!onlyChanged || r.changed[i].some(Boolean)) && (!nq || [a.nom, a.matricule, a.fonction, a.commune, a.axe].some((t) => norm(t).includes(nq))));
  const nAgents = r.changed.filter((row) => row.some(Boolean)).length;
  const nCells = r.changed.reduce((s, row) => s + row.filter(Boolean).length, 0);
  const wk = r.dates.map((d) => [0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay()));
  return (
    <>
      <div className="toolbar">
        <div className="seg-ctl">
          <button className={onlyChanged ? "on" : ""} onClick={() => setOnlyChanged(true)}>Agents modifiés<span className="c">{nAgents}</span></button>
          <button className={!onlyChanged ? "on" : ""} onClick={() => setOnlyChanged(false)}>Tous<span className="c">{r.agents.length}</span></button>
        </div>
        <div className="search grow">
          <IconSearch size={15} />
          <input type="search" placeholder="Rechercher un agent, une fonction, un axe…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="legend" style={{ marginBottom: 10 }}>
        <span><i style={{ background: "var(--changed)" }} />case modifiée ({nCells}), l'ancien horaire est barré</span>
        <span><i style={{ background: "var(--pickup)" }} />ramassage</span>
        <span><i style={{ background: "var(--drop)" }} />remisage</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty">Aucun agent ne correspond.</div>
      ) : (
        <div className="pgrid">
          <table className="plan-t">
            <thead>
              <tr>
                <th className="sticky">Agent</th>
                {r.dates.map((d, k) => <th key={d} className={wk[k] ? "wk" : ""}>{dayLabel(d)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 400).map(({ a, i }) => (
                <tr key={a.matricule}>
                  <td className="sticky">
                    <b>{a.nom}</b> <span className="muted">{a.matricule}</span>
                    {a.frozen && <span className="frozen-tag" title={a.frozen}>figé</span>}
                    {a.reserve && <span className="frozen-tag" style={{ background: "var(--accent-soft)", color: "var(--accent)" }} title="Personne hors planning ajoutée comme remplaçant : disponibilité à confirmer">réserve</span>}
                    <div className="muted" style={{ fontSize: 11 }}>{a.fonction || "fonction ?"}{a.pole ? ` · ${a.pole}` : ""} · {a.axe}</div>
                  </td>
                  {r.after[i].map((c, d) => (
                    <td key={d} className={cellClass(c, r.changed[i][d], r.settings) + (wk[d] ? " wk" : "")}>
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
      {rows.length > 400 && <div className="note">400 premiers agents affichés : utilisez la recherche, ou téléchargez le planning corrigé.</div>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function GroupCards({ groups, cap }: { groups: Group[]; cap: number }) {
  if (groups.length === 0) return <div className="empty">Aucun transport pour cette sélection.</div>;
  const waveId = (g: Group) => `${g.kind}|${g.wave}`;
  const waves = [...new Set(groups.map(waveId))];
  return (
    <>
      {waves.map((w) => {
        const [kind, wave] = w.split("|") as [Group["kind"], string];
        const gs = groups.filter((g) => waveId(g) === w);
        return (
          <div key={w}>
            <div className="wave-head">
              <span className={"badge " + (kind === "ramassage" ? "pickup" : "drop")}>{kind}</span>
              <h3>{waveLabel(kind, wave)}</h3>
              <span className="muted" style={{ fontSize: 13 }}>{gs.reduce((s, g) => s + g.vehicles, 0)} véhicule(s) · {gs.reduce((s, g) => s + g.members.length, 0)} pers.</span>
            </div>
            <div className="gcards">
              {gs.map((g) => {
                const small = g.members.length <= 4;
                return (
                  <div className={"gcard" + (small ? " small" : "")} key={g.kind + g.axe + g.wave}>
                    <header>
                      <b>{g.axe}</b>
                      <span className={"badge " + (small ? "warn" : "ok")}>{g.members.length}/{cap * g.vehicles} pers.{g.vehicles > 1 ? ` · ${g.vehicles} véh.` : ""}</span>
                    </header>
                    <div className="fill"><i style={{ width: `${Math.min(100, (g.members.length / (cap * g.vehicles)) * 100)}%` }} /></div>
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
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

function Transport({ r }: { r: OptimizationResult }) {
  const [when, setWhen] = useState<"after" | "before">("after");
  const [kind, setKind] = useState<"all" | Group["kind"]>("all");
  const [day, setDay] = useState(0);
  const all = when === "after" ? r.groupsAfter : r.groupsBefore;
  const groups = all.filter((g) => g.dayIndex === day && (kind === "all" || g.kind === kind));
  const metrics = when === "after" ? r.metricsAfter : r.metricsBefore;
  return (
    <>
      <div className="toolbar">
        <div className="seg-ctl">
          <button className={when === "before" ? "on" : ""} onClick={() => setWhen("before")}>Avant<span className="c">{r.metricsBefore.perDay[day].vehicles}</span></button>
          <button className={when === "after" ? "on" : ""} onClick={() => setWhen("after")}>Après<span className="c">{r.metricsAfter.perDay[day].vehicles}</span></button>
        </div>
        <div className="seg-ctl">
          <button className={kind === "all" ? "on" : ""} onClick={() => setKind("all")}>Tout</button>
          <button className={kind === "ramassage" ? "on" : ""} onClick={() => setKind("ramassage")}>Ramassage<span className="c">{metrics.perDay[day].pickupVehicles}</span></button>
          <button className={kind === "remisage" ? "on" : ""} onClick={() => setKind("remisage")}>Remisage<span className="c">{metrics.perDay[day].dropVehicles}</span></button>
        </div>
      </div>
      <div className="pills" style={{ marginBottom: 8 }}>
        {r.dates.map((d, i) => (
          <button key={d} className={"pill" + (day === i ? " on" : "")} onClick={() => setDay(i)}>
            {dayLabel(d)} <span className="c">{metrics.perDay[i].vehicles} véh.</span>
          </button>
        ))}
      </div>
      <GroupCards groups={groups} cap={r.settings.capacity} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Alertes
// ---------------------------------------------------------------------------

const ALERT_LABELS: Record<string, string> = {
  "commune-manquante": "Sans commune / axe",
  "commune-inconnue": "Commune inconnue",
  "agent-absent": "Agent absent de la liste",
  amenagement: "Aménagement (figé)",
  "amenagement-non-compris": "Aménagement à vérifier",
  "niveau-inconnu": "Niveau inconnu",
  "code-case": "Code non horaire",
  repos: "Repos < minimum (d'origine)",
  capacite: "Capacité dépassée",
  "fonction-inconnue": "Fonction inconnue",
  "fonction-seule": "Fonction sans partenaire",
  "fonction-planning": "Fonction du planning",
  "jonction-semaine": "Jonction de semaine",
  reserve: "Réserve hors planning",
  "reserve-a-confirmer": "Remplacement à confirmer",
  "pole-inconnu": "Pôle inconnu",
  "amenagement-role": "Rôle seul (échangeable)",
};

function Alertes({ alerts }: { alerts: Alert[] }) {
  const [filter, setFilter] = useState<string>("all");
  const codes = useMemo(() => {
    const m = new Map<string, number>();
    alerts.forEach((a) => m.set(a.code, (m.get(a.code) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [alerts]);
  const order = { error: 0, warn: 1, info: 2 } as const;
  const list = alerts.filter((a) => filter === "all" || a.code === filter).sort((a, b) => order[a.level] - order[b.level]);
  if (alerts.length === 0) return <div className="empty">Aucune alerte.</div>;
  return (
    <>
      <div className="pills" style={{ marginBottom: 12 }}>
        <button className={"pill" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")}>Tout <span className="c">{alerts.length}</span></button>
        {codes.map(([c, n]) => (
          <button key={c} className={"pill" + (filter === c ? " on" : "")} onClick={() => setFilter(c)}>{ALERT_LABELS[c] ?? c} <span className="c">{n}</span></button>
        ))}
      </div>
      <div className="alerts">
        {list.map((a, i) => (
          <div className="alert" key={i}>
            <span className={"badge " + (a.level === "error" ? "err" : a.level === "warn" ? "warn" : "indigo")}>{a.level === "error" ? "erreur" : a.level === "warn" ? "attention" : "info"}</span>
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

// ---------------------------------------------------------------------------

export default function Results({ r, stale }: { r: OptimizationResult; stale?: boolean }) {
  const [tab, setTab] = useState<TabId>("synthese");
  const [busy, setBusy] = useState<string | null>(null);
  const warnCount = r.alerts.filter((a) => a.level !== "info").length;
  const mb = r.metricsBefore;
  const ma = r.metricsAfter;
  const saved = mb.vehicles - ma.vehicles;
  const pctSaved = mb.vehicles ? (saved / mb.vehicles) * 100 : 0;
  const nOff = r.swaps.filter((s) => s.kind === "off").length;
  const nRes = r.swaps.filter((s) => s.kind === "reserve").length;
  const nAgents = r.changed.filter((row) => row.some(Boolean)).length;

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

  const TABS: { id: TabId; label: string; icon: React.ReactNode; n?: number }[] = [
    { id: "synthese", label: "Avant / après", icon: <IconBus size={15} /> },
    { id: "echanges", label: "Échanges", icon: <IconSwap size={15} />, n: r.swaps.length },
    { id: "planning", label: "Planning corrigé", icon: <IconCalendar size={15} /> },
    { id: "transport", label: "Listes de transport", icon: <IconUsers size={15} /> },
    { id: "alertes", label: "Alertes", icon: <IconAlert size={15} />, n: r.alerts.length },
  ];

  const dl = (kind: string, label: string, primary?: boolean) => (
    <button className={"btn small" + (primary ? " primary" : "")} disabled={!!busy} onClick={() => download(kind)}>
      {busy === kind ? <span className={"spinner" + (primary ? "" : " dark")} /> : <IconDownload size={14} />}
      {label}
    </button>
  );

  return (
    <div className="card fade" id="resultats">
      <div className="results-head">
        <div className="card-head" style={{ margin: 0 }}>
          <div className="title">
            <span className="num done"><IconCheck size={16} /></span>
            <div>
              <h2>Résultat</h2>
              <p>Calculé le {new Date(r.generatedAt).toLocaleString("fr-FR")} · {r.dates.length} jours · {fmtNum(r.agents.length)} agents</p>
            </div>
          </div>
        </div>
        <div className="downloads">
          {dl("planning", "Planning corrigé", true)}
          {dl("echanges", "Échanges")}
          {dl("transport", "Listes de transport")}
          {dl("complet", "Tout en un")}
        </div>
      </div>

      {stale && (
        <div className="callout warn" style={{ marginTop: 0, marginBottom: 16 }}>
          <IconInfo size={16} />
          <span>Les réglages ont changé depuis ce calcul : cliquez sur <b>Optimiser</b> pour mettre le résultat à jour.</span>
        </div>
      )}
      {nRes > 0 && (
        <div className="callout warn" style={{ marginTop: 0, marginBottom: 16 }}>
          <IconAlert size={16} />
          <span>
            <b>{nRes} remplacement{nRes > 1 ? "s" : ""} par des personnes hors planning</b> : à confirmer avant diffusion. Chaque remplaçant a été pris dans la liste des agents, considérée comme fiable. S'il est en réalité indisponible, gardez l'agent d'origine pour cette semaine (le véhicule correspondant ne sera alors pas économisé). Détail : onglet Échanges, filtre « Réserve ».
          </span>
        </div>
      )}

      <div className="hero">
        <div className={"gain" + (saved > 0 ? "" : " none")}>
          <div className="lbl">Véhicules économisés</div>
          <div className="big">{saved > 0 ? `−${fmtNum(saved)}` : "0"} <small>{saved > 0 ? `(−${pctSaved.toFixed(1)} %)` : ""}</small></div>
          <div className="ba"><b>{fmtNum(mb.vehicles)}</b> → <b>{fmtNum(ma.vehicles)}</b> véhicules sur la période</div>
        </div>
        <div className="kpis">
          <Kpi label="Ramassage" icon={<span style={{ color: "var(--pickup)" }}>●</span>} before={mb.pickupVehicles} after={ma.pickupVehicles} sub={`véhicules à ${r.settings.pickupHours.map((h) => h + "h").join(", ") || "—"}`} />
          <Kpi label="Remisage" icon={<span style={{ color: "var(--drop)" }}>●</span>} before={mb.dropVehicles} after={ma.dropVehicles} sub="véhicules de 18h à 23h" />
          <Kpi label="Remplissage" before={mb.avgPerVehicle.toFixed(1)} after={ma.avgPerVehicle.toFixed(1)} sub={`pers./véhicule · ≤ 4 pers. : ${mb.smallVehicles} → ${ma.smallVehicles}`} />
          <Kpi
            label="Échanges"
            after={fmtNum(r.swaps.length)}
            sub={<>{nOff} jour OFF · {nRes} remplacement{nRes > 1 ? "s" : ""} par la réserve · {nAgents} agents concernés</>}
          />
        </div>
      </div>

      <div className="tabs" style={{ marginTop: 22 }} role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={"tab" + (tab === t.id ? " on" : "")} onClick={() => setTab(t.id)}>
            {t.icon}
            {t.label}
            {t.n !== undefined && <span className={"badge" + (t.id === "alertes" && warnCount ? " warn" : "")}>{fmtNum(t.n)}</span>}
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
