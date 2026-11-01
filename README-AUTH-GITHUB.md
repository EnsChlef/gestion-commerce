# Gestion Commerce — version protégée par authentification

Cette version ajoute une authentification administrateur au client React et au serveur Express.

## Ce qui est protégé

- Une page de connexion avant d'afficher les écrans de gestion.
- Toutes les routes `/api` qui accèdent aux données exigent une session valide. Seuls `/api/health`, `/api/auth/login` et `/api/auth/logout` restent accessibles sans session.
- Le mot de passe n'est pas stocké en clair : le serveur vérifie un hash dérivé avec `scrypt`.
- La session est signée côté serveur et placée dans un cookie `HttpOnly`, `SameSite` et `Secure` en production.
- Le cookie expire après 12 heures.
- Le point de connexion limite les tentatives répétées (8 tentatives par fenêtre de 15 minutes et par IP).
- La déconnexion efface la session côté navigateur.

## 1. Préparer les identifiants administrateur

Dans un terminal, depuis `server` :

```bash
node scripts/generate-admin-credentials.mjs
```

Choisis un identifiant et un mot de passe robuste d'au moins 12 caractères. Le script génère `ADMIN_PASSWORD_SALT`, `ADMIN_PASSWORD_HASH` et `SESSION_SECRET`. Copie les valeurs produites dans `server/.env`.

## 2. Configurer `server/.env`

Copie `server/.env.example` vers `server/.env`, puis renseigne :

- `DATABASE_URL` : URL de ta base PostgreSQL.
- `CLIENT_ORIGIN` : origine exacte de ton frontend, sans chemin, par exemple `http://localhost:5173` en local.
- `ADMIN_USERNAME`, `ADMIN_PASSWORD_SALT`, `ADMIN_PASSWORD_HASH` et `SESSION_SECRET` : valeurs générées à l'étape 1.
- En production, mets `NODE_ENV=production`, utilise HTTPS et définis `CLIENT_ORIGIN` avec le domaine réel du frontend.

Ne place jamais les valeurs de `server/.env` dans `client/.env`, dans le code React ou dans un dépôt Git.

## 3. Lancer en local

Dans le dossier `server` :

```bash
npm install
npx prisma generate
npm run build
npm run dev
```

Dans le dossier `client`, crée un `.env` local si nécessaire :

```env
VITE_API_URL=http://localhost:4000/api
```

Puis lance le client avec `npm install` et `npm run dev`.

Le navigateur doit ouvrir le frontend sur une origine autorisée par `CLIENT_ORIGIN`. Le client inclut automatiquement le cookie de session dans ses requêtes API.

## 4. Publier le code sur GitHub sans publier les secrets

1. Vérifie que `server/.env` existe seulement sur ton ordinateur ou dans les variables d'environnement de l'hébergeur.
2. À la racine du projet, vérifie `git status`. Aucun fichier `.env`, aucune sauvegarde de base de données, aucun mot de passe ou hash ne doit être listé.
3. Le fichier `.gitignore` de cette archive exclut `.env`, `node_modules`, `dist` et les fichiers temporaires.
4. Pousse le code source sur GitHub. Tu peux garder le dépôt privé si tu ne souhaites pas rendre le code public.
5. Configure les variables secrètes directement dans le tableau de bord de l'hébergeur du serveur. Les GitHub Actions secrets ne sont utiles que si un workflow de déploiement doit les utiliser.

Si un vrai secret a déjà été commité, le supprimer du fichier ne suffit pas : considère-le compromis et change-le (nouveau mot de passe, nouveau `SESSION_SECRET`, nouveau mot de passe PostgreSQL si nécessaire).

## 5. Important : GitHub Pages n'héberge pas le serveur

GitHub Pages publie des fichiers statiques HTML/CSS/JavaScript. Il ne lance pas Express, Prisma ni PostgreSQL. Il faut donc héberger séparément le serveur Node.js et la base PostgreSQL sur un service compatible, puis définir `VITE_API_URL` au moment de construire le frontend.

Pour que le cookie de session fonctionne de manière fiable, privilégie un frontend et une API sous le même domaine principal (par exemple `app.mondomaine.com` et `api.mondomaine.com`) avec HTTPS. Si le frontend et l'API sont sur des sites différents, `AUTH_COOKIE_SAME_SITE=none` exige HTTPS, et les navigateurs peuvent limiter les cookies tiers ; un domaine personnalisé commun est préférable.

## 6. Limites à comprendre

- L'authentification protège les données et les routes API, mais ne rend pas le code source secret si le dépôt GitHub est public.
- Cette version utilise un compte administrateur unique, défini par variables d'environnement ; elle ne gère pas plusieurs utilisateurs ni les rôles.
- Le stockage du cookie et les domaines doivent être configurés correctement en production. N'expose pas directement PostgreSQL à Internet.
- Le frontend et le serveur doivent être testés ensemble après configuration des vraies variables d'environnement.
