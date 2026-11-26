// Fichier de test de la page « Axes » (carte) + mesure de fiabilité.
// Usage : npx tsx scripts/test-fichier-axes.ts [site, défaut sirius]
//
// 1) Écrit docs/fichiers-test/axes-carte/test-axes-<site>.xlsx : une liste d'agents FICTIFS dont les quartiers
//    sont de VRAIS fokontany autour du site, écrits de façon « sale » comme dans les fichiers réels
//    (« Lot II C 94 J … », minuscules, « - Antananarivo 4 », Sud/Nord au lieu d'Atsimo/Avaratra, nom tronqué),
//    plus quelques quartiers INVENTÉS (qui ne doivent pas être placés). Feuille « Vérité » : la bonne réponse.
// 2) Rejoue ce que fait la page (lecture du fichier, placement par le répertoire des fokontany, calcul des axes
//    en mode estimation) et mesure la fiabilité en pourcentage.
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import data from "../lib/geo/gazetteer-analamanga.json";
import { lookupPlace } from "../lib/geo/gazetteer";
import { readPoints } from "../lib/axes-input";
import { buildAxes, haversineKm, type Direction } from "../lib/axes-builder";
import { durationMatrix } from "../lib/geo/osrm";
import { SITES, siteOf } from "../lib/sites";
import { norm } from "../lib/util";

const site = siteOf(process.argv[2] ?? "sirius");
const S = SITES[site].coords;
const OUT_DIR = path.join(__dirname, "..", "docs", "fichiers-test", "axes-carte");
const OUT = path.join(OUT_DIR, `test-axes-${site}.xlsx`);

let seed = 2026;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

// ---------------------------------------------------------------------------
// 1) Quartiers : 60 vrais fokontany à moins de 15 km du site, répartis sur toute la zone
// ---------------------------------------------------------------------------
type Row = [number, string, string, string, number, number, string];
const rows = (data.rows as Row[]).filter((r) => r[0] === 4 && haversineKm(S, { lat: r[4], lon: r[5] }) <= 15);
rows.sort((a, b) => a[6].localeCompare(b[6]));
const step = rows.length / 52;
const evenly = Array.from({ length: 52 }, (_, i) => rows[Math.floor(i * step)]);
// + 8 fokontany dont le nom contient un point cardinal (pour tester « 67 ha Sud » -> « 67ha Atsimo »)
const withCardinal = rows.filter((r) => /Atsimo|Avaratra|Atsinanana|Andrefana/i.test(r[1]) && !evenly.includes(r));
const chosen = [...evenly, ...withCardinal.filter((_, i) => i % Math.max(1, Math.floor(withCardinal.length / 8)) === 0).slice(0, 8)];

const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
const FR: [RegExp, string][] = [[/Atsimo/i, "Sud"], [/Avaratra/i, "Nord"], [/Atsinanana/i, "Est"], [/Andrefana/i, "Ouest"]];
type Variant = "exact" | "lot" | "minuscules" | "arrondissement" | "francais" | "tronque";
const VARIANTS: Variant[] = ["exact", "lot", "minuscules", "arrondissement", "francais", "tronque"];

function write(name: string, v: Variant): { text: string; v: Variant } {
  switch (v) {
    case "exact":
      return { text: name, v };
    case "lot":
      return { text: `Lot ${pick(ROMAN)} ${pick(["A", "B", "C", "F", "J"])} ${10 + Math.floor(rnd() * 300)} ${pick(["", "Bis ", "Ter "])}${name}`, v };
    case "minuscules":
      return { text: norm(name), v };
    case "arrondissement":
      return { text: `${name} - Antananarivo ${1 + Math.floor(rnd() * 6)}`, v };
    case "francais": {
      const fr = FR.find(([re]) => re.test(name));
      return fr ? { text: name.replace(fr[0], fr[1]), v } : { text: `Près arrêt bus ${name}`, v: "lot" };
    }
    case "tronque": {
      // « Manjakaray IIb » -> « Manjakaray » (on enlève le dernier mot quand il y en a plusieurs)
      const w = name.split(" ");
      return w.length > 1 && w[0].length >= 5 ? { text: w.slice(0, -1).join(" "), v } : { text: name, v: "exact" };
    }
  }
}

