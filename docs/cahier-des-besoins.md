# App de suivi du planning LENDRR — cahier des besoins

Version du 13/10/2026 · auteur : Tom A. (chef de projet)
Source : doc Claude « App de suivi du planning LENDRR », exportée pour Claude Code.

> Vocabulaire. **Chef de projet** = Tom A., rôle applicatif « Pilote ». Sur une tâche, le **pilote de la tâche**
> est le collaborateur responsable, les autres sont en **appui**. Les deux sens de « pilote » coexistent dans
> ce document : « pilote du projet » = chef de projet.

## Objectif et périmètre

L'app remplace Asana : on y crée, date, relie et coche les tâches, on y suit la charge prévue et réelle de
chacun, et on y prépare la soutenance « organisation ». Elle devient le seul outil de planning de l'équipe.

Tom A. la code en dehors de ses 4 h hebdomadaires : elle n'entre pas dans le planning du projet. C'est une app
web responsive, utilisable sur ordinateur comme sur téléphone.

**Elle fait** : gérer les tâches, les axes, les jalons et les dépendances ; décaler automatiquement les tâches
qui suivent un retard ; recueillir les heures réellement passées ; calculer la charge, le chemin critique et
les alertes ; afficher le Gantt et la météo de chaque axe ; produire une synthèse hebdomadaire et un export
pour la soutenance.

**Elle ne fait pas** : messagerie, gestion de code, stockage de documents (ils restent sur le Drive).

**Réussie si** le point d'équipe du lundi se fait depuis l'app en 30 minutes, et si la soutenance
« organisation » s'appuie sur ses chiffres de prévu contre réalisé.

**Bascule** : Asana reste l'outil de l'équipe tant que l'app ne gère pas les tâches et leurs dépendances. On
bascule en une fois, après avoir importé les 81 tâches du projet Asana, puis on arrête Asana.

## Utilisateurs et rôles

Toute l'équipe utilise l'app, avec deux rôles seulement. Chacun voit tout le planning ; seul le pilote règle
l'outil.

| Rôle | Qui | Ce qu'il voit | Ce qu'il fait |
| --- | --- | --- | --- |
| Membre | Les 6 : Tom A., Tom G., Sophie, Erwen, Djessen, Reda | Sa semaine, sa charge, ses alertes, le planning de toute l'équipe | Passe ses tâches en cours ou terminées, les commente, déclare ses heures réelles chaque semaine ; propose des tâches si les réglages l'autorisent |
| Pilote | Tom A. | En plus : les alertes de toute l'équipe, la synthèse, l'export | Crée, date, relie et répartit les tâches ; valide celles que les membres proposent ou modifient ; règle les capacités (4 h par défaut, absences) et les seuils d'alerte |

La capacité est réglable par personne et par semaine. Elle couvre deux cas : une absence prévue, et Tom A.,
dont 1 h par semaine part au pilotage.

## Données

Toutes les données vivent dans l'app : le pilote y construit le planning, les membres y déclarent l'avancement
et leurs heures. Asana ne sert qu'une fois, pour importer les 81 tâches existantes.

```
Pilote ──(planning : tâches, dates, dépendances, répartition)──┐
6 membres ──(statuts, commentaires, heures réelles)────────────┼──► Données de l'app ──► Calculs ──► Écrans
Asana ──(import unique des 81 tâches)───────────────────────────┘    (charge, décalage, chemin critique, alertes)
```

La photo du planning prise chaque lundi est la référence du prévu : sans elle, chaque date décalée effacerait
l'écart que la soutenance doit justement montrer. Une tâche porte un pilote et des appuis, chacun avec ses
heures prévues : c'est ce qui permet de calculer la charge de chaque personne, et pas seulement celle du
pilote. L'app étant la seule source, elle doit être sauvegardée chaque jour.

## Fonctionnalités de la V1

La V1 compte onze fonctions, à construire dans cet ordre. La bascule depuis Asana devient possible après les
quatre premières. La saisie des heures vient juste après, car chaque semaine sans saisie est perdue pour le
prévu contre réalisé.

