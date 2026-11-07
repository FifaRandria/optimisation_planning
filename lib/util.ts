import type { Cell, Level } from "./types";

// Caractères cp1252 (0x80-0x9F) -> octet, pour défaire un texte UTF-8 lu en Latin-1/cp1252.
const CP1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

/** « CongÃ© » -> « Congé ». Ne touche pas un texte qui n'est pas du mojibake. */
export function fixMojibake(s: string): string {
  if (!/[ÃÂâ][-ÿŒ-™]/.test(s)) return s;
  const bytes: number[] = [];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c < 256) bytes.push(c);
    else if (CP1252[ch] !== undefined) bytes.push(CP1252[ch]);
    else return s;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return s;
  }
}

/** minuscule, sans accents, sans ponctuation, espaces réduits */
export function norm(s: unknown): string {
  if (s === null || s === undefined) return "";
  return fixMojibake(String(s).replace(/ /g, " "))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return fixMojibake(String(v).replace(/ /g, " ").trim());
}

/** valeur « vide » des exports : NaN, #N/A, -, « * Adresse à renseigner * » */
export function isBlank(v: unknown): boolean {
  const n = norm(v);
  return !n || n === "nan" || n === "n a" || n === "null" || n === "undefined" || n.startsWith("adresse a renseigner");
}

/** « Axe 21h », « Axe à 23h » -> "21h" / "23h" */
export function axeKey(header: unknown): string | null {
  const n = norm(header);
  if (!/^axes?\b/.test(n)) return null;
  const m = n.match(/(\d{1,2})\s?h/);
  return m ? `${parseInt(m[1], 10)}h` : null;
}

export function normMatricule(v: unknown): string {
  return str(v).toUpperCase().replace(/\s+/g, "");
}

/** Convertit une valeur de cellule Excel en minutes depuis minuit, ou null. */
export function parseTime(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    return v.getUTCHours() * 60 + v.getUTCMinutes();
  }
  if (typeof v === "number") {
    if (v >= 0 && v < 1) return Math.round(v * 1440) % 1440;
    if (v >= 1 && v <= 24 && Number.isInteger(v)) return v * 60;
    return null;
  }
  const s = String(v).trim().toLowerCase();
  let m = s.match(/^(\d{1,2})\s*[:h]\s*(\d{2})?(?:\s*:\s*\d{2})?$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const mi = m[2] ? parseInt(m[2], 10) : 0;
    if (h <= 24 && mi < 60) return h * 60 + mi;
  }
  m = s.match(/^(\d{1,2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    if (h <= 24) return h * 60;
  }
  return null;
}

export function fmtTime(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function fmtShift(c: Cell): string {
  switch (c.k) {
    case "shift":
      return `${fmtTime(c.arr)}-${fmtTime(c.dep)}`;
    case "off":
      return "OFF";
    case "leave":
      return c.raw || "CONGE";
    case "code":
      return c.raw;
    default:
      return "";
  }
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Serial Excel -> ISO. */
export function serialToIso(n: number): string {
  return isoDate(new Date(Math.round((n - 25569) * 86400000)));
}

export function isExcelDateSerial(v: unknown): v is number {
  return typeof v === "number" && v >= 36526 && v < 80000; // 2000 -> 2119
}

/** Essaie de lire une date : serial Excel, Date, "dd/mm/yyyy", "yyyy-mm-dd". */
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return isoDate(v);
  if (isExcelDateSerial(v)) return serialToIso(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** clé de semaine (lundi ISO) d'une date ISO */
export function weekKey(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // lundi = 0
  return isoDate(new Date(d.getTime() - dow * 86400000));
}

export function isWeekend(iso: string): boolean {
  const g = new Date(iso + "T00:00:00Z").getUTCDay();
  return g === 0 || g === 6;
}

export const JOURS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
export function dayLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dd = iso.slice(8, 10) + "/" + iso.slice(5, 7);
  return `${JOURS[d.getUTCDay()]} ${dd}`;
}

export function parseLevel(v: unknown): Level {
  const n = norm(v);
  if (!n) return "INCONNU";
  if (n.startsWith("perf")) return "PERF";
  if (n.startsWith("mid") || n.startsWith("moy") || n.startsWith("interm")) return "MIDLE";
  if (n.startsWith("deb") || n.startsWith("nouv") || n.startsWith("junior")) return "DEBUTANT";
  return "INCONNU";
}

export function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (v === null || v === undefined) return undefined;
  const m = String(v).replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : undefined;
}
