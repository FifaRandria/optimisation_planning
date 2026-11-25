# Optimisation du planning pour réduire le transport

Application web (Next.js) qui prend le **planning de la semaine S+1** d'un centre de contacts. Elle propose des **échanges de cases entre agents** qui diminuent le nombre de véhicules nécessaires au ramassage du matin et au remisage du soir. Les horaires couverts ne changent pas.

Un véhicule coûte le même prix qu'il transporte 1 ou 15 personnes. Quand un axe n'a qu'un ou deux agents à une heure donnée, on cherche à faire faire ce shift par un collègue de même fonction qui habite sur un axe déjà desservi : le petit véhicule disparaît.

---

## Démarrage avec Docker (recommandé)

L'application et sa base PostgreSQL tournent dans deux conteneurs, décrits dans `docker-compose.yml`. Le `Makefile` regroupe les commandes. Le même fichier sert en local et sur un serveur.

### 1. Installer Docker Engine et `make` (une seule fois)
Sous Windows, on utilise **WSL2 avec Ubuntu**, sans Docker Desktop : celui-ci est payant pour les entreprises de plus de 250 salariés. Dans le terminal **Ubuntu** :

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl make openssl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER      # puis fermer et rouvrir le terminal Ubuntu
docker run --rm hello-world        # vérification
```

Sur un serveur Linux (Ubuntu / Debian), ce sont les mêmes commandes.

### 2. Lancer l'application
```bash
cd /mnt/e/projet/connecteo/transportv1   # le dossier du projet, vu depuis WSL
make init    # crée .env (mot de passe PostgreSQL généré) ; ajustez ADMIN_PASSWORD si besoin
make up      # construit l'image, démarre la base + l'application, attend qu'elles soient prêtes
```
Ouvrez http://localhost:3000 dans Windows. Première connexion : identifiant `admin`, mot de passe `ADMIN_PASSWORD` de `.env` (`Admin@2026!` par défaut). Il doit être changé immédiatement.

### Commandes utiles (`make help`)
| Commande | Effet |
|---|---|
| `make up` / `make down` | démarrer (ou mettre à jour après une modification du code) / arrêter. Les données sont conservées. |
| `make logs` / `make logs s=db` / `make ps` | journaux de l'application ou de la base, état des services |
| `make backup` | sauvegarde de la base dans `backups/AAAA-MM-JJ_HHMM.sql.gz` (dossier non versionné) |
| `make restore f=backups/….sql.gz` | restauration, avec confirmation : remplace les données actuelles |
| `make psql` | console SQL |
| `make dev-db` puis `make dev` | développement : base en conteneur sur `127.0.0.1:5433`, Next.js sur le poste avec rechargement à chaud |
| `make test` | tests de l'algorithme (Node.js requis sur le poste) |
| `make clean` | supprime la base (double confirmation) |

### Ce que contient l'image
- Next.js en mode `standalone`, exécuté par un utilisateur sans privilèges.
- Un healthcheck sur `/api/health` : il vérifie la base et crée le schéma et l'admin initial au premier démarrage.
- **Aucune donnée réelle** : `.dockerignore` exclut `docs/`, les fichiers Excel ou CSV et les `.env`.
- La base n'est pas exposée hors de Docker. Le mot de passe de l'utilisateur dédié `transport_app` n'existe que dans `.env`.

### Déployer sur un serveur
1. Installer Docker Engine (commandes ci-dessus), copier le projet (`git clone`), puis lancer `make init`.
2. Placer un reverse proxy HTTPS (Caddy ou Nginx) devant le port de l'application, et mettre `COOKIE_SECURE=true` dans `.env`.
3. Lancer `make up`, puis programmer `make backup` (cron) et conserver les sauvegardes hors du serveur.

## Démarrage sans Docker

Prérequis : Node.js 20+ et un **PostgreSQL** accessible.

```bash
npm install
cp .env.example .env.local   # puis renseigner DATABASE_URL (utilisateur / mot de passe PostgreSQL)
npm run db:init              # crée la base, les tables et l'administrateur initial
npm run dev                  # http://localhost:3000
```

Première connexion : identifiant `admin`, mot de passe `ADMIN_PASSWORD` de `.env.local` (`Admin@2026!` par défaut). Il doit être changé immédiatement.

### Comptes, rôles et pages
| Page | Utilisateur | Administrateur |
|---|---|---|
| Tableau de bord | ses optimisations | toute l'équipe + comptes + classement par utilisateur |
| Nouvelle optimisation | réglages autorisés par l'admin seulement | tous les réglages |
| Historique (liste, fiche, ré-export Excel) | les siennes | toutes |
| Guide des fichiers | ✓ | ✓ |
| Mon compte (changer son mot de passe) | ✓ | ✓ |
| Administration › Utilisateurs | — | créer (mot de passe par défaut ou généré), rôle, désactiver, réinitialiser, supprimer |
| Administration › Réglages | — | valeurs par défaut de l'organisation + **réglages visibles par les utilisateurs** |

- **Mot de passe provisoire** (admin initial, compte créé, mot de passe réinitialisé) : changement **obligatoire** à la première connexion. Avant, l'application et ses API sont bloquées.
- **Mots de passe** : au moins 10 caractères, minuscules, majuscules et un chiffre. Ils sont hachés avec scrypt et salés.
- **Sessions** : cookie httpOnly, sessions stockées en base et révoquées au changement ou à la réinitialisation du mot de passe, ou à la désactivation du compte. 5 échecs de connexion de suite verrouillent l'identifiant pendant 5 minutes.
- **Réglages masqués** : un utilisateur ne voit ni ne modifie les réglages masqués (par défaut : règles d'échange, équité, niveau). Le serveur leur applique toujours la valeur de l'organisation, même si la requête en contient une autre.
- **Garde-fous** : il reste toujours au moins un administrateur actif, et un admin ne peut ni se rétrograder ni supprimer son propre compte.
- **Données** : l'historique conserve le résultat complet (compressé) dans PostgreSQL. Il contient des noms d'agents : la base est confidentielle, comme les fichiers d'entrée.

### Utilisation
1. Choisir le **site** (Connecteo Andranomena ou SIRIUS Galaxie Andraharo), puis déposer les fichiers Excel de ce site, ou cliquer « Essayer avec des données d'exemple ».
2. Vérifier ce que l'outil a détecté et ajuster les réglages.
3. Cliquer « Optimiser ». On obtient la synthèse avant/après, les échanges proposés, le planning corrigé (cases modifiées en jaune), les listes de transport par axe et par chauffeur, et les alertes.
4. Télécharger le planning corrigé, les échanges ou le classeur complet.

### Modifier le planning corrigé (renforts, absences, changements d'horaire)
Après l'optimisation, la fiche de l'historique (onglet **Planning corrigé** › **Modifier le planning**) permet d'ajuster le planning sans repartir de zéro.
- **Cliquer sur une case** : horaire, OFF, absent (code libre) ou congé. Les **jours passés** (fuseau Indian/Antananarivo) sont figés.
- **Ajouter un renfort** : une personne de la liste des agents, ou saisie à la main (matricule, fonction, axes).
- **Coût visible avant de valider** : véhicules par jour avant → après, et pour la case choisie les vagues de son axe qui ont encore des **places libres** (y placer la personne ne coûte aucun véhicule). La liste des **petits véhicules** (4 personnes ou moins) à venir est affichée.
- **Ré-optimiser autour des modifications** (coché par défaut) : l'algorithme est relancé, mais ne touche ni aux jours passés, ni aux cases modifiées à la main, ni aux échanges déjà annoncés (cases déjà différentes du planning publié). Décoché : recalcul du transport seulement.
- **Aperçu** avant d'enregistrer, puis **Enregistrer** : chaque enregistrement crée une **version** (v1, v2…), avec motif, commentaire, auteur et date. Les versions précédentes restent consultables (barre « Versions du planning »). Si quelqu'un a enregistré entre-temps, l'enregistrement est refusé : il faut recharger la page.
- Exports : feuille **« Modifications »** (planning, tout en un) et **« Changements transport »** par rapport à la version précédente (listes de transport, tout en un), à transmettre aux chauffeurs.
- Le tableau de bord et l'historique comptent les véhicules de la **dernière version**.
- Les entrées analysées (agents, axes, aménagements) sont conservées avec chaque optimisation (`inputs_gz`) : les optimisations faites avant cette évolution restent consultables mais ne sont pas modifiables (relancez-les).
- La démo du site commence au prochain lundi, pour pouvoir essayer les modifications.

En ligne de commande :

```bash
npm run test:real -- planning.xlsx personnes-par-fonction.xlsx axes.xlsx            # réglages par défaut
npm run test:real -- planning.xlsx personnes-par-fonction.xlsx axes.xlsx --compare  # compare 3 variantes
npx tsx scripts/exemple-fictif.ts                                                     # exemple fictif détaillé
npx tsx scripts/test-versions.ts                                                      # versions : renfort, absence, verrous (contrôles à 0)
```

`run-real.ts` affiche les véhicules avant et après, puis des **contrôles d'invariants qui doivent tous valoir 0** (voir « Garanties »).

> 🔒 Les données réelles (plannings, listes d'agents, adresses) sont **confidentielles** et ne sont pas dans ce dépôt (`.gitignore`). Seul l'exemple fictif de `docs/algo-optimisation/` est versionné.

---

## Les fichiers d'entrée

Les feuilles sont **reconnues automatiquement par leurs en-têtes** : leur nom et leur ordre n'ont pas d'importance. Accents, majuscules, ponctuation et texte mal encodé (« CongÃ© ») sont tolérés.

| Rôle | Contenu attendu | Exemple réel |
|---|---|---|
| **Planning** (obligatoire) | `Matricule`, puis pour chaque jour « heure d'arrivée » et « heure de départ ». Les dates sont soit en en-tête (planning hebdo S+1), soit données par une ligne de numéros de jour avec une colonne `Mois` (planning mensuel). Une case contient une heure, `OFF`, ou un code (C, CM, RC, CP, Récup, CONGE…). | « Planning Agents S+1 », planning mensuel |
| **Agents** (obligatoire) | `Matricule`, **`Fonction`**, et soit `Axe 21h` / `Axe 23h`, soit une commune (`Commune / Fokotany`, `Repère`, `Quartier`). En option : `Niveau`, `Tardifs historique`. Plusieurs feuilles sont fusionnées ; la feuille qui contient la fonction et les axes passe en priorité. | Personnes-par-fonction |
| **Axes** (facultatif si les agents ont leurs axes) | Commune → `Axe 23h`, `Axe 21h`, chauffeurs, `Durée en minutes`. | Feuille « Axes » du fichier WFM transport |
| **Aménagements** (facultatif) | `Matricule`, `Aménagement` (texte libre), `Début aménagement` / `Fin aménagement` (facultatif), dates de congé. | Amenagement_S41 |

Des modèles Excel vides sont téléchargeables depuis l'écran.

### Sites : Connecteo et SIRIUS

Le transport part de deux sites, **optimisés séparément** :

| Site | Lieu | Vagues par défaut |
|---|---|---|
| **Connecteo** | Andranomena, zone Futura | ramassage 6h ; remisages 18h → 23h |
| **SIRIUS** | Galaxie Andraharo | shifts AM (6h–13h) et PM (13h–21h) : ramassage 6h, remisage 21h (13h et 11h activables) |

- Le site est choisi **avant** de déposer les fichiers. La table des axes fournie doit être celle **au départ de ce site** (SIRIUS a ses propres axes et chauffeurs).
- Les règles d'échange sont les mêmes (même fonction, paires OFF, réserve, aménagements, TERSEA), mais un agent n'est jamais échangé ni remplacé par un agent d'un autre site : chaque optimisation ne contient que les fichiers d'un site.
- Chaque site a ses **réglages** (Administration › Réglages, un onglet par site) et son **historique** (colonne et filtre « Site »). Les optimisations antérieures aux sites sont rattachées à Connecteo, et Connecteo reprend les réglages de l'organisation existants.
- Le planning SIRIUS d'origine (`LISTE_CSA_BO_MVOLA_SHIFTE_SIRUIS…`) est lu tel quel : en-têtes de jour sans année (« lun-09-nov »), feuille `Feuil1` masquée, adresse dans la colonne `QUARTIER`.
- Jeu de test fictif SIRIUS : `npx tsx scripts/fictif-sirius.ts [lundi]` écrit planning, agents, axes et aménagements dans `docs/fichiers-test/sirius-semaine-<lundi>/` (axes et chauffeurs **inventés**, à remplacer par la vraie table).


### Page « Axes » : créer les axes d'un site sur une carte (Administration › Axes)

Pour un site sans table d'axes (SIRIUS), ou pour refaire celle d'un site :

1. **Déposer un fichier** : liste des agents (Quartier, Commune, Point de remisage…), le planning SIRIUS tel quel, ou une liste Commune / Adresse / Latitude / Longitude. Un point de la carte = un quartier.
2. **Position des quartiers**, dans l'ordre : coordonnées du fichier → position déjà enregistrée pour le site → **répertoire officiel des fokontany** (hors ligne, voir ci-dessous) → géocodage OpenStreetMap du serveur s'il est installé. Les autres se placent d'un clic sur la carte. Le marqueur du site se déplace aussi.
3. **Contraintes**, séparément pour la colonne « Axe 23h » et la colonne « Axe 21h » (SIRIUS : ramassage 6h / remisage 21h) : nombre de chauffeurs, durée max d'un axe, détour max par arrêt, coefficient de trafic, noms des chauffeurs.
4. **Calculer les axes** (`lib/axes-builder.ts`) : balayage angulaire autour du site, ordre des arrêts (plus proche voisin + 2-opt), puis échanges de points entre axes. Un quartier qui ne peut respecter les contraintes reste **hors axe** au lieu de les casser.
5. **Corriger** (changer l'axe d'un quartier, le déplacer), **réévaluer**, puis **enregistrer** : la table devient celle du site, avec historique des versions, réactivation et export Excel au format « Axes ».
6. **Optimisation** : sans fichier d'axes déposé, la table enregistrée du site est utilisée. Un fichier d'axes déposé reste prioritaire.

**Itinéraires et géocodage sur le serveur (aucune adresse ne sort)** : `make map-init` télécharge l'extrait OpenStreetMap de Madagascar (Geofabrik), prépare OSRM (durées et tracés routiers réels) et importe Nominatim (géocodage), environ 30 à 60 min la première fois, puis `make map-up`. Sans ces services, les durées sont estimées à vol d'oiseau (× 1,4, 22 km/h) et les tracés sont des lignes droites, ce qui est signalé à l'écran. Seul le fond de carte (tuiles OSM) est chargé depuis Internet, et il ne transmet que la zone affichée.

**Données ouvertes HDX** (`make map-hdx`, données dans `map-data/hdx/`, non versionnées) :

| Jeu de données (HDX) | Licence | Utilisation |
|---|---|---|
| [COD-AB Madagascar](https://data.humdata.org/dataset/cod-ab-mdg) (OCHA / BNGRC) : 24 régions, 120 districts, 1 645 communes, 17 465 fokontany | CC BY-IGO | `scripts/build-gazetteer.ts` en tire `lib/geo/gazetteer-analamanga.json` (139 communes, 1 660 fokontany d'Analamanga, 155 Ko, versionné). Chaque quartier est placé au **centre de son fokontany**, sans connexion. Position des deux sites : fokontany Andranomena et Andraharo. |
| [Populated Places](https://data.humdata.org/dataset/madagascar-settlements) (NGA / OCHA, 2007) | Other | Téléchargé pour référence, non utilisé (ancien, surtout rural). |
| [Roads of Madagascar](https://data.humdata.org/dataset/hotosm_mdg_roads) (HOTOSM) | ODbL | Non téléchargé : ce sont les routes OpenStreetMap, déjà dans l'extrait utilisé par OSRM. |

Sur les fichiers réels, le répertoire retrouve 94 % des quartiers du planning SIRIUS, 98 % de la feuille « Axes » du WFM et 95 % de Personnes-par-fonction, soit 91 à 99 % des agents. Exemples : « LOT IA D 23 A ANTANETIBE ITAOSY » → fokontany Antanetibe ; « 67 ha Sud » → 67ha Atsimo ; « Manjakaray » → groupe Manjakaray II B/C/D. Introuvables : Ambohimanarina (absent du répertoire officiel) et quelques adresses incomplètes. La précision est celle du fokontany, pas de l'adresse : elle suffit pour découper des axes.

**Fichier de test et fiabilité** : `npx tsx scripts/test-fichier-axes.ts [site]` écrit `docs/fichiers-test/axes-carte/test-axes-<site>.xlsx`. Ce sont 180 agents fictifs répartis sur 60 vrais fokontany à moins de 15 km du site, écrits de façon « sale » (Lot…, minuscules, « - Antananarivo 4 », Sud/Nord, nom tronqué), plus des quartiers inventés. La feuille « Vérité » donne la réponse attendue. Le script rejoue la page et mesure la fiabilité. Résultat actuel (SIRIUS) : **90 % des quartiers bien placés** (100 % quand le nom est unique, 33 % quand le même nom existe plusieurs fois autour du site), **100 % des quartiers inventés refusés**, **100 % des contraintes respectées**, et un découpage identique à celui des positions exactes pour 78 à 87 % des paires de quartiers.
---

## v1 → v2 : ce qui a changé

### v1 (première version)
- Transport pour tout shift qui finit **à 19h ou après**, en deux vagues : 19h (fin entre 19:00 et 20:59) et 21h (fin à 21:00 ou après, nuit comprise).
- **Une seule colonne d'axe** (celle qui contient « 21h ») pour toutes les vagues.
- Un seul mouvement : **échanger deux shifts le même jour** entre deux agents du même **niveau** (Perf / Midle / Débutant).

### Pourquoi une v2
Les données réelles ont montré trois écarts :
1. **La fonction** : deux agents de fonctions différentes ne peuvent pas s'échanger, car l'un n'a pas les compétences de l'autre. Sur une semaine réelle, 239 des 530 agents placés dans un petit véhicule (4 personnes ou moins) n'avaient plus **aucun** partenaire possible le même jour. Le gain baissait fortement.
2. **Les vraies vagues** : le ramassage ne concerne que les arrivées à **6h**. Le remisage concerne les sorties à **18h, 19h, 20h, 21h, 22h et 23h**, et **chaque heure est une vague séparée**, avec ses véhicules.
3. **Deux colonnes d'axe** : `Axe 21h` sert aux vagues de 21h et 22h ; `Axe 23h` sert au ramassage de 6h et aux remisages de 18h, 19h, 20h et 23h.

### v2
- Échanges **uniquement entre agents de même fonction**. La fonction exacte vient de la liste des agents ; celle du planning, trop générique, ne sert qu'en dernier recours.
- Vagues réelles :
  - ramassage = arrivée pile à 6:00 ;
  - remisage = sortie arrondie à l'heure supérieure (21:30 → vague 22h) ;
  - aucun transport pour les shifts qui passent minuit (19h → 06h) ni pour les autres horaires (un shift qui finit à 15h ou commence à 9h).
- Axe choisi selon la vague.
- **Nouveau mouvement : l'échange par paire jour travaillé ↔ jour OFF**, dans la même semaine (détails plus bas).
- **Équité des week-ends** : on évite de retirer un samedi ou un dimanche OFF à quelqu'un qui en a déjà peu.
- Seul un vrai `OFF` est échangeable. C, CM, RC, CP, Récup, CONGE et les codes inconnus sont figés.
- Lecture du planning mensuel (colonne « Mois » et numéros de jour).

### Résultats sur un mois réel (891 agents, 31 jours, mêmes vagues réelles)

| Variante | Véhicules | Gain |
|---|---|---|
| Sans contrainte de fonction (logique v1) | 1799 → 1150 | −36,1 %, mais **irréalisable** : la couverture par fonction n'est pas respectée |
| Fonction seule | 1799 → 1431 | −20,5 % |
| Fonction + échange jour OFF (v2) | 1799 → 1373 | −23,7 % |
| **+ réserve hors planning (v2.1)** | 1799 → 1358 | **−24,5 %** |

*(Mesures avec IT.xlsx chargé, donc avec la règle de pôle, ce qui explique le léger écart avec la v2 initiale, −23,5 %.)*

L'échange de jour OFF récupère environ 15 % de gain en plus, sans changer la couverture d'aucun jour. La réserve ajoute 15 véhicules sur le mois, avec 40 remplacements (d'une semaine chacun), tous à confirmer.

### v2.1 — remplacement par une personne hors planning (« réserve »)
- Une personne présente dans la **liste principale des agents** (ex. Personnes-par-fonction) mais **absente du planning** peut reprendre **toute la semaine** d'un agent planifié : mêmes shifts, mêmes OFF. L'agent remplacé reçoit `REMPLACÉ` sur sa semaine et passe hors planning cette semaine-là.
- Conditions : **même fonction**, **même pôle** (FO / BO / SUPPORT, colonne « Pôles » d'IT.xlsx, vérifié quand il est connu des deux côtés) et même niveau s'il est renseigné. La semaine de l'agent ne doit contenir que des shifts et des OFF, et le remplaçant ne sert qu'une fois par semaine.
- Personnes écartées de la réserve : aménagement, congé cette semaine-là, « Etat du collaborateur » = INACTIF, date de départ passée.
- **La liste est considérée comme fiable** : l'écran avertit qu'une personne listée mais réellement indisponible (formation, congé, autre campagne) donnerait un remplacement inapplicable. Chaque remplacement est marqué **« à confirmer »**.
- À note égale, l'algorithme préfère toujours le planning existant : même jour, puis jour OFF, puis réserve.
- La règle de pôle s'applique aussi aux deux autres mouvements.
- Repos : à l'intérieur de la semaine, le remplaçant a les horaires de l'agent remplacé. On vérifie seulement les bords de la semaine, au cas où il remplace quelqu'un d'autre la semaine voisine.

---

## Fonctionnement de l'algorithme (`lib/optimize.ts`)

### 1. Préparer chaque agent
- **Fonction** : lue dans la liste des agents, normalisée (accents et majuscules ignorés).
- **Axes** : `Axe 21h` et `Axe 23h` lus directement, sinon déduits de la commune avec la table des axes. On cherche d'abord une correspondance exacte, puis par début de mot (au moins 5 lettres) si elle ne mène qu'à un seul axe. La durée du trajet sert à départager deux candidats égaux.
- **Agent figé** (jamais échangé) s'il a un aménagement, s'il est absent de la liste, s'il n'a ni axe ni fonction, ou s'il n'a pas de niveau quand le réglage l'interdit. Les dates de congé des aménagements bloquent ses jours.
- **Aménagements des deux personnes :** un échange exige que les deux personnes soient libres. Si l'une des deux a un aménagement, quel qu'en soit le texte (santé, horaire imposé, OFF imposé…), l'échange est refusé ; la règle vaut aussi pour la réserve hors planning. Exception **optionnelle** (réglage « Échanger les agents avec un rôle seul », `swapRoles`, désactivé par défaut) : un aménagement qui n'est qu'un rôle (« RENFORT DIGITAL », « TEAM LEAD », sans autre mention) ne fige pas la personne. Contrôlé par `amenTouched` dans `scripts/run-real.ts`.
- **Période d'un aménagement :** avec les colonnes facultatives `Début aménagement` / `Fin aménagement` (ou `Date début` / `Date fin`), l'aménagement ne bloque que les jours de sa période : l'agent reste échangeable les autres jours de la semaine. Une période hors de la semaine est sans effet (alerte d'info). **Sans date, l'aménagement fige l'agent toute la semaine.** Les colonnes `Congé` restent des dates de congé : elles ne sont jamais lues comme la période de l'aménagement. Une personne dont l'aménagement touche la semaine ne sert pas de réserve.
- **Employés TERSEA :** ils sont traités comme des aménagements, donc jamais échangés, jamais remplacés par la réserve et jamais utilisés comme réserve. Un agent est reconnu comme TERSEA quand « TERSEA » figure dans sa fonction (liste des agents ou planning) ou dans une colonne Rattachement, CDO, Recap, Société, Entreprise, Employeur, Prestataire ou Client (IT.xlsx). Une alerte donne leur nombre. Le planificateur peut toujours modifier leur planning à la main depuis la fiche (« Modifier le planning »). Contrôlé par `frozenTouched`.
- **Compteurs d'équité** : `tardifs` = historique + nombre de shifts avec remisage ; `weOff` = nombre de samedis et dimanches OFF.

### 2. Grouper : une vague + un axe = un véhicule
Pour chaque case, `lib/waves.ts` calcule ses transports : `R6` (ramassage 6h) et/ou `D18` à `D23` (remisage). La clé d'un groupe est `vague|axe` ; l'axe dépend de la vague (`Axe 21h` ou `Axe 23h`).

```
véhicules d'un jour = Σ  ⌈ taille du groupe ÷ capacité ⌉      (capacité = 15 par défaut)
```

Les compteurs sont tenus à jour **de façon incrémentale** : chaque modification de case ne recalcule que les groupes touchés. C'est ce qui rend le mois réel calculable en quelques secondes.

### 3. Les trois mouvements possibles

**a) Échange du même jour** (déjà présent en v1)
A et B travaillent tous les deux le jour J : A prend le shift de B, B prend celui de A.

**b) Échange par paire jour travaillé ↔ jour OFF** (nouveau en v2)
```
            jour J (tardif)     jour K (même semaine)
