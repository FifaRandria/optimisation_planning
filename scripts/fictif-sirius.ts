// Jeu de test FICTIF pour le site SIRIUS (Galaxie Andraharo).
// Usage : npx tsx scripts/fictif-sirius.ts [lundi ISO, défaut 2026-11-23]
// 1) écrit les 4 classeurs de lib/sample-sirius.ts dans docs/fichiers-test/sirius-semaine-<lundi>/
// 2) les relit avec le vrai parseur et lance l'optimisation avec les réglages du site SIRIUS, pour vérifier.
import fs from "fs";
import path from "path";
import { parseWorkbooks } from "../lib/parse";
import { optimize } from "../lib/optimize";
import { buildSiriusFiles } from "../lib/sample-sirius";
import { SITES } from "../lib/sites";

const MONDAY = process.argv[2] || "2026-11-23";
const OUT = path.join(__dirname, "..", "docs", "fichiers-test", `sirius-semaine-${MONDAY}`);

async function main() {
  const files = await buildSiriusFiles(MONDAY);
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(OUT, f.name), f.buffer);
  console.log(`Écrit dans ${OUT}`);

  const inputs = parseWorkbooks(files);
  console.log("Détection :", inputs.detection.map((d) => `${d.role}=${d.file}/${d.sheet} (${d.rows})`).join(" | "));
  console.log(`Semaine : ${inputs.planning?.dates[0]} → ${inputs.planning?.dates.at(-1)} · ${inputs.planning?.agents.length} agents au planning · ${inputs.agents.length} dans la liste`);
  const r = optimize(inputs, SITES.sirius.defaults);
  console.log(`Véhicules : ${r.metricsBefore.vehicles} → ${r.metricsAfter.vehicles} (ramassage ${r.metricsBefore.pickupVehicles} → ${r.metricsAfter.pickupVehicles}, remisage ${r.metricsBefore.dropVehicles} → ${r.metricsAfter.dropVehicles})`);
  console.log(`Échanges : ${r.swaps.length} (${["jour", "off", "reserve"].map((k) => `${k} ${r.swaps.filter((s) => s.kind === k).length}`).join(", ")})`);
  console.log(`Agents sans axe : ${r.agents.filter((a) => a.axe === "Sans axe" || !a.axe).length}`);
  const counts: Record<string, number> = {};
  for (const a of r.alerts) counts[`${a.level}:${a.code}`] = (counts[`${a.level}:${a.code}`] || 0) + 1;
  console.log("Alertes :", counts);
}
main();
