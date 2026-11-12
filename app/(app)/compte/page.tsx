import { PageHeader } from "@/components/AppShell";
import AccountForm from "@/components/AccountForm";
import { pageUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mon compte · Optimiseur de transport" };

export default async function AccountPage() {
  const user = await pageUser();
  return (
    <div className="page narrow">
      <PageHeader title="Mon compte" subtitle={`${user.displayName} · identifiant « ${user.username} » · ${user.role === "admin" ? "administrateur" : "utilisateur"}`} />
      <AccountForm mustChange={user.mustChangePassword} />
    </div>
  );
}
