// Réglages de l'organisation (valeurs par défaut + réglages visibles par les utilisateurs).
import { DEFAULT_SETTINGS, type Settings } from "../types";
import { ALL_SETTING_KEYS, DEFAULT_USER_VISIBLE, type PublicUser, type SettingKey, type SettingsView } from "../settings-meta";
import { q, q1 } from "./db";

interface Row {
  setting_values: Partial<Settings>;
  user_visible: SettingKey[];
}

export async function getAppSettings(): Promise<{ values: Settings; userVisible: SettingKey[] }> {
  const r = await q1<Row>(`SELECT setting_values, user_visible FROM app_settings WHERE id = 1`);
  const values = { ...DEFAULT_SETTINGS, ...(r?.setting_values ?? {}) };
  const userVisible = (r?.user_visible ?? DEFAULT_USER_VISIBLE).filter((k) => ALL_SETTING_KEYS.includes(k));
  return { values, userVisible };
}

export async function saveAppSettings(values: Settings, userVisible: SettingKey[], by: number): Promise<void> {
  const vis = [...new Set(userVisible.filter((k) => ALL_SETTING_KEYS.includes(k)))];
  await q(
    `UPDATE app_settings SET setting_values = $1, user_visible = $2, updated_at = now(), updated_by = $3 WHERE id = 1`,
    [JSON.stringify(values), JSON.stringify(vis), by]
  );
}

export async function settingsView(user: PublicUser): Promise<SettingsView> {
  const { values, userVisible } = await getAppSettings();
  return { role: user.role, values, userVisible };
}

/**
 * Réglages réellement appliqués : un admin utilise ce qu'il envoie ; un utilisateur ne peut modifier
 * que les réglages visibles pour lui, les autres prennent la valeur de l'organisation (contrôle côté serveur).
 */
export async function effectiveSettings(user: PublicUser, requested: Settings): Promise<Settings> {
  if (user.role === "admin") return requested;
  const { values, userVisible } = await getAppSettings();
  const out = { ...values };
  for (const k of userVisible) (out as Record<string, unknown>)[k] = requested[k];
  return out;
}
