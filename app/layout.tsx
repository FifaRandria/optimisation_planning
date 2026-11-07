import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Optimiseur de transport des shifts",
  description: "Réduire le nombre de véhicules en échangeant les shifts entre agents, sans toucher à la couverture.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
