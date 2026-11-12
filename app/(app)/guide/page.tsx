import { PageHeader } from "@/components/AppShell";
import FormatGuide from "@/components/FormatGuide";
import RulesBanner from "@/components/RulesBanner";

export const metadata = { title: "Guide des fichiers · Optimiseur de transport" };

export default function GuidePage() {
  return (
    <div className="page">
      <PageHeader title="Guide" subtitle="Les règles appliquées par l'optimiseur, et le format attendu pour chaque fichier Excel." />
      <h2 className="section-title">Règles appliquées</h2>
      <RulesBanner />
      <h2 className="section-title">Fichiers à déposer</h2>
      <FormatGuide open />
    </div>
  );
}
