# Maquettes

Huit écrans dessinés dans Claude Design le 13/10/2026. Ils servent de **référence visuelle et fonctionnelle**.
On ne recopie pas leur code tel quel : on reconstruit chaque écran en composants React propres, avec les vraies
données de l'API.

| Fichier | Écran | Rôle |
| --- | --- | --- |
| `MaSemaine.dc.html` | Ma semaine (ordinateur) | Membre : tâches de la semaine, saisie des heures et du statut |
| `MaSemaineMobile.dc.html` | Ma semaine (téléphone, 390 × 844) | Même écran en mobile, barre de navigation en bas |
| `Taches.dc.html` | Tâches à valider | Chef de projet : file d'attente, plusieurs collaborateurs par tâche, valider ou renvoyer |
| `Main.dc.html` | Météo du projet | Chef de projet : indicateurs, une carte par axe, alertes, prochains jalons |
| `PlanDeCharge.dc.html` | Plan de charge | Grille personne × semaine, prévu / déclaré ou écart |
| `Graphes.dc.html` | Graphes | Heures cumulées, heures par semaine, par personne, avancement par axe |
| `Gantt.dc.html` | Gantt et chemin critique | Par pôle ou vue globale, liens de dépendance, jalons, ligne d'aujourd'hui |
| `Reglages.dc.html` | Réglages | Validation des tâches, collaborateurs par tâche |

## Comment lire un fichier `.dc.html`

- Le **balisage dans `<x-dc>`** est l'écran : structure, styles en ligne (`style="…"`), textes.
- Les **trous `{{nom}}`** sont remplis par la méthode `renderVals()` du script `<script type="text/x-dc">` en
  bas du fichier : c'est là que se trouvent les **données d'exemple** et le **comportement** (états,
  boutons, calculs d'affichage). `<sc-for list=… as=…>` = une boucle, `<sc-if value=…>` = une condition.
- Les liens `href="X.dc.html"` relient les écrans entre eux (navigation).
- Le fichier ne s'ouvre pas seul dans un navigateur : il dépend du moteur de Claude Design (`support.js`,
  absent ici). Pour voir le rendu, ouvrir le canevas « App de suivi LENDRR · maquettes » sur claude.ai
  (Tom A. y a accès) ou lui demander des captures.

## Données d'exemple

Les tâches, les heures prévues, les dépendances et les jalons viennent du **vrai planning** au 13/10/2026.
Les heures déclarées, les statuts, l'avancement et trois des quatre alertes de la Météo sont **fictifs**. Les
liens du Gantt suivent l'enchaînement logique ; les 78 vraies dépendances viendront de l'import Asana.

## Jetons de design (historique)

> Remplacés par la DA « Précision » (D23, `web/src/styles/tokens.css`). Les maquettes restent la référence de
> structure et de contenu des écrans, plus du visuel.

| Jeton | Valeur | Usage |
| --- | --- | --- |
| Fond | `#F4F5F7` | Fond des pages |
| Surface | `#FFFFFF` | Cartes, tableaux |
| Encre | `#202326` | Texte, menu latéral, boutons secondaires actifs |
| Bordure | `#D0D5DA` | Bordures de cartes et de champs (champs : `#A9AFB5`) |
| Texte discret | `#5C6268` | Légendes, dates (contraste ≥ 4,5:1 sur blanc) |
| Accent | `#2D5BD7` (texte `#FFFFFF`) | Boutons principaux, chemin critique, sélection |
| Accent foncé / clair | `#1E40AF` / `#E3EBFD` | Liens au survol, puces « En cours » |
| OK | `#2E7D4F` (fond `#E3F1E8`) | Au vert, terminé |
| Attention | `#B7791F` (fond `#FBF1DE`) | À surveiller, heures non saisies |
| Critique | `#B42318` (fond `#FDE7E4`) | Retard, jalon menacé, ligne d'aujourd'hui |

Polices (Google Fonts) : **Space Grotesk** (titres, noms d'axe), **IBM Plex Sans** (texte), **IBM Plex Mono**
(chiffres, dates). Icônes : SVG à trait, jamais d'emoji. Cibles tactiles ≥ 44 px, vrais `<button>`, `<a>`,
`<label>` + `<input>`. Menu latéral qui passe au-dessus du contenu sur téléphone, barre du bas en mobile.
