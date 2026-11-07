"use client";

import { useState } from "react";
import type { Settings } from "@/lib/types";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

const parseHours = (v: string) => [...new Set(v.split(/[,;\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 24))].sort((a, b) => a - b);

function HoursField({ label, help, value, onChange, allowEmpty }: { label: string; help: string; value: number[]; onChange: (v: number[]) => void; allowEmpty?: boolean }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const list = parseHours(e.target.value);
          if (list.length || allowEmpty) onChange(list);
        }}
        onBlur={() => setText(value.join(", "))}
      />
      <div className="help">{help}</div>
    </div>
  );
}

export default function SettingsPanel({ settings, onChange }: Props) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    if (Number.isFinite(n)) set(k, n as never);
  };
  // les champs texte gardent leur saisie : on les remonte quand on revient aux valeurs par défaut
  const hoursKey = `${settings.pickupHours}|${settings.dropHours}|${settings.axe21Waves}`;
  return (
    <div className="settings">
      <div className="field">
        <label>Capacité d'un véhicule</label>
        <input type="number" min={1} max={60} value={settings.capacity} onChange={num("capacity")} />
        <div className="help">Places par véhicule. Au-delà, un 2e véhicule est compté sur le même axe.</div>
      </div>
      <div className="field">
        <label>Repos minimum entre 2 shifts (heures)</label>
        <input type="number" min={0} max={24} step={0.5} value={settings.minRestHours} onChange={num("minRestHours")} />
        <div className="help">Aucun échange ne crée un repos plus court (règle des 13 h).</div>
      </div>
      <HoursField
        key={"p" + hoursKey}
        label="Ramassage : arrivées à (heures)"
        help="Seuls les agents qui ARRIVENT à cette heure pile sont ramassés (ex. « 6 »). Un shift qui commence à 9h n'a pas de transport."
        value={settings.pickupHours}
        onChange={(v) => set("pickupHours", v)}
      />
      <HoursField
        key={"d" + hoursKey}
        label="Remisage : sorties à (heures)"
        help="Chaque heure est une vague séparée, avec ses propres véhicules. Une sortie à la demi-heure part avec la vague suivante (21:30 → 22h). Les shifts qui passent minuit (19h → 06h) n'ont pas de transport."
        value={settings.dropHours}
        onChange={(v) => set("dropHours", v)}
      />
      <HoursField
        key={"a" + hoursKey}
        label="Vagues qui utilisent « Axe 21h »"
        help="Ces vagues prennent la colonne « Axe 21h » (et le chauffeur de 21h). Toutes les autres, ramassage compris, prennent « Axe 23h »."
        value={settings.axe21Waves}
        onChange={(v) => set("axe21Waves", v)}
        allowEmpty
      />
      <div className="field">
        <label className="check" style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={settings.respectFunction} onChange={(e) => set("respectFunction", e.target.checked)} />
          <span>N'échanger qu'entre agents de même fonction</span>
        </label>
        <div className="help">Recommandé : un agent n'a pas les compétences d'une autre fonction. Décocher seulement pour mesurer le gain perdu à cause de cette règle.</div>
        <label className="check" style={{ marginTop: 10, fontWeight: 600 }}>
          <input type="checkbox" checked={settings.offSwap} onChange={(e) => set("offSwap", e.target.checked)} />
          <span>Autoriser l'échange jour travaillé ↔ jour OFF</span>
        </label>
        <div className="help">
          Entre 2 agents de même fonction, dans la même semaine : A travaille mardi et est OFF samedi, B l'inverse. Ils échangent ces deux jours. Chaque jour garde exactement les mêmes horaires couverts, et chacun garde son nombre de jours OFF.
        </div>
      </div>
      <div className="field">
        <label>Poids de l'équité des shifts tardifs : {settings.fairnessWeight}</label>
        <input type="range" min={0} max={100} step={5} value={settings.fairnessWeight} onChange={num("fairnessWeight")} />
        <div className="help">0 = seul le nombre de véhicules compte. Plus haut = on évite de donner un nouveau shift tardif à qui en a déjà beaucoup fait.</div>
      </div>
      <div className="field">
        <label>Poids de l'équité des week-ends OFF : {settings.weekendWeight}</label>
        <input type="range" min={0} max={100} step={5} value={settings.weekendWeight} onChange={num("weekendWeight")} />
        <div className="help">Pour les échanges de jour OFF : on évite de retirer un samedi ou un dimanche OFF à quelqu'un qui en a déjà peu.</div>
      </div>
      <div className="field">
        <label>Écart de durée maximum entre 2 shifts échangés (min)</label>
        <input type="number" min={0} max={600} step={15} value={settings.maxDurationDiffMin} onChange={num("maxDurationDiffMin")} />
        <div className="help">Évite qu'un agent passe d'un shift de 8 h à un shift de 11 h. Ses heures de la semaine restent donc proches.</div>
      </div>
      <div className="field">
        <label className="check" style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={settings.unknownLevelSwappable} onChange={(e) => set("unknownLevelSwappable", e.target.checked)} />
          <span>Autoriser les échanges entre agents sans niveau</span>
        </label>
        <div className="help">Les agents « niveau inconnu » ne s'échangent qu'entre eux, jamais avec un Perf/Midle/Débutant. Décochez pour les figer.</div>
        <label className="check" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={settings.ignoreLevel} onChange={(e) => set("ignoreLevel", e.target.checked)} />
          <span>Ignorer complètement le niveau</span>
        </label>
      </div>
    </div>
  );
}
