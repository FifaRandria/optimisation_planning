// Jeu de données d'exemple (déterministe) : sert aux modèles Excel et à la démo.

export type V = string | number | Date | null;

export interface SampleSet {
  dates: string[]; // ISO
  planning: { matricule: string; nom: string; cells: { arr: number | string | null; dep: number | string | null }[] }[];
  agents: { matricule: string; nom: string; fonction: string; commune: string; niveau: string; historique: number }[];
  axes: { commune: string; axe19: string; axe21: string; ch19: string; ch21: string; km: number; min: number }[];
  amenagements: { matricule: string; nom: string; texte: string; debut?: string; fin?: string }[];
}

function rng(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DRIVERS = ["Chauffeur A (1111 TAA)", "Chauffeur E (5555 TAE)", "Chauffeur C (3333 TAC)", "Chauffeur B (2222 TAB)", "Chauffeur G (7777 TAG)", "Chauffeur D (4444 TAD)", "Chauffeur H (8888 TAH)", "Chauffeur F (6666 TAF)"];

// commune, axe (19h), axe (21h), km, minutes
const COMMUNES: [string, number, number, number, number][] = [
  ["Ambohibao", 1, 1, 1.7, 5],
  ["Ambohidratrimo", 1, 1, 5.7, 15],
  ["Ivato Aéroport", 1, 1, 5.1, 14],
  ["Talatamaty", 1, 1, 3.6, 12],
  ["Ambohimanarina", 2, 2, 7.8, 18],
  ["Ankasina", 2, 2, 7.8, 19],
  ["Antohomadinika", 2, 2, 9.1, 21],
  ["67 Ha", 2, 2, 6.9, 16],
  ["Itaosy", 3, 3, 16.9, 41],
  ["Ampitatafika", 3, 3, 14.2, 36],
  ["Ambodiafontsy", 3, 3, 16.9, 40],
  ["Isotry", 4, 4, 9.6, 23],
  ["Anosy", 4, 4, 8.1, 20],
  ["Ambanidia", 4, 4, 12.9, 32],
  ["Ambatobe", 5, 5, 14.1, 31],
  ["Ambohitrarahaba", 5, 5, 11.2, 29],
  ["Andrononobe", 5, 5, 11.1, 30],
  ["Ambodimita", 6, 6, 2.3, 7],
  ["Anosisoa", 6, 6, 3.3, 6],
  ["Ambohimandroso", 6, 6, 5.7, 17],
  ["Ambohimangakely", 7, 7, 15.9, 32],
  ["Ambatofotsy", 7, 7, 24.3, 50],
  ["Manjakaray", 7, 7, 11.4, 31],
  ["Iavoloha", 8, 8, 23.5, 49],
  ["Soanierana", 8, 8, 14.9, 36],
  ["Ankaditoho", 8, 8, 15.1, 38],
];

const PRENOMS = ["Fanomezana", "Volo", "Lauren", "Faniry", "Tahina", "Onintsoa", "Merantia", "Napoleon", "Fidinirina", "Zolina", "Anja", "Fenomamy", "Mahefa", "Hery", "Lalaina", "Mialy", "Tsiky", "Haingo", "Rivo", "Sitraka", "Nirina", "Aina", "Toky", "Voahangy", "Henintsoa", "Santatra", "Kanto", "Mamy"];
const NOMS = ["RAKOTO", "RASOA", "RAVO", "ANDRIA", "RANDRIA", "RAZAFY", "RABE", "RAHARI", "RATSI", "RAJAO", "RAMA", "HERINIAINA", "RAFARA", "RAZANA"];
const SUFFIX = ["MALALA", "NIRINA", "SOLOFO", "HASINA", "TIANA", "MANANA", "VOLA", "LALA"];

const SHIFTS: [number, number, number][] = [
  [6, 15, 12],
  [6, 13, 6],
  [7, 16, 22],
  [8, 17, 22],
  [9, 18, 10],
  [10, 19, 12],
  [11, 20, 10],
  [12, 21, 20],
  [13, 22, 8],
  [14, 23, 6],
];

export function buildSample(n = 80, startIso = "2026-10-12", seed = 42): SampleSet {
  const rand = rng(seed);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const dates: string[] = [];
  const d0 = new Date(startIso + "T00:00:00Z");
  for (let i = 0; i < 7; i++) dates.push(new Date(d0.getTime() + i * 86400000).toISOString().slice(0, 10));

  const axes = COMMUNES.map(([commune, a19, a21, km, min]) => ({
    commune,
    axe19: `Axe ${a19}`,
    axe21: `Axe ${a21}`,
    ch19: DRIVERS[(a19 - 1) % DRIVERS.length],
    ch21: DRIVERS[(a21 + 2) % DRIVERS.length],
    km,
    min,
  }));

  const agents: SampleSet["agents"] = [];
  const planning: SampleSet["planning"] = [];
  const amenagements: SampleSet["amenagements"] = [];
  const used = new Set<string>();
  for (let i = 0; i < n; i++) {
    const matricule = `CN${String(1001 + i * 3).padStart(5, "0")}`;
    let nom = "";
    do nom = `${pick(NOMS)}${pick(SUFFIX)} ${pick(PRENOMS)}`;
    while (used.has(nom));
    used.add(nom);
    const r = rand();
    const niveau = r < 0.25 ? "Perf" : r < 0.7 ? "Midle" : "Débutant";
    const rf = rand();
    const fonction = rf < 0.45 ? "CSA Appels Entrants MVOLA" : rf < 0.75 ? "CSA Certification Mvola" : rf < 0.93 ? "Conseiller client (B4B)" : "CSA Digital YAS";
    agents.push({ matricule, nom, fonction, commune: pick(COMMUNES)[0], niveau, historique: Math.floor(rand() * 4) });

    // semaine : 2 jours OFF, repos 13 h respecté
    const off = new Set<number>();
    while (off.size < 2) off.add(Math.floor(rand() * 7));
    let prevDep: number | null = null;
    const cells: SampleSet["planning"][number]["cells"] = [];
    for (let d = 0; d < 7; d++) {
      if (off.has(d)) {
        cells.push({ arr: "OFF", dep: "OFF" });
        prevDep = null;
        continue;
      }
      const allowed = SHIFTS.filter(([a]) => prevDep === null || a + 24 - prevDep >= 13);
      const total = allowed.reduce((s, x) => s + x[2], 0);
      let t = rand() * total;
      let chosen = allowed[0];
      for (const s of allowed) {
        t -= s[2];
        if (t <= 0) {
          chosen = s;
          break;
        }
      }
      cells.push({ arr: chosen[0] / 24, dep: chosen[1] / 24 });
      prevDep = chosen[1];
    }
    planning.push({ matricule, nom, cells });
  }

  // aménagements : quelques agents figés + congés
  const am = (idx: number, texte: string, debut?: number, fin?: number) => {
    if (idx >= agents.length) return;
    amenagements.push({ matricule: agents[idx].matricule, nom: agents[idx].nom, texte, debut: debut !== undefined ? dates[debut] : undefined, fin: fin !== undefined ? dates[fin] : undefined });
  };
  am(1, "Shift AM (suivi médical)");
  am(5, "Allaitement / démarrer à 08h");
  am(9, "Shift nuit");
  am(14, "TEAM LEAD shift PM");
  am(20, "Demande particulière à vérifier");
  am(25, "", 2, 3);
  am(31, "", 4, 4);
  // congés visibles dans le planning
  for (const [idx, from, to] of [[25, 2, 3], [31, 4, 4]] as const) {
    if (idx < planning.length) for (let d = from; d <= to; d++) planning[idx].cells[d] = { arr: "CONGE", dep: "CONGE" };
  }
  return { dates, planning, agents, axes, amenagements };
}
