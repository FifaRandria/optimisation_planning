// Métadonnées des réglages : groupes, libellés et visibilité par défaut pour les utilisateurs.
// Partagé serveur + client.
import type { Settings } from "./types";

export type SettingKey = keyof Settings;

export interface SettingGroup {
  id: string;
  label: string;
  keys: { key: SettingKey; label: string }[];
}

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: "vagues",
    label: "Vagues de transport",
    keys: [
      { key: "pickupHours", label: "Heures de ramassage" },
      { key: "dropHours", label: "Heures de remisage" },
      { key: "axe21Waves", label: "Vagues utilisant « Axe 21h »" },
    ],
  },
  {
    id: "vehicules",
    label: "Véhicules et limites",
    keys: [
      { key: "capacity", label: "Places par véhicule" },
      { key: "minRestHours", label: "Repos minimum" },
      { key: "maxDurationDiffMin", label: "Écart de durée max" },
    ],
  },
  {
    id: "regles",
    label: "Règles d'échange",
    keys: [
      { key: "respectFunction", label: "Même fonction uniquement" },
      { key: "offSwap", label: "Échange jour travaillé ↔ jour OFF" },
      { key: "useReserve", label: "Remplacement par la réserve hors planning" },
      { key: "swapRoles", label: "Rôles seuls échangeables" },
    ],
  },
  {
    id: "equite",
    label: "Équité",
    keys: [
      { key: "fairnessWeight", label: "Équité des shifts tardifs" },
      { key: "weekendWeight", label: "Équité des week-ends OFF" },
    ],
  },
  {
    id: "niveau",
    label: "Niveau des agents",
    keys: [
      { key: "unknownLevelSwappable", label: "Échanger les agents sans niveau" },
      { key: "ignoreLevel", label: "Ignorer le niveau" },
    ],
  },
];

export const ALL_SETTING_KEYS: SettingKey[] = SETTING_GROUPS.flatMap((g) => g.keys.map((k) => k.key));

/** Par défaut, les utilisateurs voient les vagues et les véhicules ; règles d'échange, équité et niveau sont réservés aux admins. */
export const DEFAULT_USER_VISIBLE: SettingKey[] = ["pickupHours", "dropHours", "axe21Waves", "capacity", "minRestHours", "maxDurationDiffMin"];

export type Role = "admin" | "user";

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
}

/** Réglages tels que vus par la personne connectée. */
export interface SettingsView {
  role: Role;
  values: Settings; // valeurs par défaut de l'organisation
  userVisible: SettingKey[]; // réglages visibles et modifiables par les utilisateurs
}
