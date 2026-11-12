"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { HistoryItem } from "@/lib/server/history";
import { dayLabel, norm } from "@/lib/util";
import { IconAlert, IconCalendar, IconSearch, IconTrash } from "./Icons";

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function HistoryTable({ items, isAdmin }: { items: HistoryItem[]; isAdmin: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [who, setWho] = useState("all");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const authors = useMemo(() => [...new Set(items.map((i) => i.userName ?? "Compte supprimé"))].sort(), [items]);

  const nq = norm(q);
  const shown = items.filter(
    (i) =>
      (who === "all" || (i.userName ?? "Compte supprimé") === who) &&
      (!nq || [i.label, i.userName ?? "", ...i.files].some((t) => norm(t).includes(nq)))
  );

  async function remove(i: HistoryItem) {
    if (!confirm(`Supprimer définitivement l'optimisation n° ${i.id} (${i.label}) ?`)) return;
    setBusy(i.id);
    setError(null);
    try {
      const res = await fetch(`/api/history/${i.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Suppression impossible.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0)
    return (
      <div className="card empty-state">
        <h2>Aucune optimisation enregistrée</h2>
        <p>Chaque calcul lancé depuis « Nouvelle optimisation » apparaîtra ici, avec ses fichiers Excel téléchargeables.</p>
      </div>
    );

  return (
    <div className="card">
      <div className="toolbar">
        <div className="search grow">
          <IconSearch size={15} />
          <input type="search" placeholder="Rechercher un planning, un fichier, un auteur…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {isAdmin && authors.length > 1 && (
          <select className="select" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filtrer par auteur">
            <option value="all">Tous les auteurs</option>
            {authors.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        )}
      </div>
      {error && (
        <div className="callout err" style={{ marginTop: 0, marginBottom: 12 }}>
          <IconAlert size={16} />
          <span>{error}</span>
        </div>
      )}
      <div className="count-line">{shown.length} optimisation{shown.length > 1 ? "s" : ""}</div>
      <div className="tablewrap">
        <table className="t">
          <thead>
            <tr>
              <th>N°</th>
              <th>Date</th>
              <th>Planning</th>
              {isAdmin && <th>Auteur</th>}
              <th className="c">Agents</th>
              <th className="c">Véhicules</th>
              <th className="c">Gain</th>
              <th className="c">Échanges</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => {
              const gain = i.vehiclesBefore ? (100 * (i.vehiclesBefore - i.vehiclesAfter)) / i.vehiclesBefore : 0;
              return (
                <tr key={i.id}>
                  <td className="muted">{i.id}</td>
                  <td>{fmtDateTime(i.createdAt)}</td>
                  <td>
                    <Link href={`/historique/${i.id}`} className="row-link">
                      <IconCalendar size={13} /> {i.periodStart && i.periodEnd ? `${dayLabel(i.periodStart)} → ${dayLabel(i.periodEnd)}` : i.label}
                    </Link>
                    <div className="muted small" title={i.files.join("\n")}>{i.files.length} fichier{i.files.length > 1 ? "s" : ""} · {i.files[0]}</div>
                  </td>
                  {isAdmin && <td>{i.userName ?? <span className="muted">compte supprimé</span>}</td>}
                  <td className="c">{i.agents}</td>
                  <td className="c">{i.vehiclesBefore} → <b>{i.vehiclesAfter}</b></td>
                  <td className="c"><span className="badge ok">−{gain.toFixed(1)} %</span></td>
                  <td className="c">
                    {i.swaps}
                    {i.swapsReserve > 0 && <span className="badge err" style={{ marginLeft: 6 }} title="Remplacements par la réserve, à confirmer">{i.swapsReserve} réserve</span>}
                  </td>
                  <td className="c nowrap">
                    <Link href={`/historique/${i.id}`} className="btn small">Ouvrir</Link>{" "}
                    <button className="btn small ghost danger" onClick={() => remove(i)} disabled={busy === i.id} title="Supprimer" aria-label={`Supprimer l'optimisation ${i.id}`}>
                      <IconTrash size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
