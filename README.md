# 🛍️ KALEA — Boutique officielle du jeu

Site complet **100 % français** : boutique de packs, paiements (PayPal / Stripe / démo),
connexion **Discord OAuth2**, rôles automatiques, livraison automatique via API signée
(HMAC), historique, FAQ, support et **dashboard d'administration** protégé par un
mot de passe.

**Zéro dépendance externe** : aucune ligne `npm install`. Node.js suffit.

---

## 1. Prérequis

| Élément | Version |
| --- | --- |
| Node.js | **>= 22.5** (module `node:sqlite` intégré) — 24 LTS conseillé |
| npm | fourni avec Node |
| Espace disque | ~30 Mo (base SQLite incluse) |

```bash
node -v    # doit afficher v22.5.0 ou plus
```

---

## 2. Démarrage local

```bash
node tools/fetch-fonts.js    # (ré)télécharger les polices auto-hébergées
node server/index.js         # démarrer le serveur
```

Commandes utiles :

| Commande | Rôle |
| --- | --- |
| `node server/index.js` | démarrer le serveur |
| `node --watch server/index.js` | redémarrage automatique (dev) |
| `node tools/smoke-test.js` | tests de bout en bout (36 vérifications) |
| `node tools/mock-game-server.js` | serveur de jeu fictif (tests) |
| `node server/scripts/seed.js` | (ré)initialiser les données |

**Comptes créés au premier lancement :**

- Administrateur : `admin@kalea.gg` / `KaleaAdmin2026!`
- Porte d'accès `/admin` : mot de passe unique `kalea2K26Fn` (modifiable)

---

## 3. Variables d'environnement (`.env`)

Copiez `.env.example` vers `.env` puis remplissez. **Aucun secret n'est jamais
exposé au navigateur** (le front ne reçoit que `/api/config`).

| Variable | Rôle | Requis |
| --- | --- | --- |
| `PORT` | port d'écoute (l'hébergeur fournit souvent le sien) | ✅ |
| `BASE_URL` | URL publique du site (retours de paiement + callbacks) | ✅ prod |
| `SESSION_SECRET` | signature des sessions (`openssl rand -hex 32`) | ✅ prod |
| `NODE_ENV` | `production` en ligne | ✅ prod |
| `DATABASE_URL` | chemin de la base SQLite (`data/kalea.db`) | — |
| `PAYMENT_PROVIDER` | `auto` / `paypal` / `stripe` / `demo` | — |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | PayPal OAuth | pour PayPal |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe | pour Stripe |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | **Discord OAuth2** (connexion) | pour Discord |
| `DISCORD_REDIRECT_URI` | redirection exacte enregistrée chez Discord | ✅ Discord |
| `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` | bot + attribution des rôles | pour rôles |
| `DISCORD_ROLE_BASE` / `_FULLLOCKER` / `_MODER` | IDs des rôles à attribuer | pour rôles |
| `GAME_API_URL` / `GAME_API_SECRET` / `GAME_API_KEY` | API du jeu (livraison signée) | pour livraison |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | compte administrateur | — |
| `ADMIN_GATE_PASSWORD` | mot de passe de la porte `/admin` | — |

> ⚠️ En production, le serveur **refuse de démarrer** sans `SESSION_SECRET`.

---

## 4. Mise en ligne sur un hébergeur

L'application est un simple serveur Node qui écoute sur `0.0.0.0:$PORT` :
**n'importe quel hébergeur qui exécute Node.js convient.**

### Option A — VPS (recommandé : données persistantes, ~5 €/mois)

OVH, Hetzner, DigitalOcean, Scaleway, Contabo…

```bash
# 1. Installer Node 24 sur le serveur (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Déposer le projet
git clone <votre-depot> /var/www/kalea && cd /var/www/kalea
cp .env.example .env && nano .env     # NODE_ENV, BASE_URL, SESSION_SECRET…

# 3. Lancer en permanence
npm install -g pm2
pm2 start server/index.js --name kalea
pm2 save && pm2 startup               # redémarrage automatique

# 4. Proxy HTTPS (Caddy, 10 lignes) — domaine pointé en A/vers l'IP
sudo apt install -y caddy
sudo nano /etc/caddy/Caddyfile
```

`/etc/caddy/Caddyfile` :

```
votre-domaine.com {
    reverse_proxy 127.0.0.1:4000
}
```

```bash
sudo systemctl reload caddy   # HTTPS automatique (Let's Encrypt)
```

La base `data/kalea.db` reste sur le disque du VPS → **données durables**.

### Option B — Render (gratuit, déploiement Git)

