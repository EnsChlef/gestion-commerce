GESTION COMMERCE — DEPLOIEMENT FRONTEND + BACKEND SUR UNE SEULE ORIGINE

Objectif
--------
Le backend Express sert aussi les fichiers statiques du frontend Vite.
L'interface et les appels /api utilisent alors la même adresse Render :
https://gestion-commerce-0ofp.onrender.com

FICHIERS A REMPLACER / AJOUTER
------------------------------
1) Remplacer client/src/App.tsx par celui du dossier client/src fourni.
   - L'URL API par défaut devient /api (même origine).
   - Les requêtes incluent le cookie de session.
2) Ajouter/remplacer client/src/vite-env.d.ts.
3) Remplacer server/src/index.ts par celui du dossier server/src fourni.
   - Il sert server/dist/public et renvoie index.html pour les routes frontend.
   - Le check /api/health et toutes les routes API restent disponibles.

AVANT DE MODIFIER RENDER
------------------------
Conservez une copie du projet. Ne remplacez pas les fichiers .env.
Ne publiez jamais les fichiers .env sur GitHub.
Ne supprimez pas encore le Static Site gestion-commerce-web : gardez-le comme
solution de secours jusqu'à validation du nouveau site.

CONFIGURATION DU SERVICE WEB BACKEND EXISTANT SUR RENDER
---------------------------------------------------------
Dans Render > service gestion-commerce > Settings :

Root Directory : vider le champ (racine du dépôt, pas "server").

Build Command (une seule ligne) :
npm install && npm run db:generate --workspace gestion-commerce-server && npm run build --workspace gestion-commerce-client && npm run build --workspace gestion-commerce-server && node -e "const fs=require('fs');fs.mkdirSync('server/dist/public',{recursive:true});fs.cpSync('client/dist','server/dist/public',{recursive:true})"

Start Command :
npm run start --workspace gestion-commerce-server

ENVIRONMENT (sur ce MEME service backend)
-----------------------------------------
VITE_API_URL = /api
CLIENT_ORIGIN = https://gestion-commerce-0ofp.onrender.com
AUTH_COOKIE_SAME_SITE = lax

Conservez les autres variables existantes, notamment DATABASE_URL,
NODE_ENV=production, ADMIN_USERNAME, ADMIN_PASSWORD_SALT,
ADMIN_PASSWORD_HASH et SESSION_SECRET. Ne partagez pas leurs valeurs.

POURQUOI CLIENT_ORIGIN CHANGE ?
-------------------------------
L'interface sera servie par le backend lui-même. Son origine sera donc
https://gestion-commerce-0ofp.onrender.com, et non plus
https://gestion-commerce-web.onrender.com.

DEPLOIEMENT
-----------
1) Envoyez ces changements sur la branche main de GitHub.
2) Modifiez les paramètres du service backend Render selon les réglages ci-dessus.
3) Enregistrez et lancez un déploiement.
4) Après le déploiement, ouvrez :
   https://gestion-commerce-0ofp.onrender.com/
5) Vérifiez aussi :
   https://gestion-commerce-0ofp.onrender.com/api/health
   Résultat attendu : {"ok":true,"service":"gestion-commerce-api"}

Ne supprimez le Static Site qu'après avoir testé la connexion, les données,
les ajouts/modifications et la déconnexion sur la nouvelle adresse.
