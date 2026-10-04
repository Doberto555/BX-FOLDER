# BX FOLDER

Plateforme d'inscription de contacts inspirée du modèle fourni, avec une identité propre noir/or.

## Fonctionnalités

- Jusqu'à **50 000 inscriptions**.
- Préfixe VCF **BX** devant chaque surnom : `BX Surnom`.
- Champs : surnom, téléphone, sexe, pays.
- Téléphone unique pour éviter les doublons.
- Redirection automatique vers le groupe WhatsApp après inscription.
- Page admin protégée par `ADMIN_TOKEN`.
- Compteur de capacité et dernières inscriptions.
- Export VCF complet avec pagination serveur (jusqu'à 50K contacts).
- Base Supabase avec trigger de capacité à 50 000.

## Installation

1. Crée un projet Supabase.
2. Exécute `schema.sql` dans **SQL Editor**.
3. Copie `.env.example` vers `.env` et remplis les valeurs.
4. Installe et démarre :

```bash
npm install
npm start
```

Site : `http://localhost:3000/`
Admin : `http://localhost:3000/admin`

## Variables importantes

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — seulement sur le serveur, jamais dans le frontend.
- `ADMIN_TOKEN`
- `GROUP_URL` — `https://chat.whatsapp.com/J2Ewhgf22Jd2RZguLvjTHR`
- `MAX_REGISTRATIONS=50000`
- `CONTACT_PREFIX=BX`

## Déploiement VPS

```bash
npm install --omit=dev
pm2 start server.js --name BX-FOLDER
pm2 save
```

Utilise Nginx + HTTPS devant Node en production.


## Groupe WhatsApp configuré

Après une inscription réussie, le site redirige automatiquement vers :

`https://chat.whatsapp.com/J2Ewhgf22Jd2RZguLvjTHR`