Le dépôt contient un `render.yaml` : importez-le (Dashboard → *New → Blueprint*).
Points de vigilance :

1. Variables : `NODE_ENV=production`, `BASE_URL=https://votre-app.onrender.com`,
   `SESSION_SECRET=<aléatoire>`, + Discord/PayPal.
2. **Disque persistant requis** : *Disks → Add Disk*, monté sur `/data`
   (sinon la base SQLite est effacée à chaque redéploiement).
3. Discord : ajoutez `https://votre-app.onrender.com/api/auth/discord/callback`
   dans *Developer Portal → OAuth2 → Redirects*.

### Option C — Railway / Fly.io / Neon (Node managé)

```bash
railway init && railway up          # Railway détecte "start" dans package.json
# ou
fly launch && fly deploy            # Fly.io (volume pour ./data)
```

Variables : mêmes valeurs que l'option B (adaptées à l'URL publique).

### Option D — Docker (OVH, AWS, serveur maison)

```bash
docker build -t kalea .
docker run -d -p 4000:4000 -v kalea-data:/app/data --env-file .env kalea
```

### Hébergeur mutualisé « classique » (PHP/MySQL uniquement)

**Incompatible** : il faut un hébergeur **Node.js** (VPS, ou offre
« Node hosting » de votre hébergeur). Un mutualisé purement PHP ne peut pas
exécuter `server/index.js`.

---

## 5. Checklist de mise en ligne

- [ ] `NODE_ENV=production`
- [ ] `SESSION_SECRET` aléatoire (32+ octets)
- [ ] `BASE_URL` = domaine public exact (https://…)
- [ ] **Discord** : `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` + redirection
      `https://domaine/api/auth/discord/callback` déclarée chez Discord
- [ ] **Discord** (rôles) : `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, IDs de rôles
- [ ] **Paiement** : clés PayPal/Stripe (sinon le site reste en mode démo)
- [ ] **Stripe** : webhook `https://domaine/api/webhooks/stripe`
- [ ] **PayPal** : webhook `https://domaine/api/webhooks/paypal`
- [ ] `ADMIN_GATE_PASSWORD` modifié (porte `/admin`)
- [ ] Disque **persistant** pour `data/`
- [ ] `node tools/smoke-test.js` → 36/36 sur l'URL de production

### Sauvegarde de la base

```bash
cp data/kalea.db backups/kalea-$(date +%F).db
```

---

## 6. Architecture

```
├── server/                 # API Node zéro dépendance
│   ├── index.js            # point d'entrée + en-têtes + journal
│   ├── config.js           # lecture du .env, validation (secrets côté serveur)
│   ├── db.js               # SQLite + schéma + migrations
│   ├── routes/             # public, auth, boutique, commandes, admin, webhooks, jeu
│   ├── middleware/         # session, CSRF, rate-limit, sécurité, rôles
│   ├── services/           # paiements, Discord OAuth2 + rôles, API du jeu, seed
│   └── lib/                # HTTP, erreurs, crypto HMAC, journal
├── public/                 # front SPA (HTML/CSS/JS, 100 % français)
│   ├── index.html
│   └── assets/{css,js,img,fonts}
├── tools/                  # smoke-test, mock de jeu, fetch-fonts
├── data/kalea.db           # base SQLite (créée au 1er lancement)
├── .env / .env.example     # configuration (jamais versionné)
├── render.yaml / Dockerfile
└── package.json            # scripts, engines Node >= 22.5
```

### Sécurité

- Sessions `httpOnly` + `Secure` en prod, CSRF double cookie sur tout `/api/*` mutant.
- Webhooks et API de jeu **HMAC-SHA256 signés** (exclus du CSRF).
- Rate-limit global et dédié sur l'authentification (brute-force).
- Comparaison de mot de passe à **temps constant**.
- CSP / HSTS / X-Frame-Options injectés à chaque réponse.
- Les secrets (Stripe, PayPal, Discord, HMAC) ne quittent jamais le serveur.

---

## 7. Dépannage

| Symptôme | Cause / solution |
| --- | --- |
| `SESSION_SECRET est obligatoire` | définir `SESSION_SECRET` dans `.env` |
| `EADDRINUSE` | changer `PORT` ou arrêter l'autre processus |
| Connexion Discord : « redirect_uri ne correspond pas » | ajouter l'URL exacte dans le portail Discord |
| Paiement toujours en démo | renseigner les clés PayPal/Stripe, redémarrer |
| Données perdues après redéploiement | `data/` non persistant → monter un disque |
| Cookie de session non conservé | `BASE_URL` en https et domaine identique |
