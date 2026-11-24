import OptimizeView from "@/components/OptimizeView";
import { pageUser } from "@/lib/server/auth";
import { allSettingsViews } from "@/lib/server/app-settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouvelle optimisation · Optimiseur de transport" };

export default async function OptimiserPage() {
  const user = await pageUser();
  return <OptimizeView views={await allSettingsViews(user)} />;
}
