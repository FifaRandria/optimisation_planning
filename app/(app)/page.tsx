import Link from "next/link";
import { PageHeader } from "@/components/AppShell";
import { IconArrowRight, IconBus, IconCalendar, IconHistory, IconSparkles, IconSwap, IconUsers } from "@/components/Icons";
import { pageUser } from "@/lib/server/auth";
import { dashboard, type HistoryItem } from "@/lib/server/history";
import { dayLabel } from "@/lib/util";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tableau de bord · Optimiseur de transport" };

const fmt = (n: number) => n.toLocaleString("fr-FR");
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const gainPct = (i: HistoryItem) => (i.vehiclesBefore ? (100 * (i.vehiclesBefore - i.vehiclesAfter)) / i.vehiclesBefore : 0);

/** Histogramme avant / après (SVG, sans librairie). */
function BeforeAfterChart({ series }: { series: { id: number; label: string; date: string; before: number; after: number }[] }) {
  const W = 640;
  const H = 220;
  const pad = { l: 36, r: 8, t: 12, b: 34 };
  const max = Math.max(1, ...series.map((s) => s.before));
  const step = (W - pad.l - pad.r) / series.length;
  const bw = Math.min(18, step / 3);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Véhicules avant et après, par optimisation">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="tick">{t}</text>
        </g>
      ))}
      {series.map((s, i) => {
        const cx = pad.l + step * i + step / 2;
        return (
          <g key={s.id}>
            <title>{`${s.label} : ${s.before} → ${s.after} véhicules`}</title>
            <rect x={cx - bw - 1} y={y(s.before)} width={bw} height={y(0) - y(s.before)} rx={3} className="b-before" />
            <rect x={cx + 1} y={y(s.after)} width={bw} height={y(0) - y(s.after)} rx={3} className="b-after" />
            <text x={cx} y={H - pad.b + 16} textAnchor="middle" className="tick">{new Date(s.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default async function DashboardPage() {
  const user = await pageUser();
  const d = await dashboard(user);
  const isAdmin = user.role === "admin";
  const totalSwaps = d.swaps.jour + d.swaps.off + d.swaps.reserve;
  const first = user.displayName.split(" ")[0];

  return (
    <div className="page">
      <PageHeader
        title={`Bonjour ${first}`}
        subtitle={isAdmin ? "Vue d'ensemble de toutes les optimisations de l'équipe." : "Vue d'ensemble de vos optimisations."}
        actions={
          <Link href="/optimiser" className="btn primary">
            <IconSparkles size={16} />
            Nouvelle optimisation
          </Link>
        }
      />

      {d.runs === 0 ? (
        <div className="card empty-state">
          <span className="bigic"><IconSparkles size={26} /></span>
          <h2>Aucune optimisation pour le moment</h2>
          <p>Déposez le planning S+1 et la liste des agents : l'optimiseur propose les échanges qui réduisent le nombre de véhicules, et chaque calcul est enregistré ici.</p>
          <div className="row-actions">
            <Link href="/optimiser" className="btn primary"><IconSparkles size={16} />Lancer une optimisation</Link>
            <Link href="/guide" className="btn">Voir le guide des fichiers</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="kpis dash-kpis">
            <div className="kpi">
              <div className="lbl"><IconHistory size={13} />Optimisations</div>
              <div className="val">{fmt(d.runs)}</div>
              <div className="sub">dernière : {d.lastRunAt ? fmtDateTime(d.lastRunAt) : "—"}</div>
            </div>
            <div className="kpi accent">
              <div className="lbl"><IconBus size={13} />Véhicules économisés</div>
              <div className="val">−{fmt(d.vehiclesSaved)}</div>
              <div className="sub">sur {fmt(d.vehiclesBefore)} véhicules prévus au départ</div>
            </div>
            <div className="kpi">
              <div className="lbl"><IconSparkles size={13} />Gain moyen</div>
              <div className="val">{d.avgGainPct.toFixed(1)} %</div>
              <div className="sub">de véhicules en moins par planning</div>
            </div>
            <div className="kpi">
              <div className="lbl"><IconSwap size={13} />Échanges proposés</div>
              <div className="val">{fmt(totalSwaps)}</div>
              <div className="sub">{fmt(d.swaps.off)} jour OFF · {fmt(d.swaps.reserve)} réserve</div>
            </div>
          </div>

          <div className="dash-grid">
            <section className="card">
              <div className="card-head" style={{ marginBottom: 6 }}>
                <h2>Véhicules avant / après</h2>
                <div className="legend">
                  <span><i style={{ background: "var(--before)" }} />Avant</span>
                  <span><i style={{ background: "var(--accent)" }} />Après</span>
                </div>
              </div>
              <p className="muted small">Les {d.series.length} dernières optimisations, de la plus ancienne à la plus récente.</p>
              <BeforeAfterChart series={d.series} />
            </section>

            <section className="card">
              <h2>Types d'échanges</h2>
              <p className="muted small">Répartition de tous les échanges proposés.</p>
              <div className="stack-bar" aria-hidden="true">
                {totalSwaps > 0 && (
                  <>
                    <i style={{ width: `${(100 * d.swaps.jour) / totalSwaps}%`, background: "var(--primary)" }} />
                    <i style={{ width: `${(100 * d.swaps.off) / totalSwaps}%`, background: "var(--warn)" }} />
                    <i style={{ width: `${(100 * d.swaps.reserve) / totalSwaps}%`, background: "var(--accent)" }} />
                  </>
                )}
              </div>
              <ul className="kv">
                <li><span><i className="dot" style={{ background: "var(--primary)" }} />Même jour</span><b>{fmt(d.swaps.jour)}</b></li>
                <li><span><i className="dot" style={{ background: "var(--warn)" }} />Jour OFF</span><b>{fmt(d.swaps.off)}</b></li>
                <li><span><i className="dot" style={{ background: "var(--accent)" }} />Réserve hors planning</span><b>{fmt(d.swaps.reserve)}</b></li>
              </ul>
              {isAdmin && d.users && (
                <>
                  <h2 style={{ marginTop: 22 }}>Comptes</h2>
                  <ul className="kv">
                    <li><span>Comptes actifs</span><b>{d.users.active} / {d.users.total}</b></li>
                    <li><span>Administrateurs</span><b>{d.users.admins}</b></li>
                    <li><span>Mot de passe provisoire non changé</span><b>{d.users.pendingPassword}</b></li>
                  </ul>
                  <Link href="/admin/utilisateurs" className="text-link">Gérer les utilisateurs <IconArrowRight size={14} /></Link>
                </>
              )}
            </section>
          </div>

          <section className="card">
            <div className="card-head">
              <h2>Dernières optimisations</h2>
              <Link href="/historique" className="text-link">Tout l'historique <IconArrowRight size={14} /></Link>
            </div>
            <div className="tablewrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Planning</th>
                    {isAdmin && <th>Auteur</th>}
                    <th className="c">Véhicules</th>
                    <th className="c">Gain</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.recent.map((i) => (
                    <tr key={i.id}>
                      <td>{fmtDateTime(i.createdAt)}</td>
                      <td>
                        <IconCalendar size={13} /> {i.periodStart ? `${dayLabel(i.periodStart)} → ${dayLabel(i.periodEnd!)}` : i.label}
                      </td>
                      {isAdmin && <td>{i.userName ?? <span className="muted">compte supprimé</span>}</td>}
                      <td className="c">{i.vehiclesBefore} → <b>{i.vehiclesAfter}</b></td>
                      <td className="c"><span className="badge ok">−{gainPct(i).toFixed(1)} %</span></td>
                      <td className="c"><Link href={`/historique/${i.id}`} className="text-link">Ouvrir</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {isAdmin && d.perUser.length > 1 && (
            <section className="card">
              <h2><IconUsers size={17} /> Par utilisateur</h2>
              <div className="tablewrap" style={{ marginTop: 12 }}>
                <table className="t">
                  <thead>
                    <tr>
                      <th>Utilisateur</th>
                      <th className="c">Optimisations</th>
                      <th className="c">Véhicules économisés</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.perUser.map((u) => (
                      <tr key={u.name}>
                        <td>{u.name}</td>
                        <td className="c">{u.runs}</td>
                        <td className="c">−{fmt(u.saved)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <p className="muted small" style={{ marginTop: 14 }}>Chiffres calculés à partir de l'historique enregistré{isAdmin ? " de toute l'équipe" : ""}.</p>
        </>
      )}
    </div>
  );
}
