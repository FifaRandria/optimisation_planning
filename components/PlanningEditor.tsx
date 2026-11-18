"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Cell, EditMotif, NewAgentInput, OptimizationResult, Swap, TransportChange } from "@/lib/types";
import { EDIT_MOTIFS } from "@/lib/types";
import { dayCounts, seatsFor, vehiclesOf, type AgentAxes } from "@/lib/transport-cost";
import { dayLabel, fmtShift, fmtTime, norm } from "@/lib/util";
import { transportEvents, waveLabel } from "@/lib/waves";
import { IconAlert, IconCheck, IconEye, IconSearch, IconUserPlus, IconX } from "./Icons";

const HORS: Cell = { k: "code", raw: "HORS PLANNING" };
const same = (a: Cell, b: Cell) => JSON.stringify(a) === JSON.stringify(b);
const hm = (min: number) => fmtTime(min);
const toMin = (v: string) => {
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

interface Row {
  matricule: string;
  nom: string;
  fonction: string;
  pole: string;
  axe: string;
  axes: AgentAxes;
  frozen: string | null;
  base: Cell[];
  added?: boolean;
}

interface Hit {
  matricule: string;
  nom: string;
  fonction: string;
  pole: string;
  niveau: string;
  commune: string;
  axes: Partial<Record<"21h" | "23h", string>>;
  inPlanning: boolean;
}

type AddedAgent = NewAgentInput & { axes: AgentAxes };

interface Preview {
  result: OptimizationResult;
  swapsNew: number;
}

function cellCls(c: Cell, s: OptimizationResult["settings"]) {
  let cls = "";
  if (c.k === "off") cls += " off";
  if (c.k === "leave") cls += " leave";
  for (const e of transportEvents(c, s)) cls += e.kind === "ramassage" ? " tr-p" : " tr-d";
  return cls;
}

// ---------------------------------------------------------------------------
// Édition d'une case
// ---------------------------------------------------------------------------

function CellForm({ row, d, r, current, seats, dayDelta, onApply, onReset, onClose }: {
  row: Row;
  d: number;
  r: OptimizationResult;
  current: Cell;
  seats: ReturnType<typeof seatsFor>;
  dayDelta: number;
  onApply: (c: Cell) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const base = row.base[d];
  const [kind, setKind] = useState<"shift" | "off" | "absent" | "leave">(current.k === "shift" ? "shift" : current.k === "off" ? "off" : current.k === "leave" ? "leave" : "absent");
  const [arr, setArr] = useState(current.k === "shift" ? hm(current.arr) : "12:00");
  const [dep, setDep] = useState(current.k === "shift" ? hm(current.dep) : "21:00");
  const [code, setCode] = useState(current.k === "code" && current.raw !== "HORS PLANNING" ? current.raw : "ABSENT");
  const [err, setErr] = useState<string | null>(null);

  function apply() {
    setErr(null);
    if (kind === "shift") {
      const a = toMin(arr);
      let b = toMin(dep);
      if (a === null || b === null) return setErr("Horaire incomplet.");
      if (b <= a) b += 1440;
      return onApply({ k: "shift", arr: a, dep: b });
    }
    if (kind === "off") return onApply({ k: "off", raw: "OFF" });
    if (kind === "leave") return onApply({ k: "leave", raw: "CONGE" });
    onApply({ k: "code", raw: code.trim().toUpperCase().slice(0, 30) || "ABSENT" });
  }

  const free = seats.filter((s) => s.free > 0);
  return (
    <div className="card cell-editor fade">
      <div className="ce-head">
        <div>
          <b>{row.nom}</b> <span className="muted">{row.matricule}</span>
          <div className="muted small">{row.fonction || "fonction ?"}{row.pole ? ` · ${row.pole}` : ""} · {row.axe} · <b>{dayLabel(r.dates[d])}</b></div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer"><IconX size={16} /></button>
      </div>
      {row.frozen && (
        <div className="callout warn" style={{ marginTop: 8 }}>
          <IconAlert size={15} />
          <span>Agent figé pour l'optimisation ({row.frozen}). La modification manuelle reste possible : elle est de votre responsabilité.</span>
        </div>
      )}
      <div className="ce-grid">
        <div>
          <div className="muted small">Planning actuel : <b>{fmtShift(base) || "—"}</b></div>
          <div className="seg-ctl" style={{ marginTop: 8 }}>
            {(["shift", "off", "absent", "leave"] as const).map((k) => (
              <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
                {k === "shift" ? "Horaire" : k === "off" ? "OFF" : k === "absent" ? "Absent / code" : "Congé"}
              </button>
            ))}
          </div>
          {kind === "shift" && (
            <div className="ce-times">
              <label>Arrivée <input type="time" value={arr} onChange={(e) => setArr(e.target.value)} /></label>
              <label>Départ <input type="time" value={dep} onChange={(e) => setDep(e.target.value)} /></label>
            </div>
          )}
          {kind === "absent" && (
            <div className="ce-times">
              <label>Code <input type="text" value={code} onChange={(e) => setCode(e.target.value)} maxLength={30} /></label>
            </div>
          )}
          {err && <div className="callout err" style={{ marginTop: 8 }}><IconAlert size={15} /><span>{err}</span></div>}
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button className="btn primary small" onClick={apply}><IconCheck size={14} />Appliquer</button>
            {!same(current, base) && <button className="btn small" onClick={onReset}>Remettre « {fmtShift(base) || "—"} »</button>}
          </div>
        </div>
        <div className="ce-seats">
          <div className="tag">Transport ce jour sur ses axes</div>
          {seats.length === 0 && <div className="muted small" style={{ marginTop: 6 }}>Aucun véhicule prévu sur ses axes ce jour : un shift avec transport ajoutera un véhicule.</div>}
          {seats.length > 0 && (
            <ul>
              {seats.map((s) => (
                <li key={s.kind + s.hour}>
                  <span>{waveLabel(s.kind, s.hour + "h")} · {s.axe}</span>
                  <span className={"badge " + (s.free > 0 ? "ok" : "warn")}>{s.free > 0 ? `${s.free} place${s.free > 1 ? "s" : ""} libre${s.free > 1 ? "s" : ""}` : "complet"}</span>
                </li>
              ))}
            </ul>
          )}
          {free.length > 0 && (
            <div className="muted small" style={{ marginTop: 6 }}>
              Placer la personne sur {free.map((s) => (s.kind === "ramassage" ? `une arrivée à ${s.hour}:00` : `une fin entre ${s.hour - 1}:01 et ${s.hour}:00`)).join(", ou ")} ne coûte aucun véhicule.
            </div>
          )}
          <div className="ce-delta">
            Ce jour : <b className={dayDelta > 0 ? "bad" : dayDelta < 0 ? "good" : ""}>{dayDelta > 0 ? `+${dayDelta}` : dayDelta} véhicule{Math.abs(dayDelta) > 1 ? "s" : ""}</b> avec les modifications en cours
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ajout d'un renfort
// ---------------------------------------------------------------------------

function RenfortDialog({ optId, fonctions, onAdd, onFocus, onClose }: {
  optId: number;
  fonctions: string[];
  onAdd: (a: AddedAgent) => void;
  onFocus: (matricule: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [axes, setAxes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState({ matricule: "", nom: "", fonction: "", pole: "", axe21: "", axe23: "" });

  useEffect(() => {
    fetch(`/api/history/${optId}/agents`).then(async (res) => res.ok && setAxes((await res.json()).axes ?? [])).catch(() => null);
  }, [optId]);

  async function search() {
    if (q.trim().length < 2) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/history/${optId}/agents?q=${encodeURIComponent(q.trim())}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Recherche impossible.");
      setHits(j.hits);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addManual() {
    const m = { ...manual, matricule: manual.matricule.trim().toUpperCase() };
    if (!m.matricule || !m.fonction.trim() || (!m.axe21 && !m.axe23)) return setErr("Matricule, fonction et au moins un axe sont obligatoires.");
    onAdd({ matricule: m.matricule, nom: m.nom.trim() || m.matricule, fonction: m.fonction.trim(), pole: m.pole.trim() || undefined, axe21: m.axe21 || undefined, axe23: m.axe23 || undefined, axes: { "21h": m.axe21 || m.axe23, "23h": m.axe23 || m.axe21 } });
  }

  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="renfort-title">
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="ce-head">
          <h2 id="renfort-title" style={{ margin: 0 }}>Ajouter un renfort</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer"><IconX size={16} /></button>
        </div>
        <p className="muted small">Cherchez la personne dans la liste des agents de cette optimisation. Si elle n'y est pas, saisissez-la plus bas.</p>
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <div className="search grow">
            <IconSearch size={15} />
            <input type="search" placeholder="Matricule, nom ou fonction…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} autoFocus />
          </div>
          <button className="btn small" onClick={search} disabled={busy}>{busy ? <span className="spinner dark" /> : <IconSearch size={14} />}Rechercher</button>
        </div>
        {hits && hits.length === 0 && <div className="muted small">Personne trouvée : saisissez-la ci-dessous.</div>}
        {hits && hits.length > 0 && (
          <div className="hit-list">
            {hits.map((h) => (
              <div className="hit" key={h.matricule}>
                <div>
                  <b>{h.nom}</b> <span className="muted">{h.matricule}</span>
                  <div className="muted small">{h.fonction || "fonction ?"}{h.pole ? ` · ${h.pole}` : ""} · {h.commune || "commune ?"} · {h.axes["21h"] ?? h.axes["23h"] ?? "sans axe"}</div>
                </div>
                {h.inPlanning ? (
                  <button className="btn small" onClick={() => onFocus(h.matricule)}>Déjà au planning : afficher</button>
                ) : (
                  <button className="btn small primary" onClick={() => onAdd({ matricule: h.matricule, nom: h.nom, fonction: h.fonction, pole: h.pole || undefined, axes: h.axes })}><IconUserPlus size={14} />Ajouter</button>
                )}
              </div>
            ))}
          </div>
        )}
        <details style={{ marginTop: 14 }} open={hits?.length === 0}>
          <summary className="text-link">Saisir une personne absente de la liste</summary>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <div className="field"><label>Matricule</label><input type="text" value={manual.matricule} onChange={(e) => setManual({ ...manual, matricule: e.target.value })} /></div>
            <div className="field"><label>Nom</label><input type="text" value={manual.nom} onChange={(e) => setManual({ ...manual, nom: e.target.value })} /></div>
            <div className="field">
              <label>Fonction</label>
              <input type="text" list="fonctions-list" value={manual.fonction} onChange={(e) => setManual({ ...manual, fonction: e.target.value })} />
              <datalist id="fonctions-list">{fonctions.map((f) => <option key={f} value={f} />)}</datalist>
            </div>
            <div className="field"><label>Pôle (facultatif)</label><input type="text" value={manual.pole} placeholder="FO / BO / SUPPORT" onChange={(e) => setManual({ ...manual, pole: e.target.value })} /></div>
            <div className="field">
              <label>Axe 21h</label>
              <select className="select" value={manual.axe21} onChange={(e) => setManual({ ...manual, axe21: e.target.value })}>
                <option value="">—</option>
                {axes.map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Axe 23h</label>
              <select className="select" value={manual.axe23} onChange={(e) => setManual({ ...manual, axe23: e.target.value })}>
                <option value="">—</option>
                {axes.map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>
          </div>
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button className="btn primary small" onClick={addManual}><IconUserPlus size={14} />Ajouter cette personne</button>
          </div>
        </details>
        {err && <div className="callout err"><IconAlert size={15} /><span>{err}</span></div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aperçu d'une version
// ---------------------------------------------------------------------------

export function TransportChangesTable({ changes }: { changes: TransportChange[] }) {
  if (!changes.length) return <div className="muted small">Aucun changement de transport.</div>;
  return (
    <div className="tablewrap">
      <table className="t">
        <thead>
          <tr>
            <th>Jour</th>
            <th>Vague</th>
            <th>Axe</th>
            <th className="c">Véhicules</th>
            <th>Ajoutés</th>
            <th>Retirés</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={`${c.dayIndex}|${c.kind}|${c.wave}|${c.axe}`}>
              <td className="nowrap">{dayLabel(c.date)}</td>
              <td className="nowrap">{waveLabel(c.kind, c.wave)}</td>
              <td className="nowrap">{c.axe}{c.chauffeur ? <div className="muted small">{c.chauffeur}</div> : null}</td>
              <td className="c nowrap">{c.vehiclesBefore} → <b>{c.vehiclesAfter}</b></td>
              <td>{c.added.join(", ") || <span className="muted">—</span>}</td>
              <td>{c.removed.join(", ") || <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewCard({ p, current, version }: { p: Preview; current: number; version: number }) {
  const v = p.result.metricsAfter.vehicles;
  const fresh: Swap[] = p.result.swaps.filter((s) => s.version === version);
  return (
    <div className="card fade preview-card">
      <h3 style={{ marginTop: 0 }}>Aperçu de la version {version}</h3>
      <div className="kv-line">
        Véhicules : <b>{current}</b> → <b>{v}</b>{" "}
        <span className={"badge " + (v > current ? "warn" : v < current ? "ok" : "")}>{v > current ? `+${v - current}` : v < current ? `−${current - v}` : "="}</span>
        {" · "}{p.swapsNew} échange{p.swapsNew > 1 ? "s" : ""} nouveau{p.swapsNew > 1 ? "x" : ""} proposé{p.swapsNew > 1 ? "s" : ""}
        {" · "}{p.result.transportChanges?.length ?? 0} groupe(s) de transport modifié(s)
      </div>
      {fresh.length > 0 && (
        <details className="why" open>
          <summary>Échanges nouveaux</summary>
          <ul className="reasons">{fresh.map((s) => <li key={s.id}>{s.reason}</li>)}</ul>
        </details>
      )}
      <details className="why">
        <summary>Ce qui change pour le transport</summary>
        <TransportChangesTable changes={p.result.transportChanges ?? []} />
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Éditeur
// ---------------------------------------------------------------------------

export default function PlanningEditor({ r, optId, today, onCancel }: { r: OptimizationResult; optId: number; today: string; onCancel: () => void }) {
  const router = useRouter();
  const version = r.version ?? 0;
  const past = r.dates.map((d) => d < today);
  const s = r.settings;
  const cap = s.capacity;

  const [edits, setEdits] = useState<Record<string, Cell>>({});
  const [added, setAdded] = useState<AddedAgent[]>([]);
  const [sel, setSel] = useState<{ mat: string; d: number } | null>(null);
  const [q, setQ] = useState("");
  const [onlyTouched, setOnlyTouched] = useState(false);
  const [motif, setMotif] = useState<EditMotif | "">("");
  const [comment, setComment] = useState("");
  const [reoptimize, setReoptimize] = useState(true);
  const [renfort, setRenfort] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const rows: Row[] = useMemo(
    () => [
      ...added.map((a) => ({ matricule: a.matricule, nom: a.nom, fonction: a.fonction, pole: a.pole ?? "", axe: a.axes?.["21h"] ?? a.axes?.["23h"] ?? "—", axes: a.axes, frozen: null, base: r.dates.map(() => HORS), added: true })),
      ...r.agents.map((a, i) => ({ matricule: a.matricule, nom: a.nom, fonction: a.fonction, pole: a.pole, axe: a.axe, axes: a.axes, frozen: a.frozen, base: r.after[i], added: a.added })),
    ],
    [r, added]
  );
  const cellOf = (row: Row, d: number) => edits[`${row.matricule}|${d}`] ?? row.base[d];
  const axesList = rows.map((x) => x.axes);
  const baseCells = rows.map((x) => x.base);
  const draftCells = rows.map((x) => x.base.map((_, d) => cellOf(x, d)));
  const perDay = r.dates.map((_, d) => {
    const b = dayCounts(axesList, baseCells, d, s);
    const a = dayCounts(axesList, draftCells, d, s);
    return { base: vehiclesOf(b, cap), draft: vehiclesOf(a, cap), counts: a };
  });
  const totalBase = r.metricsAfter.vehicles;
  const delta = perDay.reduce((t, p) => t + p.draft - p.base, 0);
  const nEdits = Object.keys(edits).length;
  const touched = new Set(Object.keys(edits).map((k) => k.split("|")[0]));

  // une modification invalide l'aperçu
  useEffect(() => setPreview(null), [edits, added, reoptimize]);

  const nq = norm(q);
  const shown = rows.filter((x) => (!onlyTouched || touched.has(x.matricule) || x.added) && (!nq || [x.nom, x.matricule, x.fonction, x.axe].some((t) => norm(t).includes(nq))));
  const wk = r.dates.map((d) => [0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay()));
  const selRow = sel ? rows.find((x) => x.matricule === sel.mat) : undefined;
  const smallGroups = r.groupsAfter.filter((g) => !past[g.dayIndex] && g.members.length <= 4);
  const fonctions = [...new Set(r.agents.map((a) => a.fonction).filter(Boolean))].sort();

  function setCell(mat: string, d: number, c: Cell | null) {
    setEdits((prev) => {
      const next = { ...prev };
      const row = rows.find((x) => x.matricule === mat)!;
      if (!c || same(c, row.base[d])) delete next[`${mat}|${d}`];
      else next[`${mat}|${d}`] = c;
      return next;
    });
  }

  async function send(save: boolean) {
    setErr(null);
    if (!motif) return setErr("Choisissez le motif de la modification.");
    const list = Object.entries(edits).map(([k, cell]) => {
      const [matricule, d] = k.split("|");
      return { matricule, dayIndex: Number(d), cell };
    });
    const usedAdded = added.filter((a) => touched.has(a.matricule));
    setBusy(save ? "save" : "preview");
    try {
      const res = await fetch(`/api/history/${optId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseVersion: version, motif, comment, edits: list, newAgents: usedAdded.map(({ axes: _a, ...x }) => x), reoptimize, save }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Opération impossible.");
      if (!save) setPreview(j);
      else {
        router.push(`/historique/${optId}?v=${j.result.version}`);
        router.refresh();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="editor">
      <div className="callout info" style={{ marginTop: 0 }}>
        <IconEye size={16} />
        <span>
          Modification de la <b>version {version}</b>. Cliquez sur une case pour la changer ; les jours passés sont figés. À l'enregistrement, une <b>version {version + 1}</b> est créée : la version actuelle reste consultable.
          {reoptimize ? " L'optimisation est relancée autour des modifications, sans toucher aux jours passés, aux cases modifiées à la main ni aux échanges déjà annoncés." : ""}
        </span>
      </div>

      <div className="toolbar" style={{ marginTop: 14 }}>
        <div className="seg-ctl">
          <button className={!onlyTouched ? "on" : ""} onClick={() => setOnlyTouched(false)}>Tous<span className="c">{rows.length}</span></button>
          <button className={onlyTouched ? "on" : ""} onClick={() => setOnlyTouched(true)}>Modifiés<span className="c">{touched.size}</span></button>
        </div>
        <div className="search grow">
          <IconSearch size={15} />
          <input type="search" placeholder="Rechercher un agent, une fonction, un axe…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn small" onClick={() => setRenfort(true)}><IconUserPlus size={14} />Ajouter un renfort</button>
      </div>

      {smallGroups.length > 0 && (
        <details className="why small-groups">
          <summary>Petits véhicules à venir (4 personnes ou moins) : {smallGroups.length}</summary>
          <div className="sg-list">
            {smallGroups.slice(0, 60).map((g) => (
              <div key={`${g.dayIndex}|${g.kind}|${g.wave}|${g.axe}`} className="sg">
                <span className="nowrap"><b>{dayLabel(g.date)}</b> · {waveLabel(g.kind, g.wave)} · {g.axe}</span>
                <span>
                  {g.members.map((m) => (
                    <button key={m.matricule} className="pill" onClick={() => { setQ(m.matricule); setSel({ mat: m.matricule, d: g.dayIndex }); }}>{m.nom}</button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {sel && selRow && (
        <CellForm
          key={`${sel.mat}|${sel.d}`}
          row={selRow}
          d={sel.d}
          r={r}
          current={cellOf(selRow, sel.d)}
          seats={seatsFor(selRow.axes, perDay[sel.d].counts, s)}
          dayDelta={perDay[sel.d].draft - perDay[sel.d].base}
          onApply={(c) => setCell(sel.mat, sel.d, c)}
          onReset={() => setCell(sel.mat, sel.d, null)}
          onClose={() => setSel(null)}
        />
      )}

      <div className="pgrid" style={{ marginTop: 12 }}>
        <table className="plan-t editable">
          <thead>
            <tr>
              <th className="sticky">Agent</th>
              {r.dates.map((d, k) => (
                <th key={d} className={(wk[k] ? "wk" : "") + (past[k] ? " past" : "")}>
                  {dayLabel(d)}
                  <div className="th-sub">{perDay[k].draft !== perDay[k].base ? <b className={perDay[k].draft > perDay[k].base ? "bad" : "good"}>{perDay[k].base} → {perDay[k].draft} véh.</b> : `${perDay[k].base} véh.`}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 300).map((row) => (
              <tr key={row.matricule}>
                <td className="sticky">
                  <b>{row.nom}</b> <span className="muted">{row.matricule}</span>
                  {row.added && <span className="frozen-tag" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}>renfort</span>}
                  {row.frozen && <span className="frozen-tag" title={row.frozen}>figé</span>}
                  <div className="muted" style={{ fontSize: 11 }}>{row.fonction || "fonction ?"}{row.pole ? ` · ${row.pole}` : ""} · {row.axe}</div>
                </td>
                {r.dates.map((_, d) => {
                  const c = cellOf(row, d);
                  const isEdit = `${row.matricule}|${d}` in edits;
                  const isSel = sel?.mat === row.matricule && sel.d === d;
                  return (
                    <td
                      key={d}
                      className={cellCls(c, s) + (wk[d] ? " wk" : "") + (isEdit ? " edit" : "") + (past[d] ? " past" : " clickable") + (isSel ? " sel" : "")}
                      onClick={() => !past[d] && setSel({ mat: row.matricule, d })}
                      title={past[d] ? "Jour passé : non modifiable" : "Modifier cette case"}
                    >
                      {isEdit && <s>{fmtShift(row.base[d]) || "—"}</s>}
                      {fmtShift(c)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > 300 && <div className="note">300 premiers agents affichés : utilisez la recherche.</div>}

      <div className="savebar editor-bar">
        <div className="eb-sum">
          <b>{nEdits}</b> case{nEdits > 1 ? "s" : ""} modifiée{nEdits > 1 ? "s" : ""} · véhicules <b>{totalBase}</b> → <b>{totalBase + delta}</b>{" "}
          {delta !== 0 && <span className={"badge " + (delta > 0 ? "warn" : "ok")}>{delta > 0 ? `+${delta}` : delta}</span>}
          <span className="muted small"> avant ré-optimisation</span>
        </div>
        <div className="eb-form">
          <select className="select" value={motif} onChange={(e) => setMotif(e.target.value as EditMotif)} aria-label="Motif">
            <option value="">Motif…</option>
            {Object.entries(EDIT_MOTIFS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="text" className="select grow" placeholder="Commentaire (facultatif)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
          <label className="chk"><input type="checkbox" checked={reoptimize} onChange={(e) => setReoptimize(e.target.checked)} />Ré-optimiser autour des modifications</label>
        </div>
        <div className="eb-actions">
          <button className="btn ghost" onClick={onCancel} disabled={!!busy}>Annuler</button>
          <button className="btn" onClick={() => send(false)} disabled={!nEdits || !!busy}>{busy === "preview" ? <span className="spinner dark" /> : <IconEye size={15} />}Aperçu</button>
          <button className="btn primary" onClick={() => send(true)} disabled={!nEdits || !!busy}>{busy === "save" ? <span className="spinner" /> : <IconCheck size={15} />}Enregistrer la version {version + 1}</button>
        </div>
        {err && <div className="callout err" style={{ marginTop: 8 }}><IconAlert size={15} /><span>{err}</span></div>}
      </div>

      {preview && <PreviewCard p={preview} current={totalBase} version={version + 1} />}

      {renfort && (
        <RenfortDialog
          optId={optId}
          fonctions={fonctions}
          onClose={() => setRenfort(false)}
          onFocus={(m) => { setQ(m); setRenfort(false); }}
          onAdd={(a) => {
            if (!rows.some((x) => x.matricule === a.matricule)) setAdded((prev) => [...prev, a]);
            setQ(a.matricule);
            const d = past.findIndex((p) => !p);
            setSel({ mat: a.matricule, d: d < 0 ? 0 : d });
            setRenfort(false);
          }}
        />
      )}
    </div>
  );
}
