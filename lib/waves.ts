// Vagues de transport : partagé serveur + client (aucune dépendance Node).
import type { Cell, Settings } from "./types";

export interface TransportEvent {
  kind: "ramassage" | "remisage";
  hour: number; // heure de la vague
  wave: string; // "6h", "21h"
  prefix: string; // "R6" / "D21" : préfixe de clé de groupe
  t: number; // minute du trajet (arrivée pour le ramassage, sortie pour le remisage)
}

/**
 * Transports générés par une case :
 * - ramassage : arrivée pile à une heure de `pickupHours` (6h) ;
 * - remisage : sortie arrondie à l'heure supérieure (21:30 -> 22h) dans `dropHours` (18h…23h),
 *   uniquement si le shift ne passe pas minuit (les shifts de nuit 19h->06h n'ont aucun transport).
 */
export function transportEvents(c: Cell, s: Pick<Settings, "pickupHours" | "dropHours">): TransportEvent[] {
  if (c.k !== "shift") return [];
  const out: TransportEvent[] = [];
  const crossesMidnight = c.dep > 1440;
  if (!crossesMidnight && c.arr % 60 === 0 && s.pickupHours.includes(c.arr / 60)) {
    const h = c.arr / 60;
    out.push({ kind: "ramassage", hour: h, wave: `${h}h`, prefix: `R${h}`, t: c.arr });
  }
  if (!crossesMidnight) {
    const h = Math.ceil(c.dep / 60);
    if (s.dropHours.includes(h)) out.push({ kind: "remisage", hour: h, wave: `${h}h`, prefix: `D${h}`, t: c.dep });
  }
  return out;
}

/** shift « tardif » (compteur d'équité) = shift avec remisage */
export function isLateShift(c: Cell, s: Pick<Settings, "pickupHours" | "dropHours">): boolean {
  return transportEvents(c, s).some((e) => e.kind === "remisage");
}

/** colonne d'axe utilisée pour une vague : "21h" pour les vagues de axe21Waves, sinon "23h" */
export function axeKeyForWave(hour: number, s: Pick<Settings, "axe21Waves">): "21h" | "23h" {
  return s.axe21Waves.includes(hour) ? "21h" : "23h";
}

export function waveLabel(kind: "ramassage" | "remisage", wave: string): string {
  return kind === "ramassage" ? `Ramassage ${wave}` : `Remisage ${wave}`;
}
