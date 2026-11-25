// Position d'un quartier sans aucun service externe : répertoire officiel des fokontany et communes
// d'Analamanga (COD-AB Madagascar, OCHA / BNGRC, HDX, licence CC BY-IGO), généré par scripts/build-gazetteer.ts.
// Donne le point central du fokontany (ou de la commune) : assez précis pour découper des axes, pas pour une adresse.
import data from "./gazetteer-analamanga.json";
import { norm } from "../util";

interface Entry {
  level: 3 | 4; // 3 = commune, 4 = fokontany
  name: string;
  commune: string;
  district: string;
  lat: number;
  lon: number;
  n: string; // nom normalisé
  nc: string; // commune normalisée
}

export interface GazetteerHit {
  lat: number;
  lon: number;
  label: string; // « Andraharo (fokontany, 6e Arrondissement) »
  exact: boolean; // le texte entier est le nom d'un fokontany / d'une commune
}

const TANA = { lat: -18.9101, lon: 47.5255 };
// mots qui ne désignent pas un lieu (adresses malgaches : « Lot II C 94 J », « près arrêt bus »…)
const NOISE = /\b(lot|lots|bis|ter|pres|pr|arret|arrets|bus|en face|face|cite|rue|route|antananarivo|tana|madagascar|commune|fokontany|quartier|terminus|eglise|epp|pharmacie|station|marche|ecole|bloc|porte|villa|immeuble|n|no)\b/g;

// « 67 ha », « 67HA », « 67ha » s'écrivent de plusieurs façons : forme unique avant toute comparaison
// points cardinaux : les fichiers les écrivent en français, le répertoire en malgache (« 67 ha Sud » = « 67ha Atsimo »)
const CARDINAL: [RegExp, string][] = [[/\bnord est\b/g, "avaratra atsinanana"], [/\bnord ouest\b/g, "avaratra andrefana"], [/\bsud est\b/g, "atsimo atsinanana"], [/\bsud ouest\b/g, "atsimo andrefana"], [/\bnord\b/g, "avaratra"], [/\bsud\b/g, "atsimo"], [/\best\b/g, "atsinanana"], [/\bouest\b/g, "andrefana"], [/\bcentre\b/g, "afovoany"]];
const canon = (s: unknown) => CARDINAL.reduce((t, [re, r]) => t.replace(re, r), norm(s).replace(/\b67\s*ha\b/g, "67ha"));
const compact = (s: string) => s.replace(/\s+/g, "");
// mots malgaches génériques des noms de fokontany (points cardinaux, « haut / bas », « petit / grand », « nouveau »…)
const GENERIC = new Set(["atsimo", "avaratra", "atsinanana", "andrefana", "afovoany", "firaisana", "ambony", "ambany", "ambanivohitra", "kely", "vaovao", "centre", "cite", "ville", "sud", "nord", "est", "ouest"]);

const entries: Entry[] = (data.rows as [number, string, string, string, number, number, string][]).map(([level, name, commune, district, lat, lon]) => ({
  level: level as 3 | 4,
  name,
  commune,
  district,
  lat,
  lon,
  n: canon(name),
  nc: canon(commune),
}));
const byName = new Map<string, Entry[]>();
const byCompact = new Map<string, Entry[]>();
for (const e of entries) {
  if (e.n.length < 3) continue;
  byName.set(e.n, [...(byName.get(e.n) ?? []), e]);
  byCompact.set(compact(e.n), [...(byCompact.get(compact(e.n)) ?? []), e]);
}
// noms les plus longs d'abord : « ankazomanga andraharo » avant « andraharo »
const names = [...byName.keys()].sort((a, b) => b.length - a.length);

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.hypot(a.lat - b.lat, (a.lon - b.lon) * 0.946) * 111;
const label = (e: Entry) => `${e.name} (${e.level === 4 ? `fokontany, ${e.commune}` : `commune, ${e.district}`})`;

interface Cand {
  lat: number;
  lon: number;
  label: string;
  exact: boolean;
  score: number; // km jusqu'au site + pénalité selon la qualité de la correspondance
}

/** Homonymes : chacun devient un candidat ; un fokontany dont la commune est citée dans le texte est favorisé. */
function fromEntries(list: Entry[], text: string, penalty: number, exact: boolean, near: { lat: number; lon: number }): Cand[] {
  return list.map((e) => {
    const communeCited = e.level === 4 && e.nc && e.nc !== e.n && ` ${text} `.includes(` ${e.nc} `);
    return { lat: e.lat, lon: e.lon, label: label(e), exact, score: km(e, near) + penalty - (communeCited ? 3 : 0) + (e.level === 3 ? 1 : 0) };
  });
}

