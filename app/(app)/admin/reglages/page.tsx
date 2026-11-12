import { PageHeader } from "@/components/AppShell";
import SettingsAdmin from "@/components/SettingsAdmin";
import { pageUser } from "@/lib/server/auth";
import { getAppSettings } from "@/lib/server/app-settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Réglages · Optimiseur de transport" };

export default async function AdminSettingsPage() {
  await pageUser({ admin: true });
  const { values, userVisible } = await getAppSettings();
  return (
    <div className="page">
      <PageHeader
        title="Réglages de l'organisation"
        subtitle="Valeurs appliquées par défaut à chaque optimisation, et réglages que les utilisateurs peuvent voir et modifier."
      />
      <SettingsAdmin initialValues={values} initialVisible={userVisible} />
    </div>
  );
}