// quartiers inventés : aucun de leurs mots n'existe dans le répertoire (ils ne doivent pas être placés)
const allWords = new Set((data.rows as Row[]).flatMap((r) => norm(r[1]).split(" ")));
const FAKE_CANDIDATES = ["Vohitrafeno Ambony", "Antsahakelinjo Vaovao", "Ambodirofiana Kely", "Mahatsaravelo Ivelany", "Tanambaovaozo Fiadanana", "Ankazovolotra Atsimo", "Morafenokely Vaovao", "Ambohimiorika Ambony"];
const fakes = FAKE_CANDIDATES.filter((f) => norm(f).split(" ").every((w) => w.length < 5 || !allWords.has(w))).slice(0, 6);

interface Truth {
  text: string;
  official: string | null;
  commune: string;
  lat: number | null;
  lon: number | null;
  variant: Variant | "invente";
}
// noms avec un point cardinal malgache (Atsimo, Avaratra…) : écrits en français (« Sud », « Nord »…)
let cardinals = 0;
const truth: Truth[] = chosen.map((r, i) => {
  const isCardinal = FR.some(([re]) => re.test(r[1])) && cardinals++ < 8;
  const w = write(r[1], isCardinal ? "francais" : VARIANTS.filter((v) => v !== "francais")[i % (VARIANTS.length - 1)]);
  return { text: w.text, official: r[1], commune: r[2], lat: r[4], lon: r[5], variant: w.v };
});
fakes.forEach((f) => truth.push({ text: f, official: null, commune: "", lat: null, lon: null, variant: "invente" }));
// deux écritures différentes ne doivent pas tomber sur la même clé de quartier
const seen = new Set<string>();
const quartiers = truth.filter((t) => !seen.has(norm(t.text)) && seen.add(norm(t.text)));

// ---------------------------------------------------------------------------
// 2) Agents fictifs : 1 à 5 par quartier
// ---------------------------------------------------------------------------
const PRENOMS = ["Tiana", "Hery", "Lova", "Fanja", "Mialy", "Tojo", "Rado", "Nirina", "Sitraka", "Fitia", "Mamy", "Haja", "Volana", "Andry", "Soa", "Toky"];
const NOMS = ["RAKOTO", "RABE", "RASOA", "RANDRIA", "RAZAFY", "RALAI", "RAVELO", "RASOLO"];
const POINTS = ["Arrêt bus", "Pharmacie", "EPP", "Station Jovena", "Église FJKM", "Terminus", "Marché"];
const agents: { mat: string; nom: string; fonction: string; quartier: string; point: string }[] = [];
let k = 1;
for (const q of quartiers) {
  const n = 1 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++)
    agents.push({
      mat: `TS${String(k++).padStart(5, "0")}`,
      nom: `${pick(NOMS)} ${pick(PRENOMS)}`,
      fonction: pick(["CSA Certification Mvola", "CSA Back Office Mvola"]),
      quartier: q.text,
      point: `${pick(POINTS)} ${q.official ?? q.text}`,
    });
}

async function writeWorkbook() {
  const wb = new ExcelJS.Workbook();
  const head = (ws: ExcelJS.Worksheet) => (ws.getRow(1).font = { bold: true });
  const a = wb.addWorksheet("Agents");
  a.addRow(["Matricule", "Nom et prénom", "Fonction", "Quartier", "Point de remisage/ramassage"]);
  head(a);
  [12, 26, 26, 44, 40].forEach((w, i) => (a.getColumn(i + 1).width = w));
  agents.forEach((x) => a.addRow([x.mat, x.nom, x.fonction, x.quartier, x.point]));
  // la feuille « Vérité » n'a pas de colonne Quartier / Commune : la page Axes l'ignore
  const v = wb.addWorksheet("Vérité");
  v.addRow(["Texte du fichier", "Fokontany officiel attendu", "Dans la commune", "Lat attendue", "Lon attendue", "Type d'écriture"]);
  head(v);
  [44, 32, 24, 12, 12, 18].forEach((w, i) => (v.getColumn(i + 1).width = w));
  quartiers.forEach((t) => v.addRow([t.text, t.official ?? "(inventé : ne doit pas être placé)", t.commune, t.lat, t.lon, t.variant]));
  const r = wb.addWorksheet("LISEZ-MOI");
  r.getColumn(1).width = 120;
  [
    `Fichier de test de la page « Axes » — site ${SITES[site].name} (${SITES[site].place}). Généré par scripts/test-fichier-axes.ts.`,
    "Agents et matricules INVENTÉS. Les quartiers sont de vrais fokontany (répertoire COD-AB, HDX) à moins de 15 km du site,",
    "écrits de plusieurs façons, plus quelques quartiers inventés qui doivent rester « à placer ».",
    "Utilisation : Administration › Axes › onglet du site › Déposer un fichier… (ce fichier).",
    "La feuille « Vérité » donne, pour chaque quartier, le fokontany et la position attendus.",
  ].forEach((l, i) => (r.getCell(i + 1, 1).value = l));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const buffer = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  fs.writeFileSync(OUT, buffer);
  return buffer;
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : "—");