/** Groupe de fokontany qui partagent un début ou un mot de nom (« Manjakaray II B », « Manjakaray II C »…) : point moyen par commune. */
function fromGroup(list: Entry[], word: string, penalty: number, near: { lat: number; lon: number }): Cand[] {
  const byCommune = new Map<string, Entry[]>();
  for (const e of list) byCommune.set(e.commune, [...(byCommune.get(e.commune) ?? []), e]);
  return [...byCommune.values()].map((g) => {
    const lat = g.reduce((a, e) => a + e.lat, 0) / g.length;
    const lon = g.reduce((a, e) => a + e.lon, 0) / g.length;
    return { lat, lon, label: `${word} (${g.length} fokontany : ${g.slice(0, 3).map((e) => e.name).join(", ")}${g.length > 3 ? "…" : ""} ; ${g[0].commune})`, exact: false, score: km({ lat, lon }, near) + penalty };
  });
}

/**
 * Cherche un quartier dans le répertoire. `near` : position du site (départage les homonymes : les agents
 * habitent autour du site). On essaie le nom du quartier, puis les adresses citées si rien n'est trouvé.
 */
export function lookupPlace(texts: string[], near: { lat: number; lon: number } = TANA, maxKm = 25): GazetteerHit | null {
  for (const [i, raw] of texts.entries()) {
    const t = canon(raw);
    if (!t) continue;
    const cands: Cand[] = [];
    // 1) le texte entier, ou une de ses parties « Ambodimita - Antananarivo 6 » (aussi sans espaces : « Ambodin'isotry »)
    const parts = [t, ...String(raw).split(/\s+-\s+|,|\/|\(|\)/).map(canon)].filter((p) => p.length >= 3);
    for (const p of parts) {
      const hit = byName.get(p) ?? byCompact.get(compact(p));
      if (hit) cands.push(...fromEntries(hit, t, 0, i === 0 && p === t, near));
    }
    // 2) un nom contenu mot pour mot dans le texte (« LOT IA D 23 A ANTANETIBE ITAOSY »)
    const cleaned = t.replace(NOISE, " ").replace(/\b(?!67ha\b)[a-z]?\d+[a-z]?\b/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned.length >= 3) {
      // un nom plus court que le texte (« Morarano » dans « Morarano Firaisana ») passe après le nom complet
      const hasExact = cands.some((c) => km(c, near) <= maxKm);
      if (!hasExact) for (const n of names) if (n.length >= 4 && ` ${cleaned} `.includes(` ${n} `)) cands.push(...fromEntries(byName.get(n)!, cleaned, n === cleaned ? 0 : 8, false, near));
      // 3) début de nom (« Manjakaray » -> « Manjakaray II C ») ou mot d'un nom (« Isotry » -> « Ambalavao Isotry »)
      const words = cleaned.split(" ");
      for (let len = Math.min(3, words.length); len >= 1; len--)
        for (let k = 0; k + len <= words.length; k++) {
          const ws = words.slice(k, k + len);
          const w = ws.join(" ");
          // un mot générique seul (« atsimo », « firaisana », « kely »…) ne désigne aucun lieu
          if (w.length < 5 || ws.every((x) => GENERIC.has(x))) continue;
          const pre = entries.filter((e) => e.level === 4 && e.n.startsWith(w + " "));
          if (pre.length) cands.push(...fromGroup(pre, w, 9, near));
          const inside = entries.filter((e) => e.level === 4 && !e.n.startsWith(w + " ") && ` ${e.n} `.includes(` ${w} `));
          if (inside.length) cands.push(...fromGroup(inside, w, 12, near));
        }
    }
    const ok = cands.filter((c) => km(c, near) <= maxKm).sort((a, b) => a.score - b.score);
    if (ok.length) return { lat: ok[0].lat, lon: ok[0].lon, label: ok[0].label, exact: ok[0].exact };
  }
  return null;
}

/** Position d'un lieu-dit connu (par ex. le fokontany d'un site). */
export function placeByName(name: string): { lat: number; lon: number } | null {
  const c = byName.get(canon(name));
  return c ? { lat: c[0].lat, lon: c[0].lon } : null;
}

export const GAZETTEER_SOURCE = data.source;
