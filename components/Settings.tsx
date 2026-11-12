"use client";

import type { Settings } from "@/lib/types";
import type { SettingKey } from "@/lib/settings-meta";
import { IconBriefcase, IconBus, IconChevron, IconSliders, IconSwap, IconUsers } from "./Icons";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  /** Réglages affichés (par défaut : tous). Un utilisateur ne voit que ceux que l'admin lui a ouverts. */
  show?: (k: SettingKey) => boolean;
  /** Ouvre d'office la partie « avancés » (page d'administration). */
  advancedOpen?: boolean;
}

const PICKUP_CHOICES = [5, 6, 7];
const DROP_CHOICES = [17, 18, 19, 20, 21, 22, 23];

const toggle = (list: number[], h: number) => (list.includes(h) ? list.filter((x) => x !== h) : [...list, h].sort((a, b) => a - b));

function WaveTile({ hour, kind, active, axe21, canToggle, canAxe, onToggle, onAxe }: { hour: number; kind: "pickup" | "drop"; active: boolean; axe21: boolean; canToggle: boolean; canAxe: boolean; onToggle: () => void; onAxe: (is21: boolean) => void }) {
  return (
    <div className={`wave ${kind}${active ? " on" : ""}`}>
      <button type="button" className="h" onClick={onToggle} disabled={!canToggle} aria-pressed={active} title={!canToggle ? "Fixé par l'administrateur" : active ? "Cliquer pour retirer cette vague" : "Cliquer pour ajouter cette vague"}>
        {hour}h
      </button>
      {active ? (
        canAxe ? (
          <div className="axe" role="group" aria-label={`Colonne d'axe pour ${hour}h`}>
            <button type="button" className={axe21 ? "on" : ""} onClick={() => onAxe(true)} title="Utiliser la colonne « Axe 21h »">21h</button>
            <button type="button" className={!axe21 ? "on" : ""} onClick={() => onAxe(false)} title="Utiliser la colonne « Axe 23h »">23h</button>
          </div>
        ) : (
          <div className="off-txt">Axe {axe21 ? "21h" : "23h"}</div>
        )
      ) : (
        <div className="off-txt">inactif</div>
      )}
    </div>
  );
}

function Switch({ checked, onChange, title, children }: { checked: boolean; onChange: (v: boolean) => void; title: string; children: React.ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="tr" />
      <span className="tx">
        <b>{title}</b>
        {children}
      </span>
    </label>
  );
}

