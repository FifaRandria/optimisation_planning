import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import SetupError from "@/components/SetupError";
import { currentUser } from "@/lib/server/auth";
import { ensureSchema } from "@/lib/server/db";
import type { PublicUser } from "@/lib/settings-meta";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connexion · Optimiseur de transport" };

export default async function LoginPage() {
  let user: PublicUser | null;
  try {
    await ensureSchema(); // crée les tables et l'admin initial au premier lancement
    user = await currentUser();
  } catch (e) {
    return <SetupError message={(e as Error).message} />;
  }
  if (user) redirect("/");
  return <LoginForm />;
}
