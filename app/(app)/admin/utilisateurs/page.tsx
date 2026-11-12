import { PageHeader } from "@/components/AppShell";
import UsersAdmin from "@/components/UsersAdmin";
import { pageUser } from "@/lib/server/auth";
import { listUsers } from "@/lib/server/users";

export const dynamic = "force-dynamic";
export const metadata = { title: "Utilisateurs · Optimiseur de transport" };

export default async function UsersPage() {
  const user = await pageUser({ admin: true });
  return (
    <div className="page">
      <PageHeader title="Utilisateurs" subtitle="Créez les comptes de l'équipe. Chaque personne reçoit un mot de passe provisoire qu'elle doit changer à sa première connexion." />
      <UsersAdmin initial={await listUsers()} meId={user.id} />
    </div>
  );
}
