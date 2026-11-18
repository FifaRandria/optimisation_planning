import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/AppShell";
import Results from "@/components/Results";
import { IconAlert } from "@/components/Icons";
import { HttpError, pageUser } from "@/lib/server/auth";
import { getOptimization } from "@/lib/server/history";
import { getVersion, listVersions } from "@/lib/server/versions";
import { EDIT_MOTIFS } from "@/lib/types";
import { todayIso } from "@/lib/util";

export const dynamic = "force-dynamic";
export const metadata = { title: "Optimisation · Optimiseur de transport" };

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
const fmtShort = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function HistoryDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { v?: string } }) {
  const user = await pageUser();
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  let data: Awaited<ReturnType<typeof getOptimization>>;
  try {
    data = await getOptimization(user, id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    if (e instanceof HttpError)
      return (
        <div className="page">
          <div className="callout err"><IconAlert size={16} /><span>{e.message}</span></div>
        </div>
      );
    throw e;
  }
  const { item } = data;
  const versions = await listVersions(user, id);
  const latest = versions[versions.length - 1].version;
  const asked = searchParams.v === undefined ? latest : Number(searchParams.v);
  const current = versions.some((v) => v.version === asked) ? asked : latest;
  const result = current === 0 ? data.result : await getVersion(user, id, current);

  const today = todayIso();
  const finished = result.dates.every((d) => d < today);
  const reason = !item.editable
    ? "Cette optimisation date d'avant les modifications de planning : relancez-la pour pouvoir modifier son planning corrigé."
    : current !== latest
      ? `Vous consultez la version ${current}. Seule la dernière version (${latest}) peut être modifiée.`
      : finished
        ? "Cette période est terminée : le planning ne peut plus être modifié."
        : undefined;

  return (
    <div className="page">
      <div className="crumbs">
        <Link href="/historique">Historique</Link> › <span>N° {item.id}</span>
      </div>
      <PageHeader
        title={item.label}
        subtitle={
          <>
            Calculée le {fmtDateTime(item.createdAt)}
            {item.userName ? ` par ${item.userName}` : ""} · {item.agents} agents · en {(item.durationMs / 1000).toFixed(1)} s
          </>
        }
      />
      <div className="file-list">
        {item.files.map((f) => (
          <span className="file" key={f}><span className="nm">{f}</span></span>
        ))}
      </div>

      {versions.length > 1 && (
        <div className="version-bar">
          <span className="tag">Versions du planning</span>
          <div className="pills">
            {versions.map((v) => (
              <Link
                key={v.version}
                href={`/historique/${id}?v=${v.version}`}
                className={"pill" + (v.version === current ? " on" : "")}
                title={`${v.version === 0 ? "Optimisation d'origine" : `${v.motif ? EDIT_MOTIFS[v.motif] : ""}${v.comment ? ` : ${v.comment}` : ""}`} · ${fmtShort(v.createdAt)}${v.userName ? ` · ${v.userName}` : ""}`}
              >
                v{v.version}
                <span className="c">{v.vehicles} véh.</span>
                {v.version > 0 && <span className="c">{v.edits} modif.{v.reoptimized ? ` · ${v.swapsNew} éch.` : ""}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      <Results r={result} editor={{ optId: id, today, editable: !reason, reason }} />
    </div>
  );
}