| Ordre | Fonction | Ce que l'utilisateur obtient |
| --- | --- | --- |
| 1 | Tâches, axes et jalons | Créer, dater, assigner une ou plusieurs personnes (un pilote, des appuis) avec chacune ses heures, commenter, passer en cours ou terminée |
| 2 | Dépendances et décalage automatique | Relier les tâches ; quand une tâche recule, celles qui en dépendent reculent d'elles-mêmes |
| 3 | Ma semaine | Chacun voit ses tâches de la semaine et met à jour leur statut |
| 4 | Import depuis Asana | Les 81 tâches, leurs dates, dépendances, statuts et répartitions repris en une fois |
| 5 | Saisie des heures | « 1,5 h sur cette tâche », en moins d'une minute par semaine, depuis « Ma semaine » ou directement depuis la fiche de la tâche (section « Mes heures » : semaine au choix, boutons +0,5 / +1 / +2 h) |
| 6 | Plan de charge | Pour chaque personne et chaque semaine : prévu, réel et capacité, côte à côte |
| 7 | Alertes | Surcharges, retards, heures non déclarées, jalons menacés, au moment où ils apparaissent |
| 8 | Gantt et chemin critique | La frise des tâches et leurs dépendances ; on déplace une barre pour changer ses dates, et un clic sur une barre, un titre ou un jalon ouvre la fiche de la tâche par-dessus la frise ; la chaîne qui fixe la date de soutenance est mise en évidence |
| 9 | Météo par axe | Pour HARD, SOFT, IA, Vidéo et Pilotage : avancement, retards, prochain jalon et son risque |
| 10 | Synthèse et export | Le résumé de la semaine pour le point du lundi, et le prévu contre réalisé pour la soutenance |
| 11 | Validation des tâches | Le chef de projet relit et valide chaque tâche proposée ou modifiée avant qu'elle apparaisse chez ses collaborateurs ; option activable dans les réglages, prévue dans les données dès la fonction 1 |

L'export doit être prêt avant la préparation de la soutenance « organisation », qui commence le 30/11/2026.

## Règles de calcul et d'alerte

Toutes les règles se calculent à partir de trois chiffres : la charge prévue, la charge réelle et la capacité,
par personne et par semaine. Les seuils ci-dessous sont des propositions, réglables par le pilote.

- **Charge prévue** : la somme des heures allouées à la personne, comme pilote ou comme appui, sur les tâches
  de la semaine. Une tâche qui couvre plusieurs semaines est répartie au prorata de ses jours ouvrés.
- **Charge réelle** : la somme des heures qu'elle a déclarées pour la semaine.
- **Capacité** : 4 h par défaut, 3 h pour Tom A. sur les axes techniques, 0 h pendant une absence.
- **Décalage automatique** : quand la fin d'une tâche recule, chaque tâche qui en dépend recule seulement si
  elle chevauche désormais sa prédécesseure, en jours ouvrés. Les jalons ne bougent jamais seuls : s'ils sont
  dépassés, une alerte se lève.
- **Chemin critique** : calcul classique sur les dépendances fin-début, en jours ouvrés. Une tâche sans marge
  est critique : si elle glisse, la soutenance glisse.
- **Validation des tâches** : quand l'option est active (par défaut), une tâche créée par un membre, ou
  modifiée dans ses dates, ses heures ou ses collaborateurs, passe « en attente ». Elle n'apparaît dans Ma
  semaine, le plan de charge et les alertes de ses collaborateurs qu'après validation par le chef de projet ;
  pendant ce temps, l'ancienne version d'une tâche modifiée reste en vigueur. Les décalages automatiques ne
  repassent pas par la validation. Un rappel part après 2 jours d'attente, et un suppléant peut valider en
  l'absence du chef de projet.
- **Plusieurs collaborateurs** : une tâche a un ou plusieurs collaborateurs, chacun avec ses heures prévues,
  qui comptent dans sa charge. Un seul est pilote de la tâche et reçoit les alertes de retard, les autres sont
  en appui ; une tâche sans pilote ne peut pas être validée. En option, un total d'heures peut être réparti à
  parts égales.

