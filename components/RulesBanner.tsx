// Les règles appliquées par l'optimiseur (composant sans état).
import { IconBus, IconCalendar, IconShield, IconSwap, IconUsers } from "./Icons";

const RULES = [
  { ic: "indigo", icon: IconUsers, t: "Même fonction", d: "Deux agents ne s'échangent que s'ils ont exactement la même fonction (et le même pôle quand il est connu)." },
  { ic: "sky", icon: IconBus, t: "Vagues réelles", d: "Ramassage des arrivées à 6h ; remisage des sorties de 18h à 23h, une vague par heure." },
  { ic: "violet", icon: IconCalendar, t: "Axe selon la vague", d: "« Axe 21h » pour 21h et 22h ; « Axe 23h » pour 6h, 18h, 19h, 20h et 23h." },
  { ic: "amber", icon: IconSwap, t: "Échange jour ↔ OFF", d: "Par paire, dans la même semaine : chaque jour reste couvert, chacun garde ses OFF." },
  { ic: "teal", icon: IconUsers, t: "Réserve hors planning", d: "Une personne non planifiée, de même fonction et même pôle, peut reprendre la semaine d'un agent." },
  { ic: "indigo", icon: IconShield, t: "Aménagements des 2 personnes", d: "Avant chaque échange : si l'une des deux a un aménagement, l'échange est refusé. Les congés bloquent leurs jours." },
] as const;

export default function RulesBanner() {
  return (
    <section className="rules" aria-label="Règles appliquées">
      {RULES.map((r) => (
        <div className="rule" key={r.t}>
          <span className={"ic " + r.ic}><r.icon size={18} /></span>
          <div>
            <h4>{r.t}</h4>
            <p>{r.d}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