export default function SettingsPanel({ settings, onChange, show = () => true, advancedOpen }: Props) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    if (Number.isFinite(n)) set(k, n as never);
  };
  const setAxe = (h: number, is21: boolean) => {
    const has = settings.axe21Waves.includes(h);
    if (is21 !== has) set("axe21Waves", toggle(settings.axe21Waves, h));
  };
  const any = (...keys: SettingKey[]) => keys.some(show);

  const showWaves = any("pickupHours", "dropHours", "axe21Waves");
  const showRules = any("respectFunction", "offSwap", "useReserve", "swapRoles");
  const showEquity = any("fairnessWeight", "weekendWeight");
  const showVehicles = any("capacity", "minRestHours", "maxDurationDiffMin");
  const showLevel = any("unknownLevelSwappable", "ignoreLevel");

  if (!showWaves && !showRules && !showEquity && !showVehicles && !showLevel)
    return <p className="muted">Tous les réglages sont fixés par l'administrateur pour ce calcul.</p>;

  return (
    <>
      <div className="sgrid">
        {showWaves && (
          <section className="sec wide">
            <h3><span className="ic sky"><IconBus size={16} /></span>Vagues de transport</h3>
            <p className="lead">
              Cliquez sur une heure pour l'activer ou la retirer. Chaque heure est une vague séparée, avec ses propres véhicules.
              {show("axe21Waves") && " Sous chaque vague, choisissez la colonne d'axe à utiliser (« Axe 21h » ou « Axe 23h »)."}
            </p>
            <div className="waves-row">
              <div className="wlabel" style={{ color: "var(--pickup)" }}>Ramassage<br />(arrivée)</div>
              {PICKUP_CHOICES.map((h) => (
                <WaveTile
                  key={h}
                  hour={h}
                  kind="pickup"
                  active={settings.pickupHours.includes(h)}
                  axe21={settings.axe21Waves.includes(h)}
                  canToggle={show("pickupHours")}
                  canAxe={show("axe21Waves")}
                  onToggle={() => set("pickupHours", toggle(settings.pickupHours, h))}
                  onAxe={(v) => setAxe(h, v)}
                />
              ))}
            </div>
            <div className="waves-row">
              <div className="wlabel" style={{ color: "var(--drop)" }}>Remisage<br />(sortie)</div>
              {DROP_CHOICES.map((h) => (
                <WaveTile
                  key={h}
                  hour={h}
                  kind="drop"
                  active={settings.dropHours.includes(h)}
                  axe21={settings.axe21Waves.includes(h)}
                  canToggle={show("dropHours")}
                  canAxe={show("axe21Waves")}
                  onToggle={() => set("dropHours", toggle(settings.dropHours, h))}
                  onAxe={(v) => setAxe(h, v)}
                />
              ))}
            </div>
            <p className="help-line">
              Ramassage = arrivée pile à l'heure. Remisage = sortie arrondie à l'heure suivante (21:30 → vague 22h). Un shift qui passe minuit (19h → 06h) n'a pas de transport, et un shift qui finit à 15h ou commence à 9h non plus.
            </p>
          </section>
        )}

        {showRules && (
          <section className="sec">
            <h3><span className="ic indigo"><IconSwap size={16} /></span>Règles d'échange</h3>
            <p className="lead">Ce que l'algorithme a le droit de modifier.</p>
            {show("respectFunction") && (
              <Switch checked={settings.respectFunction} onChange={(v) => set("respectFunction", v)} title="Même fonction uniquement">
                <span>Un agent n'a pas les compétences d'une autre fonction : les échanges restent dans la même fonction.</span>
                {!settings.respectFunction && <span className="warnline">⚠ Désactivé : résultat irréalisable sur le terrain, à utiliser seulement pour mesurer le gain perdu.</span>}
              </Switch>
            )}
            {show("offSwap") && (
              <Switch checked={settings.offSwap} onChange={(v) => set("offSwap", v)} title="Échange jour travaillé ↔ jour OFF">
                <span>A travaille mardi et est OFF samedi, B l'inverse : ils échangent ces deux jours. La couverture de chaque jour et le nombre de OFF de chacun ne changent pas.</span>
              </Switch>
            )}
            {show("useReserve") && (
              <Switch checked={settings.useReserve} onChange={(v) => set("useReserve", v)} title="Remplacement par une personne hors planning">
                <span>
                  Une personne de la liste des agents, absente du planning, de même fonction et de même pôle, reprend toute la semaine d'un agent (mêmes shifts, mêmes OFF). L'agent remplacé passe hors planning cette semaine.
                </span>
                {settings.useReserve && (
                  <span className="warnline">
                    ⚠ La liste des agents est considérée comme fiable. Si une personne y figure alors qu'elle est indisponible (formation, congé, départ, autre campagne), le remplacement proposé sera inapplicable : vérifiez chaque remplacement avant de diffuser le planning.
                  </span>
                )}
              </Switch>
            )}
            {show("swapRoles") && (
              <Switch checked={settings.swapRoles} onChange={(v) => set("swapRoles", v)} title="Échanger les agents avec un rôle seul">
                <span>
                  Aménagements des 2 personnes : avant chaque échange, si l'une des deux a un aménagement, l'échange est refusé (elle ne cède ni ne reçoit aucune case). Activé, ce réglage fait une exception pour les aménagements qui ne sont qu'un rôle (« RENFORT DIGITAL », « TEAM LEAD »).
                </span>
                <span>
                  Tout texte avec une autre contrainte (« TEAM LEAD shift AM / OFF samedi », « Allaitement / RENFORT DIGITAL »…) fige toujours la personne. Les dates de congé restent bloquées.
                </span>
              </Switch>
            )}
            <p className="help-line" style={{ marginTop: 4 }}>
              Pôle (FO / BO / SUPPORT) : vérifié pour tous les échanges quand il est connu des deux côtés (colonne « Pôles » d'IT.xlsx ou de la liste des agents).
            </p>
          </section>
        )}

        {showEquity && (
          <section className="sec">
            <h3><span className="ic teal"><IconUsers size={16} /></span>Équité</h3>
            <p className="lead">0 = seul le nombre de véhicules compte.</p>
            {show("fairnessWeight") && (
              <div className="field">
                <div className="flabel">Shifts tardifs <output>{settings.fairnessWeight}</output></div>
                <input type="range" min={0} max={100} step={5} value={settings.fairnessWeight} onChange={num("fairnessWeight")} aria-label="Poids de l'équité des shifts tardifs" />
                <div className="help">On évite de donner un nouveau shift tardif à qui en a déjà beaucoup fait.</div>
              </div>
            )}
            {show("weekendWeight") && (
              <div className="field">
                <div className="flabel">Week-ends OFF <output>{settings.weekendWeight}</output></div>
                <input type="range" min={0} max={100} step={5} value={settings.weekendWeight} onChange={num("weekendWeight")} aria-label="Poids de l'équité des week-ends" />
                <div className="help">On évite de retirer un samedi ou un dimanche OFF à quelqu'un qui en a déjà peu.</div>
              </div>
            )}
          </section>
        )}

        {showVehicles && (
          <section className="sec wide">
            <h3><span className="ic violet"><IconSliders size={16} /></span>Véhicules et limites</h3>
            <div className="inline2" style={{ marginTop: 10 }}>
              {show("capacity") && (
                <div className="field">
                  <label>Places par véhicule</label>
                  <div className="unit">
                    <input type="number" min={1} max={60} value={settings.capacity} onChange={num("capacity")} />
                    <span>places</span>
                  </div>
                  <div className="help">Au-delà, un 2e véhicule est compté sur le même axe.</div>
                </div>
              )}
              {show("minRestHours") && (
                <div className="field">
                  <label>Repos minimum</label>
                  <div className="unit">
                    <input type="number" min={0} max={24} step={0.5} value={settings.minRestHours} onChange={num("minRestHours")} />
                    <span>heures</span>
                  </div>
                  <div className="help">Entre la fin d'un shift et le début du suivant.</div>
                </div>
              )}
              {show("maxDurationDiffMin") && (
                <div className="field">
                  <label>Écart de durée max</label>
                  <div className="unit">
                    <input type="number" min={0} max={600} step={15} value={settings.maxDurationDiffMin} onChange={num("maxDurationDiffMin")} />
                    <span>min</span>
                  </div>
                  <div className="help">Entre deux shifts échangés : les heures de la semaine restent proches.</div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {showLevel && (
        <details className="adv" open={advancedOpen}>
          <summary><IconChevron size={14} />Réglages avancés : niveau des agents</summary>
          <div className="sgrid">
            <section className="sec">
              <h3><span className="ic amber"><IconBriefcase size={16} /></span>Niveau (Perf / Midle / Débutant)</h3>
              <p className="lead">Le niveau s'ajoute à la fonction s'il est renseigné dans les fichiers.</p>
              {show("unknownLevelSwappable") && (
                <Switch checked={settings.unknownLevelSwappable} onChange={(v) => set("unknownLevelSwappable", v)} title="Échanger les agents sans niveau">
                  <span>Ils ne s'échangent qu'entre eux, jamais avec un Perf, Midle ou Débutant. Désactivé : ils sont figés.</span>
                </Switch>
              )}
              {show("ignoreLevel") && (
                <Switch checked={settings.ignoreLevel} onChange={(v) => set("ignoreLevel", v)} title="Ignorer complètement le niveau">
                  <span>Seule la fonction compte.</span>
                </Switch>
              )}
            </section>
          </div>
        </details>
      )}
    </>
  );
}
