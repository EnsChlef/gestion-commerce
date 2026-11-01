# Corrections Render - Frontend Gestion Commerce

## Fichiers à remplacer / ajouter
- Remplacer `client/src/App.tsx` par le fichier fourni.
- Ajouter `client/src/vite-env.d.ts`.
- Remplacer `server/src/index.ts` par le fichier fourni (ajout de la relation Purchase.productUrl dans la réponse GET /api/sales pour la table des ventes).

## Vérifications
- Les fichiers `.env` ne sont pas inclus.
- Les variables d'authentification restent dans l'environnement Render du service Backend.
- Après remplacement, vérifier les builds client et server localement avant de pousser sur GitHub.
