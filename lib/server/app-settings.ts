// Réglages par site (valeurs par défaut + réglages visibles par les utilisateurs).
import type { Settings } from "../types";
import { ALL_SETTING_KEYS, DEFAULT_USER_VISIBLE, type PublicUser, type SettingKey, type SettingsView } from "../settings-meta";
import { SITES, type SiteId } from "../sites";
import { q, q1 } from "./db";

interface Row {
  setting_values: Partial<Settings>;
  user_visible: SettingKey[];
}

export async function getAppSettings(site: SiteId): Promise<{ values: Settings; userVisible: SettingKey[] }> {
  const r = await q1<Row>(`SELECT setting_values, user_visible FROM site_settings WHERE site = $1`, [site]);
  const values = { ...SITES[site].defaults, ...(r?.setting_values ?? {}) };
  const userVisible = (r?.user_visible ?? DEFAULT_USER_VISIBLE).filter((k) => ALL_SETTING_KEYS.includes(k));
  return { values, userVisible };
}

export async function saveAppSettings(site: SiteId, values: Settings, userVisible: SettingKey[], by: number): Promise<void> {
  const vis = [...new Set(userVisible.filter((k) => ALL_SETTING_KEYS.includes(k)))];
  await q(
    `INSERT INTO site_settings (site, setting_values, user_visible, updated_at, updated_by) VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (site) DO UPDATE SET setting_values = EXCLUDED.setting_values, user_visible = EXCLUDED.user_visible,
       updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [site, JSON.stringify(values), JSON.stringify(vis), by]
  );
}

export async function settingsView(user: PublicUser, site: SiteId): Promise<SettingsView> {
  const { values, userVisible } = await getAppSettings(site);
  return { role: user.role, site, values, userVisible };
}

/** Réglages de tous les sites (écran « Nouvelle optimisation » : changer de site sans recharger la page). */
export async function allSettingsViews(user: PublicUser): Promise<Record<SiteId, SettingsView>> {
  const ids = Object.keys(SITES) as SiteId[];
  const views = await Promise.all(ids.map((id) => settingsView(user, id)));
  return Object.fromEntries(ids.map((id, i) => [id, views[i]])) as Record<SiteId, SettingsView>;
}

/**
 * Réglages réellement appliqués : un admin utilise ce qu'il envoie ; un utilisateur ne peut modifier
 * que les réglages visibles pour lui, les autres prennent la valeur du site (contrôle côté serveur).
 */
export async function effectiveSettings(user: PublicUser, site: SiteId, requested: Settings): Promise<Settings> {
  if (user.role === "admin") return requested;
  const { values, userVisible } = await getAppSettings(site);
  const out = { ...values };
  for (const k of userVisible) (out as Record<string, unknown>)[k] = requested[k];
  return out;
}
