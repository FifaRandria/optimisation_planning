"use client";

import { useState } from "react";

type TabId = "planning" | "agents" | "axes" | "amenagements";

const TABS: { id: TabId; label: string; required: boolean }[] = [
  { id: "planning", label: "1. Planning", required: true },
  { id: "agents", label: "2. Agents", required: true },
  { id: "axes", label: "3. Axes", required: true },
  { id: "amenagements", label: "4. Aménagements", required: false },
];

function Table({ head, rows, cls }: { head: string[]; rows: (string | number)[][]; cls?: string[] }) {
  return (
    <div className="tablewrap">
      <table className="t">
        <thead>
          <tr>{head.map((h, i) => <th key={i} className={cls?.[i]}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={cls?.[j]}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Download({ name }: { name: TabId }) {
  return (
    <div className="row" style={{ marginTop: 14 }}>
      <a className="btn primary small" href={`/api/templates/${name}`}>⬇ Télécharger le modèle Excel</a>
      <a className="btn small" href={`/api/templates/${name}?full=1`}>Version complète (80 agents)</a>
    </div>
  );
}

export default function FormatGuide({ open }: { open?: boolean }) {
  const [tab, setTab] = useState<TabId>("planning");
  return (
    <details className="guide" open={open}>
      <summary>À quoi doivent ressembler les fichiers ? (exemples + modèles Excel)</summary>
      <div className="body">
        <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 12 }}>
          Vous pouvez déposer vos fichiers existants : l'outil repère lui-même les bonnes feuilles grâce aux en-têtes (accents, majuscules et ordre des colonnes sans importance). Les noms de feuilles et de fichiers n'ont pas d'importance non plus. Un seul classeur peut contenir plusieurs feuilles utiles.
        </p>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={"tab" + (tab === t.id ? " on" : "")} onClick={() => setTab(t.id)}>
              {t.label}
              <span className={"badge " + (t.required ? "err" : "")}>{t.required ? "obligatoire" : "facultatif"}</span>
            </button>
          ))}
        </div>

        {tab === "planning" && (
          <>
            <p style={{ marginBottom: 8 }}>
              <b>Le planning déjà fait</b> (feuille type « Planning Agents S+1 ») : 2 lignes d'en-tête, puis une ligne par agent.
            </p>
            <div className="tablewrap">
              <table className="t">
                <thead>
                  <tr>
                    <th rowSpan={2}>Matricule</th>
                    <th rowSpan={2}>Nom et Prenom</th>
                    <th colSpan={2} className="c">lun 12/10/2026</th>
                    <th colSpan={2} className="c">mar 13/10/2026</th>
                    <th colSpan={2} className="c">mer 14/10/2026</th>
                    <th className="c muted">… 7 jours</th>
                  </tr>
                  <tr>
                    {[0, 1, 2].flatMap((i) => [<th key={"a" + i} className="c">heure d'arrivée</th>, <th key={"d" + i} className="c">heure de départ</th>])}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr><td>AG00101</td><td>RAKOTOBE Aina</td><td className="c">07:00</td><td className="c">16:00</td><td className="c muted">OFF</td><td className="c muted">OFF</td><td className="c">07:00</td><td className="c">16:00</td><td /></tr>
                  <tr><td>AG00103</td><td>RASOANIRINA Fara</td><td className="c">12:00</td><td className="c">21:00</td><td className="c">12:00</td><td className="c">21:00</td><td className="c muted">OFF</td><td className="c muted">OFF</td><td /></tr>
                  <tr><td>AG00104</td><td>RANDRIANA Tiana</td><td className="c" style={{ color: "var(--warn)" }}>CONGE</td><td className="c" style={{ color: "var(--warn)" }}>CONGE</td><td className="c">07:00</td><td className="c">16:00</td><td className="c">09:00</td><td className="c">20:00</td><td /></tr>
                </tbody>
              </table>
            </div>
            <div className="cols">
              <div>
                <h3>Règles</h3>
                <ul>
                  <li><span className="req">obligatoire</span> Colonne <code>Matricule</code> (ex. AG00101, AG00102).</li>
                  <li><span className="req">obligatoire</span> Une <b>vraie date</b> par jour dans la ligne d'en-tête (cellule fusionnée sur 2 colonnes). Au moins 3 jours.</li>
                  <li>Sous chaque date : arrivée puis départ (colonnes voisines).</li>
                  <li>Heures : <code>07:00</code>, <code>7h</code> ou une cellule « heure » Excel.</li>
                  <li>Autres valeurs acceptées : <code>OFF</code>, <code>CONGE</code>. Tout autre code (<code>D</code>, <code>P</code>…) est conservé et la case n'est jamais échangée.</li>
                </ul>
              </div>
              <div>
                <h3>Comment c'est utilisé</h3>
                <ul>
                  <li>Un shift qui finit à partir de l'heure de transport (19h par défaut) = un agent à transporter.</li>
                  <li>Les cases d'horaires ne sont jamais créées ni supprimées : seuls les <b>noms</b> se déplacent.</li>
                  <li>Le fichier corrigé est rendu dans exactement ce format.</li>
                </ul>
              </div>
            </div>
            <Download name="planning" />
          </>
        )}

        {tab === "agents" && (
          <>
            <p style={{ marginBottom: 8 }}>
              <b>La liste des agents</b> : la fonction de chaque agent et son axe (ou sa commune). Une ligne par agent. Le fichier <code>Personnes-par-fonction.xlsx</code> convient tel quel.
            </p>
            <Table
              head={["Matricule", "Nom et prénom", "Fonction", "Commune / Fokotany", "Axe 23h", "Axe 21h"]}
              rows={[
                ["AG00105", "RAJAONA Mamy", "CSA Certification Mvola", "Ambohimanarina", "Axe 6", "Axe 6"],
                ["AG00106", "RABEMANANA Toky", "CSA Certification Mvola", "Namontana Madera", "Axe 7", "Axe 2"],
                ["AG00103", "RASOANIRINA Fara", "CSA Appels Entrants MVOLA", "Itaosy", "Axe 3", "Axe 3"],
              ]}
            />
            <div className="cols">
              <div>
                <h3>Colonnes reconnues</h3>
                <ul>
                  <li><span className="req">obligatoire</span> <code>Matricule</code></li>
                  <li><span className="req">obligatoire</span> <code>Fonction</code> : deux agents ne s'échangent que s'ils ont exactement la même fonction. Sans fonction, l'agent est figé.</li>
                  <li><span className="optl">facultatif</span> <code>Axe 21h</code> / <code>Axe 23h</code> : axe direct de l'agent. Sinon, il est déduit de la commune avec la table des axes.</li>
                  <li><span className="req">obligatoire</span> (si pas d'axe direct) Commune : <code>Commune</code>, <code>Commune/Fokotany/Repère map</code>, <code>Repère</code> ou <code>Quartier</code>. Si plusieurs sont présentes, elles sont essayées dans cet ordre jusqu'à trouver une correspondance dans la table des axes.</li>
                  <li><span className="optl">facultatif</span> <code>Niveau</code> (ou <code>Statut d'agents</code>) : Perf, Midle, Débutant. Vide = « inconnu ».</li>
                  <li><span className="optl">facultatif</span> <code>Tardifs historique</code> : nombre de shifts tardifs déjà faits (équité).</li>
                  <li><span className="optl">facultatif</span> <code>Nom et Prenom</code></li>
                </ul>
              </div>
              <div>
                <h3>Bon à savoir</h3>
                <ul>
                  <li>Plusieurs feuilles/fichiers « agents » sont fusionnés (ex. la liste des communes + la feuille d'aménagements qui porte le niveau).</li>
                  <li>Le texte de la commune doit correspondre à une ligne de la table des axes (accents et majuscules ignorés).</li>
                  <li>Un agent absent de la liste, sans commune ou avec une commune inconnue est <b>figé</b> et signalé en alerte.</li>
                </ul>
              </div>
            </div>
            <Download name="agents" />
          </>
        )}

        {tab === "axes" && (
          <>
            <p style={{ marginBottom: 8 }}>
              <b>La table commune → axe</b> (feuille type « Axes ») : un axe = un véhicule.
            </p>
            <Table
              head={["Commune/Fokotany/Repère map", "Axe 19h", "Axe 21h", "Chauffeur à 19h", "Chauffeur à 21h", "Distance (km)", "Durée en minutes"]}
              rows={[
                ["Ambohibao", "Axe 1", "Axe 1", "Chauffeur A (1111 TAA)", "Chauffeur B (2222 TAB)", 1.7, 5],
                ["Itaosy", "Axe 3", "Axe 3", "Chauffeur C (3333 TAC)", "Chauffeur D (4444 TAD)", 16.9, 41],
                ["Ankasina", "Axe 2", "Axe 2", "Chauffeur E (5555 TAE)", "Chauffeur F (6666 TAF)", 7.8, 19],
              ]}
              cls={["", "c", "c", "", "", "c", "c"]}
            />
            <div className="cols">
              <div>
                <h3>Colonnes reconnues</h3>
                <ul>
                  <li><span className="req">obligatoire</span> Une colonne commune (<code>Commune</code>, <code>Commune/Fokotany/Repère map</code>…).</li>
                  <li><span className="req">obligatoire</span> Au moins une colonne dont l'en-tête commence par <code>Axe</code> (<code>Axe 21h</code>, <code>Axe 23h</code>…). Si vous en avez plusieurs, vous choisissez dans les réglages (par défaut : celle qui contient « 21h »).</li>
                  <li><span className="optl">facultatif</span> <code>Chauffeur …</code> : associé aux colonnes d'axe dans le même ordre ; sert aux listes par chauffeur.</li>
                  <li><span className="optl">facultatif</span> <code>Durée en minutes</code> / <code>Distance (km)</code> : départage les cas égaux (trajet le plus court).</li>
                </ul>
              </div>
              <div>
                <h3>Bon à savoir</h3>
                <ul>
                  <li>Valeurs d'axe : « Axe 3 », « AXE 3 » ou « axe3 » sont équivalentes.</li>
                  <li>Un axe est un véhicule par vague horaire (19h, 21h…), avec la capacité définie dans les réglages.</li>
                </ul>
              </div>
            </div>
            <Download name="axes" />
          </>
        )}

        {tab === "amenagements" && (
          <>
            <p style={{ marginBottom: 8 }}>
              <b>Aménagements et congés</b> (feuille type « Amenagement_S41 »). Facultatif, mais fortement recommandé.
            </p>
            <Table
              head={["Matricule", "Nom et Prenom", "Aménagement", "Congé début", "Congé fin"]}
              rows={[
                ["AG00107", "RAZAFY Nirina", "Shift AM (suivi médical)", "", ""],
                ["AG00108", "RAHARI Lova", "", "17/10/2026", "17/10/2026"],
                ["AG00104", "RANDRIANA Tiana", "RENFORT DIGITAL", "12/10/2026", "16/10/2026"],
              ]}
            />
            <div className="cols">
              <div>
                <h3>Règles</h3>
                <ul>
                  <li><span className="req">obligatoire</span> <code>Matricule</code> et <code>Aménagement</code> (texte libre).</li>
                  <li><span className="optl">facultatif</span> <code>Congé</code> + colonne suivante : dates de début et de fin.</li>
                  <li>Un agent avec un aménagement est <b>figé</b> : jamais échangé. Si le texte n'est pas compris, une alerte demande de vérifier.</li>
                  <li>Aucun échange n'est fait sur les jours de congé.</li>
                  <li>Si cette feuille porte aussi « Quartier » et « Statut d'agents », elle sert aussi de liste d'agents.</li>
                </ul>
              </div>
            </div>
            <Download name="amenagements" />
          </>
        )}
      </div>
    </details>
  );
}
