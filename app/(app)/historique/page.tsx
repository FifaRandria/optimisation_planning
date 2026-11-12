import Link from "next/link";
import { PageHeader } from "@/components/AppShell";
import HistoryTable from "@/components/HistoryTable";
import { IconSparkles } from "@/components/Icons";
import { pageUser } from "@/lib/server/auth";
import { listOptimizations } from "@/lib/server/history";

export const dynamic = "force-dynamic";
export const metadata = { title: "Historique · Optimiseur de transport" };

export default async function HistoryPage() {
  const user = await pageUser();
  const items = await listOptimizations(user);
  return (
    <div className="page">
      <PageHeader
        title="Historique"
        subtitle={user.role === "admin" ? "Toutes les optimisations de l'équipe." : "Vos optimisations. Un administrateur voit celles de toute l'équipe."}
        actions={
          <Link href="/optimiser" className="btn primary">
            <IconSparkles size={16} />
            Nouvelle optimisation
          </Link>
        }
      />
      <HistoryTable items={items} isAdmin={user.role === "admin"} />
    </div>
  );
}
