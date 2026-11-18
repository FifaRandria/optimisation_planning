// Coût transport d'un état du planning, calculé à l'écran pendant les modifications (même règle que l'optimiseur :
// un groupe = une vague + un axe ; véhicules = ⌈ personnes ÷ capacité ⌉ ; un agent sans axe = un véhicule à lui seul).
import type { Cell, Settings } from "./types";
import { axeKeyForWave, transportEvents } from "./waves";

export type AgentAxes = Partial<Record<"21h" | "23h", string>> | undefined;
type CostSettings = Pick<Settings, "pickupHours" | "dropHours" | "axe21Waves" | "capacity">;

/** Personnes par groupe (« R6|Axe 3 », « D21|Axe 7 »…), pour un jour. */
export function dayCounts(axes: AgentAxes[], cells: Cell[][], d: number, s: CostSettings): Map<string, number> {
  const m = new Map<string, number>();
  cells.forEach((row, i) => {
    for (const e of transportEvents(row[d], s)) {
      const axe = axes[i]?.[axeKeyForWave(e.hour, s)];
      const k = `${e.prefix}|${axe ?? "?" + i}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  });
  return m;
}

export function vehiclesOf(counts: Map<string, number>, capacity: number): number {
  const cap = Math.max(1, Math.floor(capacity));
  let v = 0;
  for (const n of counts.values()) v += Math.ceil(n / cap);
  return v;
}

export interface Seat {
  kind: "ramassage" | "remisage";
  hour: number;
  axe: string;
  people: number;
  vehicles: number;
  free: number; // places libres dans les véhicules déjà prévus
}

/** Véhicules prévus ce jour sur les axes de l'agent, avec les places libres (pour placer un renfort sans coût). */
export function seatsFor(agentAxes: AgentAxes, counts: Map<string, number>, s: CostSettings): Seat[] {
  if (!agentAxes) return [];
  const cap = Math.max(1, Math.floor(s.capacity));
  const out: Seat[] = [];
  const waves: [Seat["kind"], number][] = [...s.pickupHours.map((h) => ["ramassage", h] as [Seat["kind"], number]), ...s.dropHours.map((h) => ["remisage", h] as [Seat["kind"], number])];
  for (const [kind, hour] of waves) {
    const axe = agentAxes[axeKeyForWave(hour, s)];
    if (!axe) continue;
    const n = counts.get(`${kind === "ramassage" ? "R" : "D"}${hour}|${axe}`) ?? 0;
    if (!n) continue;
    const vehicles = Math.ceil(n / cap);
    out.push({ kind, hour, axe, people: n, vehicles, free: vehicles * cap - n });
  }
  return out;
}
