# 🚀 MISE EN LIGNE — KALEA sur Render (gratuit)

Procédure exacte, du clonage local jusqu'au site public.
Durée estimée : **15 minutes**.

> Les accès (mots de passe, clés) sont dans **`ACCES.md`** — ne le publiez pas.

---

## Étape 1 — Préparer le dépôt Git (une seule fois)

Ouvrez **PowerShell** dans le dossier du projet puis exécutez :

```powershell
cd "C:\Users\NayTX\OneDrive\Documents\Projet par défaut"
git init
git add -A
git commit -m "KALEA — boutique officielle"
```

> `.env`, `data/`, `ACCES.md` et les `.zip` sont **automatiquement exclus**
> (voir `.gitignore`) : aucun secret ne part sur Internet.

Créez ensuite un dépôt vide sur **github.com** (*New repository* → nom `kalea`
→ *Create repository*), puis :

```powershell
git remote add origin https://github.com/VOTRE-COMPTE/kalea.git
git branch -M main
git push -u origin main
```

---

## Étape 2 — Créer le service sur Render

1. Allez sur **https://dashboard.render.com** → *New* → **Blueprint**.
2. Connectez votre compte GitHub et sélectionnez le dépôt `kalea`.
   Render détecte automatiquement **`render.yaml`**.
3. Vérifiez la configuration proposée :
   - *Name* : `kalea`
   - *Runtime* : Docker (image `node:24-slim`)
   - *Health Check Path* : `/api/health`
   - *Disk* : `kalea-data` monté sur `/app/data`
4. Avant de cliquer *Apply*, renseignez les variables marquées **`sync: false`** :

| Variable | Valeur à saisir |
| --- | --- |
| `BASE_URL` | `https://kalea-xxxx.onrender.com` (l'URL affichée par Render) |
| `ADMIN_GATE_PASSWORD` | un mot de passe **à votre choix** (différent du local) |
| `DISCORD_CLIENT_ID` | `1556218934468943923` |
| `DISCORD_CLIENT_SECRET` | *(à venir — voir étape 4)* |
| `PAYPAL_*` / `STRIPE_*` | laisser vide = mode démonstration |

> `SESSION_SECRET` est **généré automatiquement** par le blueprint.

5. Cliquez **Apply / Create Blueprint** et patientez (~3 min) jusqu'à l'état
   *Live*.

---

## Étape 3 — Vérifier le site

| Contrôle | URL |
| --- | --- |
| Santé | `https://kalea-xxxx.onrender.com/api/health` → `{"ok":true…}` |
| Accueil | `https://kalea-xxxx.onrender.com/` |
| Administration | `https://kalea-xxxx.onrender.com/admin` |
| Tests | en local : `node tools/smoke-test.js` → 36/36 |

---

## Étape 4 — Brancher Discord (callback OAuth2)

1. **https://discord.com/developers/applications** → votre application →
   *OAuth2* → **Redirects** → ajoutez :
   ```
   https://kalea-xxxx.onrender.com/api/auth/discord/callback
   ```
2. *OAuth2* → **Client Secret** → *Révéler* → **copiez la valeur**.
3. Sur Render : *Environment* → `DISCORD_CLIENT_SECRET` → coller → *Save*
   (le service redémarre automatiquement).
4. Test : *Connexion* → **« Continuer avec Discord »** → autoriser → retour
   automatique sur le site, connecté.

> Optionnel (rôles automatiques) : *Bot* → *Reset Token* → `DISCORD_BOT_TOKEN`,
> `DISCORD_GUILD_ID`, et les IDs de rôles dans `DISCORD_ROLE_*`.

---

## Étape 5 — Passer les paiements en réel (optionnel)

Sans clés, le site reste en **mode démonstration** (parfait pour les tests).
Pour encaisser réellement :

- **PayPal** : `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` (`PAYPAL_MODE=live`),
  puis enregistrer le webhook `https://kalea-xxxx.onrender.com/api/webhooks/paypal`.
- **Stripe** : `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`, webhook
  `https://kalea-xxxx.onrender.com/api/webhooks/stripe`.

---

## ⚠️ Limites du plan gratuit Render

| Point | Conséquence |
| --- | --- |
| **Pas de disque persistant** | `data/kalea.db` est **réinitialisée à chaque redéploiement** |
| Service en veille | la première requête après inactivité met ~30 s |
| Sous-domaine imposé | `*.onrender.com` (domaine perso = plan payant) |

**Solutions :**
- **Démo / test** → plan gratuit suffit.
- **Vraie boutique** → activer le disque (plan Starter, ~7 $/mois) **ou**
  passer sur un **VPS** (~5 €/mois) : voir `README.md → 4. Mise en ligne`.

---

## Commandes utiles

```powershell
# Publier une modification
git add -A
git commit -m "description"
git push
# Render redéploie automatiquement (auto-deploy activé)
```

```powershell
# Tester en local avant de publier
node server/index.js        # http://localhost:4000
node tools/smoke-test.js    # 36/36
```
