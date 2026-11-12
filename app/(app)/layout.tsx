import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import SetupError from "@/components/SetupError";
import { currentUser } from "@/lib/server/auth";
import type { PublicUser } from "@/lib/settings-meta";

export const dynamic = "force-dynamic";

/** Toutes les pages de l'application exigent une session valide. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user: PublicUser | null;
  try {
    user = await currentUser();
  } catch (e) {
    return <SetupError message={(e as Error).message} />;
  }
  if (!user) redirect("/login");
  return <AppShell user={user}>{children}</AppShell>;
}
