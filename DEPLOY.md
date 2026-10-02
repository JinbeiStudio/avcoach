# Déploiement sur Infomaniak

Le site de production (API + CMS) tourne sur un **site Node.js Infomaniak**.
GitHub Pages ne sert qu'à la version statique (sans connexion ni formulaire).

## Ce qu'il faut savoir avant

- `public/index.html` est le **template** (structure + textes par défaut), versionné dans git. Le serveur ne l'écrit jamais.
- Le contenu modifié par le client est stocké **uniquement en base SQLite**.
- La page servie est générée côté serveur dans `var/index.html` (template + contenu), au démarrage et à chaque sauvegarde. HTML complet, SEO identique à un fichier statique.
- À chaque démarrage (donc chaque déploiement), le serveur fusionne champ par champ :
  - champ dont le texte par défaut a changé dans le template depuis le dernier déploiement → **la version du template gagne** ;
  - sinon → **le contenu du client est conservé** ;
  - les différences d'espacement seules (reformatage Prettier) sont ignorées.
- La base est la seule copie du contenu client : elle doit être **hors du dossier déployé** et sauvegardée.

## 1. Créer le site Node.js (Manager Infomaniak)

| Réglage               | Valeur                                                       |
| --------------------- | ------------------------------------------------------------ |
| Version de Node.js    | **24 (LTS)** — exigée par `engines` dans `package.json`      |
| Dossier d'exécution   | `./` (dossier contenant `package.json`)                      |
| Commande de build     | `npm ci --omit=dev`                                          |
| Commande de démarrage | `npm start`                                                  |
| Port d'écoute         | celui attribué par le Manager (l'app lit `process.env.PORT`) |
| Domaine               | `ave-coach.fr` + activer le certificat SSL                   |

`bcrypt` et `better-sqlite3` sont des modules natifs : ils doivent être installés **sur le serveur** par la commande de build, jamais copiés depuis une machine locale (`node_modules/` ne doit pas être uploadé).

Si Node 24 n'est pas proposé : Node ≥ 22.12 fonctionne aussi (parse5 8 est ESM-only), en abaissant `engines` dans `package.json`.

## 2. Importer le code

Depuis le Manager, importer le dépôt git `JinbeiStudio/avcoach` (branche `main`).
Pour les mises à jour suivantes, la commande de build peut faire le pull : `git pull && npm ci --omit=dev`.

## 3. Créer le fichier `.env`

À déposer par SFTP à la racine de l'application (à côté de `package.json`). **Ne jamais le committer.** Modèle : `.env.production.example`.

```dotenv
# Générer avec : node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=<valeur longue et aléatoire>
JWT_EXPIRES_IN=8h

# Adresse publique du site (canonical, Open Graph, sitemap)
SITE_URL=https://ave-coach.fr

# Premier compte admin (créé uniquement si la base est vide)
ADMIN_USERNAME=<identifiant>
ADMIN_EMAIL=<email>

# Email (boîte Infomaniak)
SMTP_HOST=mail.infomaniak.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=<adresse d'envoi>
SMTP_PASS=<mot de passe de la boîte>
CONTACT_TO=<adresse qui reçoit les messages du formulaire>

# Base HORS du dossier déployé
DATABASE_PATH=/chemin/hors/app/avcoach.sqlite
```

- Sans `JWT_SECRET`, le serveur refuse de démarrer.
- `PORT` : inutile si le Manager le fournit déjà.
- `RENDERED_HTML_PATH` : optionnel (par défaut `var/index.html`).

## 4. Premier démarrage

1. Lancer le build puis démarrer l'application depuis le tableau de bord du site.
2. Dans la console d'exécution, vérifier :
   - `🚀 Avé Coach démarré sur …` et le chemin de base attendu ;
   - `✓ Utilisateur créé : <ADMIN_USERNAME> (admin)` ;
   - `✓ Email de bienvenue envoyé à …`.
3. **Si l'email échoue** (SMTP mal configuré), le mot de passe temporaire est écrit dans la console :
   `⚠ Mot de passe temporaire de <identifiant> : <mot de passe> — à changer dès la première connexion.`
4. Sur le site, cliquer sur **Connexion**, saisir l'identifiant et le mot de passe temporaire, puis définir le mot de passe définitif.
5. Depuis `/admin.html`, créer le compte du client (rôle `editor` ou `admin`) : il reçoit ses identifiants par email.

## 5. Vérifications après déploiement

- [ ] `https://ave-coach.fr/` affiche la page complète (code source HTML avec le contenu).
- [ ] Connexion, édition d'un texte, sauvegarde : le changement est visible après rechargement **et après un redémarrage**.
- [ ] Formulaire de contact : email reçu sur `CONTACT_TO` et message visible dans l'admin.
- [ ] Statistiques de l'admin : les visites sont comptées (sinon, revoir `trust proxy` dans `server.js`, réglé à `1`).
- [ ] `https://ave-coach.fr/sitemap.xml` et `https://ave-coach.fr/robots.txt` répondent.
- [ ] Admin → Historique → **Exporter le contenu** : télécharger une première sauvegarde.

## 6. Déploiements suivants

1. (Recommandé) Récupérer le contenu actuel du client dans le template local :
   ```bash
   npm run sync:pull            # depuis https://ave-coach.fr (par défaut)
   SYNC_URL=https://… npm run sync:pull   # autre URL
   ```
2. Modifier `public/index.html`, le CSS, le JS… puis commit, PR, merge sur `main`.
3. Sur Infomaniak : relancer le build (`git pull && npm ci --omit=dev`) puis redémarrer.
4. Au démarrage, la fusion s'applique : les champs modifiés dans le template remplacent le contenu en ligne, le reste est conservé. Les versions remplacées restent dans l'historique de l'admin (auteur « Déploiement ») et peuvent être restaurées.

Pour une simple correction de texte, pas besoin de déployer : se connecter sur le site et éditer via le CMS.

Limite : remettre dans le template un texte **identique** à l'ancien défaut n'est pas détecté comme un changement. Pour annuler une modification du client, utiliser le CMS ou restaurer une version depuis l'historique.

## 7. Sauvegardes

- Export JSON du contenu : Admin → Historique → **Exporter le contenu** (`GET /api/content/export`, admin uniquement).
- Copie du fichier SQLite (`DATABASE_PATH`) avec ses fichiers `-wal` et `-shm` s'ils existent, idéalement automatisée.
- L'historique ne conserve que la V0 et les 5 dernières éditions.

## Dépannage

| Symptôme                                        | Cause probable                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `JWT_SECRET manquant` au démarrage              | `.env` absent ou mal placé (doit être à côté de `package.json`)                                |
| Échec du build sur `better-sqlite3` ou `bcrypt` | Version de Node non LTS sans binaire précompilé : choisir Node 24 LTS                          |
| Page vide ou 500 sur `/`                        | Échec de génération de `var/index.html` : voir la console d'exécution                          |
| Aucun admin créé                                | Base déjà existante (non vide) ou `ADMIN_USERNAME` / `ADMIN_EMAIL` absents                     |
| Contenu client « perdu » après déploiement      | Base dans le dossier déployé et écrasée : vérifier `DATABASE_PATH`, restaurer depuis un export |
| Trop de tentatives (429)                        | Limite de 10 échecs de connexion / 15 min par IP : attendre                                    |
