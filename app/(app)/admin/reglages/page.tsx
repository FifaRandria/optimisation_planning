import Link from "next/link";
import { PageHeader } from "@/components/AppShell";
import SettingsAdmin from "@/components/SettingsAdmin";
import { pageUser } from "@/lib/server/auth";
import { getAppSettings } from "@/lib/server/app-settings";
import { SITES, SITE_IDS, siteOf } from "@/lib/sites";

export const dynamic = "force-dynamic";
export const metadata = { title: "Réglages · Optimiseur de transport" };

export default async function AdminSettingsPage({ searchParams }: { searchParams: { site?: string } }) {
  await pageUser({ admin: true });
  const site = siteOf(searchParams.site);
  const { values, userVisible } = await getAppSettings(site);
  return (
    <div className="page">
      <PageHeader
        title="Réglages par site"
        subtitle="Chaque site a ses propres valeurs par défaut et ses réglages visibles par les utilisateurs."
      />
      <nav className="site-tabs" aria-label="Site">
        {SITE_IDS.map((id) => (
          <Link key={id} href={`/admin/reglages?site=${id}`} className={"site-tab " + id + (id === site ? " on" : "")} aria-current={id === site ? "page" : undefined}>
            <b>{SITES[id].name}</b> <span>{SITES[id].place}</span>
          </Link>
        ))}
      </nav>
      <SettingsAdmin key={site} site={site} initialValues={values} initialVisible={userVisible} />
    </div>
  );
}
