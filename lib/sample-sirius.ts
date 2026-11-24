// Jeu FICTIF du site SIRIUS (Galaxie Andraharo) : planning, agents, axes, aménagements.
// Sert à la démo (« Essayer avec des données d'exemple » quand le site SIRIUS est choisi) et au script
// scripts/fictif-sirius.ts. Toutes les personnes, matricules, téléphones et chauffeurs sont inventés.
// Le planning reprend la mise en page du vrai fichier LISTE_CSA_BO_MVOLA_SHIFTE_SIRUIS
// (MATRICULE, NOM & PRENOM, QUARTIER, Point de remisage/ramassage, Contact, SHIFT, GMAIL, puis 2 colonnes par jour).
import ExcelJS from "exceljs";

export async function buildSiriusFiles(MONDAY: string): Promise<{ name: string; buffer: Buffer }[]> {
  const DATES = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(MONDAY + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  // Générateur pseudo-aléatoire déterministe : le même jeu à chaque exécution
  let seed = 46; // même jeu à chaque appel
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

  // ---------------------------------------------------------------------------
  // Axes au départ de SIRIUS - Galaxie Andraharo (fictifs).
  // « Axe 23h » = colonne utilisée par le ramassage de 6h ; « Axe 21h » = remisage de 21h
  // (mêmes en-têtes que la table Connecteo pour être lus tels quels). Le soir, moins de chauffeurs :
  // les axes 5 et 6 du matin sont regroupés dans l'axe 5.
  // ---------------------------------------------------------------------------
  const CH = {
    s1: "SIRIUS Chauffeur Rivo 1001TAA / Tél: 034 00 000 01",
    s2: "SIRIUS Chauffeur Haja 1002TAA / Tél: 034 00 000 02",
    s3: "SIRIUS Chauffeur Tojo 1003TAA / Tél: 034 00 000 03",
    s4: "SIRIUS Chauffeur Fara 1004TAA / Tél: 034 00 000 04",
    s5: "SIRIUS Chauffeur Naina 1005TAA / Tél: 034 00 000 05",
    s6: "SIRIUS Chauffeur Mahery 1006TAA / Tél: 034 00 000 06",
  };
  const AXES: { q: string; am: number; pm: number; km: number; min: number }[] = [
    // Axe 1 : nord-ouest
    { q: "Ivato", am: 1, pm: 1, km: 9.5, min: 25 },
    { q: "Mamory Ivato", am: 1, pm: 1, km: 10.2, min: 28 },
    { q: "Talatamaty", am: 1, pm: 1, km: 6.1, min: 18 },
    { q: "Ambohibao", am: 1, pm: 1, km: 4.3, min: 12 },
    { q: "Ambohidratrimo", am: 1, pm: 1, km: 11.8, min: 32 },
    // Axe 2 : ouest
    { q: "Itaosy", am: 2, pm: 2, km: 8.4, min: 30 },
    { q: "Bemasoandro", am: 2, pm: 2, km: 9.0, min: 32 },
    { q: "Ampitatafika", am: 2, pm: 2, km: 7.2, min: 26 },
    { q: "Ankadindravola", am: 2, pm: 2, km: 10.5, min: 35 },
    // Axe 3 : centre
    { q: "Andohatapenaka", am: 3, pm: 3, km: 3.1, min: 12 },
    { q: "Ankazomanga", am: 3, pm: 3, km: 4.0, min: 15 },
    { q: "Manjakaray", am: 3, pm: 3, km: 4.6, min: 17 },
    { q: "Anosisoa", am: 3, pm: 3, km: 5.5, min: 20 },
    { q: "Anosibe", am: 3, pm: 3, km: 6.3, min: 24 },
    // Axe 4 : nord
    { q: "Ambohimanarina", am: 4, pm: 4, km: 2.2, min: 8 },
    { q: "Ambohidroa", am: 4, pm: 4, km: 3.4, min: 11 },
    { q: "Andranoro", am: 4, pm: 4, km: 3.9, min: 13 },
    { q: "Ambatolampy Antehiroka", am: 4, pm: 4, km: 5.8, min: 18 },
    // Axe 5 : est
    { q: "Ilafy", am: 5, pm: 5, km: 8.9, min: 30 },
    { q: "Ankadikely Ilafy", am: 5, pm: 5, km: 9.7, min: 33 },
    { q: "Manjaka", am: 5, pm: 5, km: 10.4, min: 36 },
    { q: "Ambohimangakely", am: 5, pm: 5, km: 12.6, min: 40 },
    // Axe 6 : centre-est (regroupé avec l'axe 5 le soir)
    { q: "Ankorondrano", am: 6, pm: 5, km: 5.2, min: 20 },
    { q: "Ankatso", am: 6, pm: 5, km: 7.5, min: 27 },
    { q: "Ambatomaro", am: 6, pm: 5, km: 8.1, min: 29 },
    { q: "Soamanandrariny", am: 6, pm: 5, km: 8.8, min: 31 },
  ];
  const CH_AM: Record<number, string> = { 1: CH.s1, 2: CH.s2, 3: CH.s3, 4: CH.s4, 5: CH.s5, 6: CH.s6 };
  const CH_PM: Record<number, string> = { 1: CH.s1, 2: CH.s2, 3: CH.s3, 4: CH.s4, 5: CH.s5 };
  const POINTS = ["Arrêt bus", "Pharmacie", "EPP", "Station Jovena", "Église FJKM", "Terminus", "Marché"];

  // ---------------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------------
  const PRENOMS = ["Tiana", "Hery", "Lova", "Fanja", "Mialy", "Tojo", "Rado", "Nirina", "Sitraka", "Fitia", "Mamy", "Haja", "Volana", "Andry", "Soa", "Toky", "Zo", "Ony", "Faly", "Rindra", "Kanto", "Njaka", "Hanta", "Miora"];
  const NOMS = ["RAKOTO", "RABE", "RASOA", "RANDRIA", "RAZAFY", "RALAI", "ANDRIAMANANA", "RAHARISON", "RAVELO", "RAMANANA", "RASOLO", "RAKOTOBE"];

  type Shift = "AM" | "PM";
  interface A {
    mat: string;
    nom: string;
    fonction: string;
    pole: string;
    niveau: string;
    q: string;
    shift: Shift;
    inPlanning: boolean;
    cells: [unknown, unknown][];
  }

  const t = (h: number, m = 0) => (h * 60 + m) / 1440; // heure Excel (fraction de jour)
  const OFF: [unknown, unknown] = ["OFF", "OFF"];
  const CONGE: [unknown, unknown] = ["CONGE", "CONGE"];

  /** Semaine type : 5 ou 6 jours travaillés, 2 OFF. AM = 06:00-13:00 (samedi 06:00-11:00), PM = 13:00-21:00. */
  function week(shift: Shift, offDays: number[]): [unknown, unknown][] {
    return DATES.map((_, d) => {
      if (offDays.includes(d)) return OFF;
      if (shift === "AM") return d === 5 ? [t(6), t(11)] : [t(6), t(13)];
      return [t(13), t(21)];
    });
  }

  const FONCTIONS = [
    { f: "CSA Certification Mvola", pole: "FO", n: 22 },
    { f: "CSA Back Office Mvola", pole: "BO", n: 14 },
    { f: "Manager Coach Mvola", pole: "SUPPORT", n: 3 },
  ];
  const OFF_PATTERNS = [[5, 6], [6, 0], [5, 6], [2, 6], [3, 6], [5, 6], [1, 6], [4, 5]];

  const agents: A[] = [];
  let k = 101;
  for (const { f, pole, n } of FONCTIONS) {
    for (let i = 0; i < n; i++) {
      const shift: Shift = f.startsWith("Manager") ? "AM" : i % 2 === 0 ? "AM" : "PM";
      const ax = pick(AXES);
      const offs = pick(OFF_PATTERNS);
      agents.push({
        mat: `SR${String(k).padStart(5, "0")}`,
        nom: `${pick(NOMS)} ${pick(PRENOMS)} ${pick(PRENOMS)}`,
        fonction: f,
        pole,
        niveau: pick(["Perf", "Midle", "Midle", "Débutant", ""]),
        q: ax.q,
        shift,
        inPlanning: true,
        cells: week(shift, offs),
      });
      k++;
    }
  }
  // Cas particuliers à tester
  agents[3].cells[0] = CONGE; // congé lundi + mardi
  agents[3].cells[1] = CONGE;
  agents[7].cells[2] = ["RC", "RC"]; // repos compensateur : case figée
  agents[11].cells[4] = [t(13), t(21, 30)]; // sortie 21:30 -> vague de 22h
  // Réserve hors planning : dans la liste des agents, absents du planning de la semaine
  for (const i of [20, 21, 34]) agents[i].inPlanning = false;

  const AMENAGEMENTS = [
    { mat: agents[1].mat, nom: agents[1].nom, texte: "Femme enceinte - pas de shift tardif", debut: null as string | null, fin: null as string | null },
    { mat: agents[5].mat, nom: agents[5].nom, texte: "Raison médicale - AM uniquement", debut: DATES[1], fin: DATES[3] },
    { mat: agents[9].mat, nom: agents[9].nom, texte: "Études - PM uniquement", debut: null, fin: null },
  ];

  // ---------------------------------------------------------------------------
  // Écriture des classeurs
  // ---------------------------------------------------------------------------
  const HEAD: Partial<ExcelJS.Style> = {
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } },
    font: { bold: true, color: { argb: "FFFFFFFF" } },
    alignment: { horizontal: "center", vertical: "middle", wrapText: true },
  };
  const styleRow = (r: ExcelJS.Row) => r.eachCell((c) => Object.assign(c, { style: { ...c.style, ...HEAD } }));
  const isoWeek = (iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - y0.getTime()) / 86400000 + 1) / 7);
  };

  function planningWb() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Feuil1");
    const FIRST = 8; // colonne H, comme le vrai fichier
    ws.getCell(1, FIRST).value = `S${isoWeek(MONDAY)}`;
    const h = ws.getRow(2);
    ["MATRICULE", "NOM & PRENOM", "QUARTIER", "Point de remisage/ramassage", "Contact", "SHIFT", "GMAIL"].forEach((v, i) => (h.getCell(i + 1).value = v));
    DATES.forEach((iso, d) => {
      const c = h.getCell(FIRST + d * 2);
      c.value = new Date(iso + "T00:00:00Z");
      c.numFmt = "ddd-dd-mmm";
      ws.mergeCells(2, FIRST + d * 2, 2, FIRST + d * 2 + 1);
    });
    h.getCell(FIRST + 14).value = "HEBDO (+ lunch)";
    styleRow(h);
    [12, 36, 22, 30, 14, 8, 28].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    let r = 3;
    for (const a of agents.filter((x) => x.inPlanning).sort((x, y) => x.shift.localeCompare(y.shift))) {
      const row = ws.getRow(r++);
      row.getCell(1).value = a.mat;
      row.getCell(2).value = a.nom;
      row.getCell(3).value = a.q;
      row.getCell(4).value = `${pick(POINTS)} ${a.q}`;
      row.getCell(5).value = `034 00 ${String(100 + r).padStart(3, "0")} ${String(10 + r).slice(-2)}`;
      row.getCell(6).value = a.shift;
      row.getCell(7).value = `${a.mat.toLowerCase()}@exemple.test`;
      a.cells.forEach(([arr, dep], d) => {
        const x = row.getCell(FIRST + d * 2);
        const y = row.getCell(FIRST + d * 2 + 1);
        x.value = arr as ExcelJS.CellValue;
        y.value = dep as ExcelJS.CellValue;
        for (const c of [x, y]) if (typeof c.value === "number") c.numFmt = "hh:mm";
      });
    }
    ws.views = [{ state: "frozen", xSplit: 2, ySplit: 2 }];
    return wb;
  }

  function agentsWb() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("MAJ");
    ws.addRow(["Matricule", "Nom et prénom", "Fonction", "Pôles", "Quartier", "Niveau"]);
    styleRow(ws.getRow(1));
    [12, 36, 28, 10, 24, 10].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    agents.forEach((a) => ws.addRow([a.mat, a.nom, a.fonction, a.pole, a.q, a.niveau || null]));
    return wb;
  }

  function axesWb() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Axes SIRIUS");
    ws.addRow(["Commune/Fokotany/Repère map", "Axe 23h", "Axe 21h", "Chauffeur à 19h", "Chauffeur à 21h", "Distance (km)", "Durée en minutes"]);
    styleRow(ws.getRow(1));
    [28, 10, 10, 44, 44, 13, 16].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    AXES.forEach((a) => ws.addRow([a.q, `Axe ${a.am}`, `Axe ${a.pm}`, CH_AM[a.am], CH_PM[a.pm], a.km, a.min]));
    const info = wb.addWorksheet("LISEZ-MOI");
    info.getColumn(1).width = 110;
    [
      "Axes FICTIFS au départ de SIRIUS - Galaxie Andraharo (jeu de test, à remplacer par la vraie table).",
      "« Axe 23h » : colonne utilisée pour le ramassage de 6h (shift AM).",
      "« Axe 21h » : colonne utilisée pour le remisage de 21h (shift PM). Le soir, les axes 5 et 6 sont regroupés (axe 5).",
      "Chauffeurs, plaques et téléphones inventés.",
    ].forEach((l, i) => (info.getCell(i + 1, 1).value = l));
    return wb;
  }

  function amenWb() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Amenagements");
    ws.addRow(["Matricule", "Nom et Prenom", "Aménagement", "Début aménagement", "Fin aménagement", "Congé début", "Congé fin"]);
    styleRow(ws.getRow(1));
    [12, 36, 44, 18, 18, 14, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    const dt = (iso: string | null) => (iso ? new Date(iso + "T00:00:00Z") : null);
    AMENAGEMENTS.forEach((a) => {
      const r = ws.addRow([a.mat, a.nom, a.texte, dt(a.debut), dt(a.fin), null, null]);
      for (const c of [4, 5]) r.getCell(c).numFmt = "dd/mm/yyyy";
    });
    return wb;
  }

  const out: { name: string; buffer: Buffer }[] = [];
  for (const [name, wb] of [
    ["sirius-planning.xlsx", planningWb()],
    ["sirius-agents.xlsx", agentsWb()],
    ["sirius-axes.xlsx", axesWb()],
    ["sirius-amenagements.xlsx", amenWb()],
  ] as const)
    out.push({ name, buffer: Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer) });
  return out;
}
