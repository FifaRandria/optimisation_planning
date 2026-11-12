"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PublicUser } from "@/lib/settings-meta";
import { IconBook, IconBus, IconGear, IconHistory, IconHome, IconKey, IconLogout, IconSparkles, IconUsers } from "./Icons";

const NAV = [
  { href: "/", label: "Tableau de bord", icon: IconHome },
  { href: "/optimiser", label: "Nouvelle optimisation", icon: IconSparkles },
  { href: "/historique", label: "Historique", icon: IconHistory },
  { href: "/guide", label: "Guide des fichiers", icon: IconBook },
];
const ADMIN_NAV = [
  { href: "/admin/utilisateurs", label: "Utilisateurs", icon: IconUsers },
  { href: "/admin/reglages", label: "Réglages", icon: IconGear },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export default function AppShell({ user, children }: { user: PublicUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const mustChange = user.mustChangePassword;

  // première connexion : le changement de mot de passe est obligatoire avant tout le reste
  useEffect(() => {
    if (mustChange && pathname !== "/compte") router.replace("/compte");
  }, [mustChange, pathname, router]);

  async function logout() {
    setLeaving(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  }

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const link = (n: (typeof NAV)[number]) => (
    <Link key={n.href} href={n.href} className={"nav-link" + (isActive(n.href) ? " on" : "")} aria-current={isActive(n.href) ? "page" : undefined}>
      <n.icon size={17} />
      <span>{n.label}</span>
    </Link>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="side-brand">
          <span className="logo"><IconBus size={19} /></span>
          <span>
            <b>Optimiseur</b>
            <small>Transport des shifts</small>
          </span>
        </Link>
        {!mustChange && (
          <nav className="side-nav" aria-label="Navigation principale">
            {NAV.map(link)}
            {user.role === "admin" && (
              <>
                <div className="nav-section">Administration</div>
                {ADMIN_NAV.map(link)}
              </>
            )}
          </nav>
        )}
        <div className="side-user">
          <span className="avatar">{initials(user.displayName)}</span>
          <span className="who">
            <b title={user.displayName}>{user.displayName}</b>
            <small>{user.username} · {user.role === "admin" ? "Administrateur" : "Utilisateur"}</small>
          </span>
          <div className="side-actions">
            <Link href="/compte" className={"icon-btn" + (pathname === "/compte" ? " on" : "")} title="Mon compte / mot de passe" aria-label="Mon compte">
              <IconKey size={16} />
            </Link>
            <button className="icon-btn" onClick={logout} disabled={leaving} title="Se déconnecter" aria-label="Se déconnecter">
              <IconLogout size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">{mustChange && pathname !== "/compte" ? null : children}</main>
    </div>
  );
}

/** En-tête de page : titre, sous-titre et actions à droite. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