avant   A : 12:00-21:00         OFF
        B : OFF                 08:00-17:00
après   A : OFF                 08:00-17:00
        B : 12:00-21:00         OFF
```
- Chaque jour, exactement les mêmes horaires sont couverts dans la fonction : les prévisions WFM ne bougent pas.
- A et B gardent chacun le même nombre de jours OFF dans la semaine.
- J et K appartiennent à la même semaine (du lundi au dimanche).

**c) Remplacement par la réserve** (nouveau en v2.1)
R, présent dans la liste des agents mais absent du planning, reprend toute la semaine de A (mêmes shifts, mêmes OFF) ; A reçoit `REMPLACÉ` sur la semaine. Le coût est compté sur les 7 jours. Voir la section v2.1 pour les conditions.

**Règles de validité, communes aux trois mouvements :**
1. A ≠ B, **même fonction**, **même pôle** quand il est connu des deux côtés, et même niveau (le niveau est ignoré si on le demande) ;
2. aucun des deux n'est figé ; aucune case touchée n'est verrouillée ni en congé ;
3. les deux shifts échangés ont une durée proche (écart de 60 min au plus par défaut), ce qui garde les heures de la semaine ;
4. **repos ≥ 13 h** pour les deux agents, autour de chaque jour modifié ;
5. seules des cases « shift » et « OFF » bougent.

### 4. Noter les candidats
Chaque candidat est essayé (appliqué puis annulé) :

```
note = Δvéhicules × 1000 + poids_tardifs × Δ Σ tardifs² + poids_weekend × Δ Σ weOff²
```

- Δvéhicules couvre **tous les jours touchés** : J seul, ou J et K pour un échange OFF. Si un échange OFF ajoute un véhicule le jour K, il est compté.
- Les sommes de carrés pénalisent le fait de donner un shift tardif, ou de retirer un week-end OFF, à quelqu'un qui en a déjà beaucoup (ou peu).
- Le ×1000 fait que supprimer un véhicule l'emporte presque toujours sur l'équité.
- En cas d'égalité, on prend dans l'ordre : l'échange du même jour, puis l'échange OFF, puis la réserve (moins de changements d'abord), puis le plus petit compteur de tardifs, puis le trajet le plus court, puis l'ordre du fichier.

### 5. Le plan : fermer un groupe entier, ou rien
- Jour par jour, on prend les groupes **du plus petit au plus grand**. Un groupe est ignoré s'il dépasse la capacité, s'il contient un agent figé, verrouillé, en congé ou sans axe.
- Pour chaque membre, du trajet le plus long au plus court, on applique le meilleur mouvement et on **verrouille** les cases touchées.
- Si un seul membre n'a aucun mouvement valide, **tout le plan est annulé**.
- Le plan est accepté si `gain > 0` et `−gain × 1000 + équité < 0`. Sinon, tout est défait et on passe au groupe suivant.
- Après un plan accepté, les groupes du jour sont recalculés. On refait des passes sur toute la période jusqu'à ce qu'aucun plan ne soit plus accepté.

---

## Garanties (vérifiées par `scripts/run-real.ts`)

| Contrôle | Doit valoir |
|---|---|
| Jours où la couverture *jour × fonction × horaire* a changé | 0 |
| Agents dont le nombre de OFF par semaine a changé | 0 |
| Cases figées (congé, code, agent figé) modifiées | 0 |
| Nouveaux repos de moins de 13 h | 0 |
| Échanges entre fonctions différentes | 0 |
| Échanges entre pôles différents (quand ils sont connus) | 0 |
| Échanges OFF à cheval sur deux semaines | 0 |
| Remplacements où la semaine du remplaçant ≠ celle de l'agent remplacé | 0 |

Limite connue : le repos avec la veille du premier jour (semaine précédente, absente du planning S+1) ne peut pas être vérifié. Une alerte le signale.

---

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| Capacité d'un véhicule | 15 | ⌈ personnes ÷ capacité ⌉ véhicules par groupe |
| Repos minimum | 13 h | entre la fin d'un shift et le début du suivant |
| Ramassage : arrivées à | 6 | heures pile ramassées |
| Remisage : sorties à | 18, 19, 20, 21, 22, 23 | une vague par heure (demi-heure → heure suivante) |
| Vagues utilisant « Axe 21h » | 21, 22 | les autres utilisent « Axe 23h » |
| Même fonction | oui | décocher seulement pour mesurer le gain perdu |
| Échange jour OFF | oui | active le mouvement b) |
| Réserve hors planning | oui | active le mouvement c) |
| Rôles seuls échangeables | non | « RENFORT DIGITAL » / « TEAM LEAD » sans autre mention ne figent plus la personne |
| Équité tardifs / week-ends | 10 / 10 | 0 = seul le nombre de véhicules compte |
| Écart de durée max | 60 min | entre deux shifts échangés |
| Niveau | respecté | un niveau inconnu ne s'échange qu'avec un niveau inconnu, sauf si « ignorer le niveau » est coché |

---

## Organisation du code

```
app/login               page de connexion
app/(app)/              pages protégées : tableau de bord, optimiser, historique, guide, compte, admin/*
app/api/                routes API : auth, me, users, settings, history, inspect, optimize, export, templates
components/             écran : coquille (navigation), optimisation, résultats, réglages, administration
lib/server/             serveur uniquement : PostgreSQL (db), mots de passe, sessions, comptes, réglages, historique
lib/settings-meta.ts    groupes de réglages et visibilité par défaut pour les utilisateurs
scripts/db-init.ts      création de la base, des tables et de l'admin initial (npm run db:init)
lib/parse.ts            détection automatique des feuilles et lecture des fichiers Excel
lib/waves.ts            vagues de ramassage / remisage (partagé serveur et écran)
lib/optimize.ts         algorithme d'optimisation (option `locked` : cases et jours verrouillés)
lib/versions.ts         versions du planning corrigé : modifications, verrous, ré-optimisation, différences de transport
lib/transport-cost.ts   coût transport calculé à l'écran pendant les modifications
lib/export.ts           classeurs Excel de sortie
lib/templates.ts        modèles Excel et données de démo
lib/sample.ts           jeu de données fictif (démo)
lib/util.ts             normalisation, heures, dates, semaines, correction d'encodage
scripts/run-real.ts     exécution en ligne de commande + contrôles d'invariants
scripts/exemple-fictif.ts  exemple détaillé (docs/algo-optimisation)
docs/algo-optimisation/ présentation de l'algorithme + exemple fictif (données inventées)
```

### Exemple fictif
`npx tsx scripts/exemple-fictif.ts` génère et relit les 4 classeurs de `docs/algo-optimisation/` :
- **lundi** : Alice ⇄ Hery, puis David ⇄ Emma, ce qui ferme les axes 1 et 3 à 21h. Nina, d'une autre fonction, est refusée alors qu'elle aurait été la meilleure candidate.
- **mardi ↔ mercredi** : échange de jour OFF entre Olga et Paul (même fonction), ce qui ferme l'axe 1 à 21h.
- **mercredi** : Tiana, hors planning, CSA Digital, pôle FO, reprend la semaine de Rina (même fonction, même pôle), ce qui ferme l'axe 3 à 21h. Ulrich (pôle BO) est refusé alors qu'il est à égalité et listé avant elle.
- Résultat : **7 → 3 véhicules**.

> La présentation `Algorithme_Optimisation_Planning.pptx` décrit encore la v1 (vagues 19h/21h, niveau). La logique du lundi y reste valable.
