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
  pole?: string; // FO / BO / SUPPORT (IT.xlsx, colonne « Pôles »)
  actif?: boolean; // false si « Etat du collaborateur » = INACTIF
  dateDepart?: string; // ISO
  mainList?: boolean; // présent dans la liste principale des agents (source de la réserve hors planning)
  tersea?: boolean; // employé TERSEA (fonction ou rattachement) : traité comme un aménagement, jamais échangé
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
  // période de l'aménagement (colonnes « Début aménagement » / « Fin aménagement ») : sans date, il vaut toute la semaine
  debut?: string;
  fin?: string;
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
  useReserve: boolean; // remplacer un agent (semaine entière) par une personne hors planning de même fonction / pôle
  swapRoles: boolean; // aménagement de rôle seul (RENFORT DIGITAL, TEAM LEAD) : échangeable au lieu de figé
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
  useReserve: true,
  swapRoles: false,
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
  pole: string;
  before: string; // "12:00-21:00" (échange OFF : "mar 13/10 12:00-21:00 · sam 17/10 OFF")
  after: string;
}

export interface Swap {
  id: number;
  planId: number;
  // jour = 2 shifts échangés le même jour ; off = paire jour travaillé <-> jour OFF ;
  // reserve = une personne hors planning reprend toute la semaine de l'agent
  kind: "jour" | "off" | "reserve";
  dayIndex: number;
  date: string;
  dayIndex2?: number; // échange OFF : l'autre jour de la semaine
  date2?: string;
  weekDays?: number[]; // remplacement : jours de la semaine concernée
  a: SwapSide; // l'agent qui quitte le shift tardif
  b: SwapSide; // l'agent qui prend le shift tardif
  reason: string;
  planSummary: string; // ex: "Fermeture Axe 1 à 21h"
  vehiclesSaved: number; // gain du plan (répété sur chaque échange du plan)
  version?: number; // version du planning qui a proposé cet échange (absent = optimisation d'origine)
}

export interface OptimizationResult {
  settings: Settings;
  axeColumns: string[];
  dates: string[];
  agents: {
    matricule: string;
    nom: string;
    niveau: Level;
    fonction: string;
    pole: string;
    commune: string;
    axe: string;
    frozen: string | null;
    reserve?: boolean;
    added?: boolean; // ajouté à la main (renfort hors planning) dans une version
    axes?: Partial<Record<"21h" | "23h", string>>; // axe par colonne (calcul du coût d'une modification à l'écran)
  }[];
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
  historyId?: number; // id dans l'historique (base de données)
  version?: number; // 0 = optimisation d'origine, 1, 2… = versions modifiées à la main
  edits?: PlanningEdit[]; // modifications manuelles cumulées (toutes versions)
  transportChanges?: TransportChange[]; // différences de transport avec la version précédente
}

// ---------------------------------------------------------------------------
// Versions du planning corrigé (modifications manuelles après l'optimisation)
// ---------------------------------------------------------------------------

export type EditMotif = "renfort" | "absence" | "horaire" | "transport" | "autre";

export const EDIT_MOTIFS: Record<EditMotif, string> = {
  renfort: "Renfort",
  absence: "Absence / désistement",
  horaire: "Changement d'horaire",
  transport: "Ajustement transport",
  autre: "Autre",
};

/** Une case modifiée à la main, telle qu'elle est conservée dans la version. */
export interface PlanningEdit {
  version: number;
  matricule: string;
  nom: string;
  dayIndex: number;
  date: string;
  before: string; // "12:00-21:00", "OFF", "Hors planning"…
  after: string;
  motif: EditMotif;
  comment?: string;
  by?: string;
  at: string; // ISO
}

/** Une case à modifier (requête). */
export interface EditInput {
  matricule: string;
  dayIndex: number;
  cell: Cell;
}

/** Renfort absent du planning : ajouté comme nouvelle ligne. */
export interface NewAgentInput {
  matricule: string;
  nom: string;
  fonction: string;
  pole?: string;
  niveau?: Level;
  commune?: string;
  axe21?: string;
  axe23?: string;
}

export interface VersionRequest {
  baseVersion: number;
  motif: EditMotif;
  comment?: string;
  edits: EditInput[];
  newAgents?: NewAgentInput[];
  reoptimize: boolean; // proposer de nouveaux échanges autour des modifications
  save: boolean; // false = aperçu sans enregistrer
}

export interface VersionInfo {
  version: number;
  createdAt: string;
  userName: string | null;
  motif: EditMotif | null;
  comment: string;
  edits: number;
  reoptimized: boolean;
  vehicles: number;
  swapsNew: number;
}

/** Transport d'un groupe (jour × vague × axe) qui change entre deux versions. */
export interface TransportChange {
  dayIndex: number;
  date: string;
  kind: "ramassage" | "remisage";
  wave: string;
  axe: string;
  chauffeur?: string;
  vehiclesBefore: number;
  vehiclesAfter: number;
  added: string[]; // "Nom (matricule)"
  removed: string[];
}