| Alerte | Se déclenche quand | Qui la voit |
| --- | --- | --- |
| Surcharge prévue | La charge prévue dépasse la capacité sur une semaine à venir | La personne et le pilote |
| Dépassement réel | Le réel dépasse le prévu d'une tâche de plus de 25 % ou de plus de 1 h | La personne et le pilote |
| Heures non déclarées | Le lundi à 12 h, la semaine écoulée n'a aucune saisie | La personne |
| Tâche en retard | L'échéance est passée et la tâche n'est pas terminée | Le pilote de la tâche et le pilote du projet |
| Retard bloquant | Une tâche en retard a une tâche dépendante qui commence dans moins de 7 jours | Les deux pilotes concernés et le pilote du projet |
| Jalon menacé | Une tâche du chemin critique est en retard, ou la marge vers un jalon devient négative | Toute l'équipe |
| Tâche incomplète | Une tâche n'a pas de pilote, de date ou d'heures prévues | Le pilote du projet |

## Écrans

Huit écrans suffisent (plus Graphes et la file de validation, ajoutés depuis dans les maquettes). « Ma
semaine » s'ouvre par défaut pour les membres, la « Météo » pour le pilote.

| Écran | Pour qui | Ce qu'il montre |
| --- | --- | --- |
| Ma semaine | Chaque membre | Ses tâches de la semaine avec leur statut, la saisie des heures sur chacune, sa charge prévue et réelle face à sa capacité, ses alertes |
| Tâches | Tous ; propositions par les membres, validation par le pilote | La liste par axe, filtrable par personne et par statut ; la fiche d'une tâche avec ses dates, sa répartition, ses dépendances, ses commentaires et ses heures ; pour le pilote, la file des tâches à valider |
| Météo | Tous, par défaut pour le pilote | Une carte par axe : avancement, tâches en retard, prochain jalon et son risque, alertes en cours |
| Plan de charge | Tous | Un tableau personne × semaine, prévu et réel dans chaque case, coloré selon l'écart à la capacité ; une vue Graphes associée |
| Gantt | Tous ; déplacement des barres par le pilote ; clic sur une tâche ou un jalon : sa fiche (adresse `/gantt/<id>`) | La frise des tâches groupées par axe ou en vue globale, les dépendances, le chemin critique en surbrillance, les jalons, la ligne d'aujourd'hui |
| Alertes | Pilote | Toutes les alertes ouvertes, triées par gravité, chacune ouvrant la fiche de la tâche |
| Synthèse et export | Pilote | La synthèse de la semaine à relire, et l'export prévu contre réalisé pour la soutenance |
| Réglages | Pilote | Membres, capacités et absences, seuils d'alerte, validation des tâches, collaborateurs par tâche, import depuis Asana, sauvegardes |

## Hors V1

Ces fonctions attendront que la V1 serve vraiment au point du lundi.

- **Notifications** par e-mail ou Discord pour les alertes et le rappel de saisie du lundi.
- **Vue jury** publique en lecture seule, à montrer pendant la soutenance.
- **Pièces jointes** : les documents restent sur le Drive, une tâche porte seulement un lien.
- **App mobile native** et chronomètre de saisie.
- **Plusieurs projets** : l'app ne gère que le projet du casier LENDRR (la DA reste neutre pour pouvoir
  resservir).

## Décisions

Voir `docs/decisions.md` : les choix tranchés le 13/10/2026 (stack, connexion… ; l'hébergement, prévu sur Cassiopée, est passé à Coolify le 16/10/2026, D1) et
ceux qui restent ouverts.

## Prochaines étapes

Asana reste l'outil de l'équipe jusqu'à la bascule : le cœur de l'app (tâches, dépendances, décalage) doit donc
passer avant tout le reste.

1. Construire le cœur : tâches, axes, jalons, répartition des heures, dépendances et décalage automatique,
   puis « Ma semaine ».
2. Importer les 81 tâches depuis Asana (fichier d'import produit à partir du projet Asana, au format défini par
   l'app).
3. Basculer : toute l'équipe passe sur l'app, Asana est archivé.
4. Ajouter la saisie des heures, le plan de charge et les alertes.
5. Ajouter le Gantt, le chemin critique et la météo par axe.
6. Finir par la synthèse et l'export, prêts avant le 30/11/2026, début de la préparation de la soutenance
   « organisation ».

Les semaines S06 à S08 n'ont pas d'heures réelles. Elles pourront être saisies de mémoire, en approximation,
pour ne pas laisser de trou dans le prévu contre réalisé.
