// Sites de départ / d'arrivée du transport. Partagé serveur + client.
// Chaque site a ses propres axes (fournis avec ses fichiers), ses réglages et son historique :
// une optimisation ne mélange jamais deux sites (aucun échange ni remplacement entre agents de sites différents).
import { DEFAULT_SETTINGS, type Settings } from "./types";

export type SiteId = "connecteo" | "sirius";

export interface SiteInfo {
  id: SiteId;
  name: string; // nom court (badges, listes)
  place: string; // lieu de départ du remisage / d'arrivée du ramassage
  description: string;
  coords: { lat: number; lon: number }; // position par défaut : centre du fokontany du site, ajustable sur la page Axes
  defaults: Settings; // réglages recommandés du site
  extraWaves?: { pickup: number[]; drop: number[] }; // heures proposées en plus dans les réglages des vagues
}

export const SITES: Record<SiteId, SiteInfo> = {
  connecteo: {
    id: "connecteo",
    name: "Connecteo",
    place: "Andranomena, zone Futura",
    description: "Ramassage à 6h, remisages de 18h à 23h.",
    coords: { lat: -18.85156, lon: 47.48115 }, // fokontany Andranomena (COD-AB, HDX)
    defaults: DEFAULT_SETTINGS,
  },
  sirius: {
    id: "sirius",
    name: "SIRIUS",
    place: "Galaxie Andraharo",
    description: "Shifts AM (6h–13h) et PM (13h–21h) : ramassage à 6h, remisage à 21h.",
    coords: { lat: -18.88626, lon: 47.50803 }, // fokontany Andraharo (COD-AB, HDX)
    // mêmes règles d'échange que Connecteo ; seules les vagues changent
    defaults: { ...DEFAULT_SETTINGS, pickupHours: [6], dropHours: [21], axe21Waves: [21] },
    // 13h : sortie des AM / arrivée des PM ; 11h : sortie des AM le samedi (non transportées par défaut)
    extraWaves: { pickup: [13], drop: [11, 13] },
  },
};

export const SITE_IDS = Object.keys(SITES) as SiteId[];
export const DEFAULT_SITE: SiteId = "connecteo";

export function isSiteId(v: unknown): v is SiteId {
  return typeof v === "string" && (SITE_IDS as string[]).includes(v);
}

/** Site d'une valeur reçue (formulaire, base) : site par défaut si absente ou inconnue. */
export function siteOf(v: unknown): SiteId {
  return isSiteId(v) ? v : DEFAULT_SITE;
}

export const siteLabel = (id: SiteId) => `${SITES[id].name} · ${SITES[id].place}`;
