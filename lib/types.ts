// Types partagés (serveur + client). Tout est sérialisable en JSON.

export type Level = "PERF" | "MIDLE" | "DEBUTANT" | "INCONNU";

/** Une case du planning (un agent, un jour). Minutes depuis minuit. */
export type Cell =
  | { k: "shift"; arr: number; dep: number } // dep peut dépasser 1440 (shift de nuit)
  | { k: "off"; raw: string }
  | { k: "leave"; raw: string }
  | { k: "code"; raw: string } // D, P, etc. : code inconnu, case figée
  | { k: "empty" };

export interface PlanningAgent {
  matricule: string;
  nom: string;
  fonction?: string; // colonne « Fonction » du planning (souvent générique : dernier recours)
  row: number; // ligne d'origine dans la feuille (1-based)
  cells: Cell[]; // une par jour
}

export interface Planning {
  sheet: string;
  file: string;
  dates: string[]; // ISO yyyy-mm-dd
  agents: PlanningAgent[];
}

export interface AgentInfo {
  matricule: string;
  nom?: string;
  communes: string[]; // candidats (colonne commune, repère, quartier…) par ordre de priorité
  niveau: Level;
  historique: number; // nb de shifts tardifs déjà faits (optionnel)
  fonction?: string; // fonction exacte (Personnes-par-fonction) : on n'échange qu'entre même fonction
  axes?: Record<string, string>; // axe donné directement par la liste : clé "21h" / "23h" -> "Axe 3"
}

export interface AxeRow {
  commune: string;
  axes: Record<string, string>; // colonne d'axe -> valeur ("Axe 3")
  chauffeurs: Record<string, string>; // colonne d'axe -> chauffeur
  duree?: number; // minutes
  distance?: number; // km
}

export interface AxeTable {
  sheet: string;
  file: string;
  rows: AxeRow[];
  axeColumns: string[];
}

export interface Amenagement {
  matricule: string;
  nom?: string;
  texte: string;
  congeDebut?: string;
  congeFin?: string;
}

export interface DetectedSource {
  role: "planning" | "agents" | "axes" | "amenagements";
  file: string;
  sheet: string;
  rows: number;
  note?: string;
}

export interface Alert {
  level: "error" | "warn" | "info";
  code: string;
  matricule?: string;
  nom?: string;
  message: string;
}

export interface ParsedInputs {
  planning?: Planning;
  agents: AgentInfo[];
  axes?: AxeTable;
  amenagements: Amenagement[];
  detection: DetectedSource[];
  alerts: Alert[];
}

export interface Settings {
  capacity: number; // places par véhicule
  minRestHours: number; // repos minimum entre 2 shifts
  pickupHours: number[]; // ramassage : arrivées à ces heures pile (ex. [6])
  dropHours: number[]; // remisage : sorties à ces heures (demi-heure => heure suivante). Une heure = une vague
  axe21Waves: number[]; // vagues (heures) qui utilisent la colonne « Axe 21h » ; les autres utilisent « Axe 23h »
  fairnessWeight: number; // poids de l'équité des shifts tardifs (0 = ignorer)
  weekendWeight: number; // poids de l'équité des week-ends OFF (échanges de jour OFF)
  maxDurationDiffMin: number; // écart de durée maxi entre 2 shifts échangés
  respectFunction: boolean; // n'échanger qu'entre agents de même fonction
  offSwap: boolean; // autoriser l'échange par paire jour travaillé <-> jour OFF dans la semaine
  unknownLevelSwappable: boolean; // les agents sans niveau peuvent s'échanger entre eux
  ignoreLevel: boolean; // ignorer complètement le niveau
}

export const DEFAULT_SETTINGS: Settings = {
  capacity: 15,
  minRestHours: 13,
  pickupHours: [6],
  dropHours: [18, 19, 20, 21, 22, 23],
  axe21Waves: [21, 22],
  fairnessWeight: 10,
  weekendWeight: 10,
  maxDurationDiffMin: 60,
  respectFunction: true,
  offSwap: true,
  unknownLevelSwappable: true,
  ignoreLevel: false,
};

export interface Member {
  matricule: string;
  nom: string;
  commune: string;
  dep: number; // heure du trajet (minutes) : sortie (remisage) ou arrivée (ramassage)
  duree?: number; // durée trajet (min)
  niveau: Level;
}

export interface Group {
  dayIndex: number;
  date: string;
  kind: "ramassage" | "remisage";
  wave: string; // "6h", "18h" … "23h"
  axe: string; // "Axe 3" ou "Sans axe"
  chauffeur?: string;
  vehicles: number;
  members: Member[];
}

export interface DayMetric {
  date: string;
  transported: number;
  vehicles: number;
  groups: number;
  pickupVehicles: number;
  dropVehicles: number;
}

export interface Metrics {
  vehicles: number;
  transported: number;
  avgPerVehicle: number;
  smallVehicles: number; // véhicules avec ≤ 4 personnes
  pickupVehicles: number;
  dropVehicles: number;
  perDay: DayMetric[];
}

export interface SwapSide {
  matricule: string;
  nom: string;
  commune: string;
  axe: string;
  niveau: Level;
  fonction: string;
  before: string; // "12:00-21:00" (échange OFF : "mar 13/10 12:00-21:00 · sam 17/10 OFF")
  after: string;
}

export interface Swap {
  id: number;
  planId: number;
  kind: "jour" | "off"; // jour = 2 shifts échangés le même jour ; off = paire jour travaillé <-> jour OFF
  dayIndex: number;
  date: string;
  dayIndex2?: number; // échange OFF : l'autre jour de la semaine
  date2?: string;
  a: SwapSide; // l'agent qui quitte le shift tardif
  b: SwapSide; // l'agent qui prend le shift tardif
  reason: string;
  planSummary: string; // ex: "Fermeture Axe 1 à 21h"
  vehiclesSaved: number; // gain du plan (répété sur chaque échange du plan)
}

export interface OptimizationResult {
  settings: Settings;
  axeColumns: string[];
  dates: string[];
  agents: { matricule: string; nom: string; niveau: Level; fonction: string; commune: string; axe: string; frozen: string | null }[];
  before: Cell[][]; // [agentIndex][day]
  after: Cell[][];
  changed: boolean[][];
  swaps: Swap[];
  groupsBefore: Group[];
  groupsAfter: Group[];
  metricsBefore: Metrics;
  metricsAfter: Metrics;
  alerts: Alert[];
  detection: DetectedSource[];
  generatedAt: string;
}