async function main() {
  const buffer = await writeWorkbook();
  console.log(`Fichier écrit : ${OUT}\n${quartiers.length} quartiers (${fakes.length} inventés), ${agents.length} agents fictifs.\n`);

  // -- A. lecture du fichier (comme la page) ----------------------------------------------
  const { points, warnings } = readPoints([{ name: path.basename(OUT), buffer }]);
  if (warnings.length) console.log("Avertissements :", warnings);
  const byKey = new Map(quartiers.map((q) => [norm(q.text), q]));

  // -- B. placement par le répertoire (comme la page, sans géocodage installé) -------------
  const TOL_KM = 1.5; // taille d'un fokontany en ville : au-delà, le point est faux
  const TOL_TRONQUE_KM = 2.5; // nom tronqué : point moyen d'un groupe de fokontany voisins
  const stats = new Map<string, { n: number; ok: number }>();
  const add = (k2: string, ok: boolean) => {
    const s = stats.get(k2) ?? { n: 0, ok: 0 };
    s.n++;
    if (ok) s.ok++;
    stats.set(k2, s);
  };
  let realAgents = 0;
  let agentsOk = 0;
  let fakePlaced = 0;
  const errors: string[] = [];
  const found: (null | { lat: number; lon: number })[] = [];
  const errKm: number[] = [];
  for (const p of points) {
    const t = byKey.get(norm(p.key))!;
    const hit = lookupPlace([p.key, ...p.hints], S);
    found.push(hit);
    if (t.variant === "invente") {
      if (hit) {
        fakePlaced++;
        errors.push(`inventé placé à tort : « ${p.key} » → ${hit.label}`);
      }
      continue;
    }
    realAgents += p.agents;
    const d = hit ? haversineKm(hit, { lat: t.lat!, lon: t.lon! }) : Infinity;
    const ok = d <= (t.variant === "tronque" ? TOL_TRONQUE_KM : TOL_KM);
    if (hit) errKm.push(d);
    add(t.variant, ok);
    add("TOTAL", ok);
    const homonyms = (data.rows as Row[]).filter((r) => r[0] === 4 && norm(r[1]) === norm(t.official!) && haversineKm(S, { lat: r[4], lon: r[5] }) <= 25).length;
    add(homonyms > 1 ? "~ avec homonyme" : "~ nom unique", ok);
    if (ok) agentsOk += p.agents;
    else errors.push(`${t.variant} : « ${p.key} » → ${hit ? `${hit.label} à ${d.toFixed(1)} km du bon fokontany (${t.official})` : "non trouvé"}`);
  }
  errKm.sort((a, b) => a - b);

  console.log("A. PLACEMENT DES QUARTIERS (répertoire officiel des fokontany, hors ligne)");
  for (const [k2, s] of [...stats.entries()].sort((a, b) => (a[0] === "TOTAL" ? 1 : b[0] === "TOTAL" ? -1 : a[0].localeCompare(b[0]))))
    console.log(`   ${k2.padEnd(15)} ${String(s.ok).padStart(3)}/${String(s.n).padEnd(3)} bien placés  ${pct(s.ok, s.n)}`);
  console.log(`   agents bien placés : ${agentsOk}/${realAgents}  ${pct(agentsOk, realAgents)}`);
  console.log(`   écart au bon point : médiane ${errKm[Math.floor(errKm.length / 2)]?.toFixed(2)} km, 90 % sous ${errKm[Math.floor(errKm.length * 0.9)]?.toFixed(2)} km`);
  console.log(`   quartiers inventés placés à tort : ${fakePlaced}/${fakes.length}  (${pct(fakes.length - fakePlaced, fakes.length)} correctement laissés « à placer »)`);
  if (errors.length) console.log("   détail des erreurs :\n     - " + errors.join("\n     - "));

  // -- C. axes : contraintes et stabilité face aux erreurs de placement --------------------
  const real = points.map((p, i) => ({ p, i, t: byKey.get(norm(p.key))!, f: found[i] })).filter((x) => x.t.variant !== "invente");
  // la part de quartiers « hors axe » dépend des contraintes choisies, pas de la fiabilité : 2 réglages comparés
  const SCENARIOS: [Direction, { vehicles: number; maxDurationMin: number; maxDetourMin: number }][] = [
    ["ramassage", { vehicles: 6, maxDurationMin: 60, maxDetourMin: 12 }],
    ["remisage", { vehicles: 5, maxDurationMin: 60, maxDetourMin: 12 }],
    ["remisage", { vehicles: 8, maxDurationMin: 75, maxDetourMin: 15 }],
  ];
  console.log("\nB. AXES CALCULÉS (coefficient de trafic 1,3)");
  for (const [dir, p] of SCENARIOS) {
    // positions trouvées par l'outil (points non trouvés = à placer : exclus, comme sur la page)
    const placed = real.filter((x) => x.f);
    const ptsFound = placed.map((x) => ({ lat: x.f!.lat, lon: x.f!.lon, weight: x.p.agents }));
    const matF = await durationMatrix(S, ptsFound, 1.3);
    const mF = matF.minutes;
    const outF = buildAxes(ptsFound, S, mF, dir, p);
    // mêmes quartiers aux positions EXACTES (vérité)
    const ptsTrue = placed.map((x) => ({ lat: x.t.lat!, lon: x.t.lon!, weight: x.p.agents }));
    const mT = (await durationMatrix(S, ptsTrue, 1.3)).minutes;
    const outT = buildAxes(ptsTrue, S, mT, dir, p);

    const axeOf = (o: typeof outF) => {
      const a = placed.map(() => -1);
      o.axes.forEach((ax, k2) => ax.stops.forEach((s) => (a[s] = k2)));
      return a;
    };
    const aF = axeOf(outF);
    const aT = axeOf(outT);
    const violations = outF.axes.reduce((s, a) => s + (a.overDuration ? 1 : 0) + a.overDetour.filter(Boolean).length, 0);
    const inAxe = aF.filter((a) => a >= 0).length;
    const agIn = placed.reduce((s, x, j) => s + (aF[j] >= 0 ? x.p.agents : 0), 0);
    // stabilité : pour chaque paire de quartiers, sont-ils ensemble (ou séparés) dans les deux calculs ?
    let agree = 0;
    let pairs = 0;
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        if (aF[i] < 0 || aF[j] < 0 || aT[i] < 0 || aT[j] < 0) continue;
        pairs++;
        if ((aF[i] === aF[j]) === (aT[i] === aT[j])) agree++;
      }
    const loads = outF.axes.map((a) => a.stops.reduce((s, st) => s + placed[st].p.agents, 0));
    console.log(`   ${dir.padEnd(9)} ${p.vehicles} axes ≤ ${p.maxDurationMin} min, détour ≤ ${p.maxDetourMin} min · durées : ${matF.source === "estimation" ? "estimées à vol d'oiseau" : "sur les routes (OpenStreetMap)"}`);
    console.log(`      contraintes respectées : ${violations === 0 ? "100 %" : `${violations} dépassement(s)`}`);
    console.log(`      quartiers placés dans un axe : ${inAxe}/${placed.length}  ${pct(inAxe, placed.length)} · agents : ${agIn}/${placed.reduce((s, x) => s + x.p.agents, 0)}  ${pct(agIn, placed.reduce((s, x) => s + x.p.agents, 0))}`);
    console.log(`      durées des axes : ${outF.axes.map((a) => Math.round(a.total)).join(", ")} min · agents par axe : ${loads.join(", ")}`);
    console.log(`      même découpage qu'avec les positions exactes : ${pct(agree, pairs)} des paires de quartiers`);
  }

  const tot = stats.get("TOTAL")!;
  console.log(`\nRÉSUMÉ : placement ${pct(tot.ok, tot.n)} des quartiers (${pct(agentsOk, realAgents)} des agents), ${pct(fakes.length - fakePlaced, fakes.length)} des inventés correctement refusés.`);
}
main();
