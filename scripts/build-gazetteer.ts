// Construit le répertoire des fokontany et communes de la région Analamanga (Antananarivo) à partir des
// limites administratives officielles COD-AB de Madagascar publiées sur HDX (OCHA, licence CC BY-IGO) :
//   https://data.humdata.org/dataset/cod-ab-mdg
// Entrée : map-data/hdx/cod-ab/geojson/mdg_adminpoints.geojson (téléchargé par « make map-hdx »)
// Sortie : lib/geo/gazetteer-analamanga.json (versionné : données publiques, ~quelques centaines de Ko)
// Usage : npx tsx scripts/build-gazetteer.ts
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "map-data", "hdx", "cod-ab", "geojson", "mdg_adminpoints.geojson");
const OUT = path.join(ROOT, "lib", "geo", "gazetteer-analamanga.json");

interface Props {
  admin_level: number;
  name: string;
  x_coord: number;
  y_coord: number;
  adm2_pcode: string | null;
  adm3_pcode: string | null;
  adm4_pcode: string | null;
}

if (!fs.existsSync(SRC)) {
  console.error(`Fichier absent : ${SRC}
Téléchargez d'abord les limites COD-AB (make map-hdx).`);
  process.exit(1);
}
const j = JSON.parse(fs.readFileSync(SRC, "utf8")) as { features: { properties: Props }[] };
const round = (v: number) => Math.round(v * 1e5) / 1e5;
// chaque point ne porte que son propre P-code : MG11 (région) > MG11102 (district) > MG11102010 (commune) > MG11102010010 (fokontany)
const codeOf = (p: Props) => (p.admin_level === 4 ? p.adm4_pcode : p.admin_level === 3 ? p.adm3_pcode : p.adm2_pcode) ?? "";
const names = new Map<string, string>();
for (const f of j.features) if (f.properties.admin_level >= 2) names.set(codeOf(f.properties), f.properties.name);
// [niveau, nom, commune, district, lat, lon, pcode]
const rows: [number, string, string, string, number, number, string][] = [];
for (const f of j.features) {
  const p = f.properties;
  const code = codeOf(p);
  if (!code.startsWith("MG11") || (p.admin_level !== 3 && p.admin_level !== 4)) continue;
  rows.push([p.admin_level, p.name, names.get(code.slice(0, 10)) ?? "", names.get(code.slice(0, 7)) ?? "", round(p.y_coord), round(p.x_coord), code]);
}
rows.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1], "fr"));
const out = {
  source: "COD-AB Madagascar (OCHA / BNGRC), HDX cod-ab-mdg, licence CC BY-IGO — points centraux des communes (niveau 3) et fokontany (niveau 4), région Analamanga",
  url: "https://data.humdata.org/dataset/cod-ab-mdg",
  generatedAt: new Date().toISOString().slice(0, 10),
  columns: ["niveau", "nom", "commune", "district", "lat", "lon", "pcode"],
  rows,
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`${rows.filter((r) => r[0] === 3).length} communes, ${rows.filter((r) => r[0] === 4).length} fokontany → ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} Ko)`);
