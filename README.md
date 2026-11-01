# Gestion Commerce

Application web de gestion des achats en devises, du suivi d'expédition, du stock, des ventes (marge uniquement), des portefeuilles à solde manuel, des dettes et du patrimoine net.

## Stack
- Frontend: React + Vite + TypeScript + Bootstrap
- Backend: Node.js + Express + TypeScript
- Base de données: PostgreSQL
- ORM: Prisma

## Règles métier implémentées
- Chaque achat utilise une seule devise pour le prix, la livraison et les frais supplémentaires.
- Coût DZD = (prix + livraison + frais supplémentaires) × taux de change enregistré à l'achat.
- Le taux historique de l'achat est conservé.
- Les statuts logistiques: envoyé par le marchand, réception à l'étranger, envoyé vers l'Algérie, réception en Algérie; puis disponible et vendu.
- Une vente enregistre le prix de vente et calcule la marge nette, mais ne modifie jamais automatiquement un portefeuille.
- Il n'existe pas de vente à crédit ni de champs d'encaissement/solde client.
- Les soldes N26, Paysera, AGB, MyFin, CCP et Cash sont modifiés manuellement.
- Les dettes contiennent uniquement: personne, sens (je dois / on me doit), montant et devise.
- Patrimoine net = soldes des portefeuilles convertis en DZD + coût du stock non vendu + créances - dettes.
- Le total historique des achats et les bénéfices sont des indicateurs séparés; les ventes ne sont pas ajoutées au total des achats.

## Prérequis
- Node.js 20+
- PostgreSQL 14+

## Installation sous Windows (PowerShell)
1. Décompresser le projet.
2. Ouvrir le dossier `gestion-commerce` dans VS Code.
3. Copier `server/.env.example` vers `server/.env` et renseigner `DATABASE_URL`.
4. Dans un terminal à la racine:

```powershell
npm install
npm run db:generate
npm run db:migrate -w server
npm run db:seed
npm run dev
```

5. Ouvrir http://localhost:5173

API: http://localhost:4000/api/health

## Exemple DATABASE_URL
```env
DATABASE_URL="postgresql://postgres:VOTRE_MOT_DE_PASSE@localhost:5432/gestion_commerce?schema=public"
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
```

Créez d'abord la base PostgreSQL `gestion_commerce` si elle n'existe pas.

## Sections disponibles
- Tableau de bord
- Achats et coûts en devise
- Suivi des expéditions
- Stock
- Ventes et marges
- Portefeuilles et soldes manuels
- Dettes simples
- Paramètres des devises et taux

## Remarques
Cette version est une première base fonctionnelle. Elle ne se connecte pas automatiquement à Vinted, Binance ou AliExpress et ne lit pas les soldes bancaires. Les achats, taux et soldes sont saisis manuellement. Avant une utilisation réelle, configurez des sauvegardes régulières de PostgreSQL.


## تحديث تصنيف المنتجات (قاعدة بيانات موجودة)
بعد فك ضغط هذه النسخة ونسخ ملف `server/.env` القديم، نفّذ من مجلد المشروع:

```powershell
npm install
npm run db:generate
npx prisma db push --schema server/prisma/schema.prisma
npm run dev
```

يضيف تحديث المخطط عمود `category` للمنتجات مع قيمة افتراضية `OTHER` للمنتجات القديمة، ويحافظ على البيانات الموجودة. احتفظ دائماً بنسخة احتياطية من قاعدة البيانات قبل تحديث المخطط.
