import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/AppShell";
import Results from "@/components/Results";
import { IconAlert } from "@/components/Icons";
import { HttpError, pageUser } from "@/lib/server/auth";
import { getOptimization } from "@/lib/server/history";

export const dynamic = "force-dynamic";
export const metadata = { title: "Optimisation · Optimiseur de transport" };

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });

export default async function HistoryDetailPage({ params }: { params: { id: string } }) {
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
  const { item, result } = data;
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
      <Results r={result} />
    </div>
  );
}
