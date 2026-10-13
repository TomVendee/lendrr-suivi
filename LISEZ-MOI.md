# Démarrer avec Claude Code

1. Décompresse ce dossier là où tu veux le dépôt, puis :

   ```bash
   cd app-suivi
   git init && git add . && git commit -m "Kit de départ : cahier, décisions, maquettes, guide Cassiopée"
   claude
   ```

2. Dans Claude Code, passe en **mode plan** (Maj+Tab) et envoie :

   > Lis CLAUDE.md et tout docs/. Propose l'architecture du socle (projet, base, auth, /setup, Dockerfile,
   > pipeline d'image, déploiement « hello » sur Cassiopée) et liste tes questions. N'écris pas de code avant
   > mon accord.

3. Ensuite, une fonction du cahier à la fois : « Plan de la fonction 1 », tu valides, il code et teste.

4. Pour déployer : garde ton jeton Cassiopée et la chaîne de connexion de la base dans des fichiers **hors du
   dépôt** (par exemple `~/.config/lendrr-suivi/`). Claude Code te demandera ton accord avant chaque création
   sur Cassiopée.

Les maquettes complètes se voient sur le canevas « App de suivi LENDRR · maquettes » dans claude.ai.
