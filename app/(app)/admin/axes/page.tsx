import Link from "next/link";
import { PageHeader } from "@/components/AppShell";
import AxesEditor from "@/components/AxesEditor";
import { pageUser } from "@/lib/server/auth";
import { getAppSettings } from "@/lib/server/app-settings";
import { getAxes, listAxesVersions } from "@/lib/server/axis-tables";
import { geocodingAvailable } from "@/lib/geo/geocode";
import { routingAvailable } from "@/lib/geo/osrm";
import { columnUse } from "@/lib/axes-map";
import { SITES, SITE_IDS, siteOf } from "@/lib/sites";

export const dynamic = "force-dynamic";
export const metadata = { title: "Axes · Optimiseur de transport" };

export default async function AxesPage({ searchParams }: { searchParams: { site?: string } }) {
  await pageUser({ admin: true });
  const site = siteOf(searchParams.site ?? "sirius");
  const [{ values }, active, versions] = await Promise.all([getAppSettings(site), getAxes(site), listAxesVersions(site)]);
  return (
    <div className="page wide">
      <PageHeader
        title="Axes par site"
        subtitle="Placez les quartiers sur la carte, fixez les contraintes, et l'application découpe les axes. La table enregistrée sert aux optimisations du site."
      />
      <nav className="site-tabs" aria-label="Site">
        {SITE_IDS.map((id) => (
          <Link key={id} href={`/admin/axes?site=${id}`} className={"site-tab " + id + (id === site ? " on" : "")} aria-current={id === site ? "page" : undefined}>
            <b>{SITES[id].name}</b> <span>{SITES[id].place}</span>
          </Link>
        ))}
      </nav>
      <AxesEditor
        key={site}
        site={site}
        colUse={columnUse(values)}
        initialDoc={active?.doc ?? null}
        versions={versions}
        services={{ routing: routingAvailable(), geocoding: geocodingAvailable() }}
        tileUrl={process.env.MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png"}
        tileAttribution={process.env.MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">les contributeurs OpenStreetMap</a>'}
      />
    </div>
  );
}
