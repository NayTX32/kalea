# 🚀 MISE EN LIGNE — KaleaShop sur Render (gratuit)

Procédure exacte, du clonage local jusqu'au site public **KaleaShop**.
URL publique cible : **`https://kaleashop.onrender.com`**.
Durée estimée : **15 minutes**.

> Les accès (mots de passe, clés) sont dans **`ACCES.md`** — ne le publiez pas.

> ⚠️ **Aucun secret n'est dans le dépôt** : `.env`, `data/`, `ACCES.md` et les
> `.zip` sont ignorés par `.gitignore`. Les secrets se renseignent uniquement
> dans le tableau de bord Render (ou dans `.env` en local).

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
   - *Name* : **`kaleashop`** → l'URL publique devient `https://kaleashop.onrender.com`
   - *Runtime* : Docker (image `node:24-slim`)
   - *Health Check Path* : `/api/health`
4. Avant de cliquer *Apply*, renseignez les variables marquées **`sync: false`** :

| Variable | Valeur à saisir |
| --- | --- |
| `BASE_URL` | `https://kaleashop.onrender.com` (déjà pré-rempli) |
| `ADMIN_GATE_PASSWORD` | **obligatoire** : un mot de passe à votre choix (aucune valeur par défaut ; laissé vide = porte `/admin` fermée) |
| `DISCORD_CLIENT_SECRET` | *(voir étape 4)* |
| `DISCORD_BOT_TOKEN` | jeton du bot « Kalea Manager » (*Bot* → *Reset Token*) |
| `PAYPAL_*` / `STRIPE_*` | laisser vide = mode démonstration |

> Déjà pré-remplis dans `render.yaml` : `DISCORD_CLIENT_ID`,
> `DISCORD_REDIRECT_URI`, `DISCORD_GUILD_ID`, `DISCORD_ROLE_FONDATEUR`
> (rôle « Founder »), `TRUST_PROXY=true`, `DISCORD_CALLBACK_PORT=0`,
> `BASE_URL`. `SESSION_SECRET` **et `ADMIN_PASSWORD`** (mot de passe du compte
> administrateur, modifiable depuis *Mon compte*) sont **générés automatiquement**
> — retrouvez leurs valeurs dans *Environment* → *Edit*.

> **Disque persistant** : le bloc `disk:` est commenté dans `render.yaml`
> (incompatible avec le plan gratuit). Sans disque, `data/kalea.db` est
> recréée à chaque redéploiement — décommentez-le si vous passez sur Starter.

5. Cliquez **Apply / Create Blueprint** et patientez (~3 min) jusqu'à l'état
   *Live*.

---

## Étape 3 — Vérifier le site

Le site est **public, ouvert à tous** : accueil, boutique, catégories, panier,
connexion et compte fonctionnent sans être membre du Discord.

| Contrôle | URL |
| --- | --- |
| Santé | `https://kaleashop.onrender.com/api/health` → `{"ok":true…}` |
| Accueil | `https://kaleashop.onrender.com/` |
| Boutique + filtres | `https://kaleashop.onrender.com/boutique` |
| Administration | `https://kaleashop.onrender.com/admin` (porte `ADMIN_GATE_PASSWORD`) |
| Tests (en local) | `smoke-test` 36/36 · `test-roles` 51/51 · `test-cart` 26/26 · `test-catalog` 44/44 |

---

## Étape 4 — Brancher Discord (connexion + rôle « Founder » → Administrateur)

1. **https://discord.com/developers/applications** → application *Kalea Manager* →
   *OAuth2* → **Redirects** → ajoutez exactement :
   ```
   https://kaleashop.onrender.com/callback
   ```
   (garder aussi `http://localhost:4200/callback` pour le développement local).
2. *OAuth2* → **Client Secret** → *Révéler* → **copiez la valeur**.
3. Sur Render : *Environment* → `DISCORD_CLIENT_SECRET` → coller → *Save*
   (le service redémarre automatiquement).
4. *Bot* → *Reset Token* → coller dans `DISCORD_BOT_TOKEN` (déjà présent dans
   `render.yaml`, à renseigner). `DISCORD_GUILD_ID` et `DISCORD_ROLE_FONDATEUR`
   pointent sur le serveur **Kalea** et le rôle **Founder**.
5. Test : *Connexion* → **« Continuer avec Discord »** → autoriser → retour
   automatique sur le site, connecté.

**Règle de rôle (100 % côté serveur)** : si le compte Discord possède le rôle
*Founder* sur le serveur Kalea, il devient **Administrateur** du site ; sinon
c'est un **Utilisateur** normal. Si le rôle est retiré sur Discord, les droits
sont retirés à la prochaine vérification (5 min, ou sur demande depuis
*Mon compte* → *Vérifier mon rôle*). Aucune vérification n'est faite dans le
JavaScript du navigateur.

---

## Étape 5 — Passer les paiements en réel (optionnel)

Sans clés, le site reste en **mode démonstration** (parfait pour les tests).
Pour encaisser réellement :

- **PayPal** : `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` (`PAYPAL_MODE=live`),
  puis enregistrer le webhook `https://kaleashop.onrender.com/api/webhooks/paypal`.
- **Stripe** : `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`, webhook
  `https://kaleashop.onrender.com/api/webhooks/stripe`.

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

## 🌐 Domaine « kaleashop » personnalisé (optionnel)

L'URL publique livrée par le blueprint est **`https://kaleashop.onrender.com`**
(elle est basée sur le nom `kaleashop` et accessible à tout le monde).

Si vous possédez un domaine (ex. `kaleashop.com`) :

1. Render → votre service → **Settings → Custom Domains** → *Add Custom Domain*
   → suivre les instructions DNS (enregistrement `A`/`CNAME` fournies).
2. Sur le registrar, créer le même enregistrement DNS.
3. Attendre la validation HTTPS (quelques minutes, certificat généré par Render).
4. Mettre à jour **`BASE_URL`** et **`DISCORD_REDIRECT_URI`** sur Render, puis
   ajouter `https://votre-domaine/callback` dans les *Redirects* Discord.
5. Le domaine reste gratuit : seul l'achat du nom de domaine est payant
   (~10 €/an) — un plan payant Render n'est nécessaire que si le domaine
   n'appartient pas à votre compte Render.

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
node server/index.js          # http://localhost:4000
node tools/smoke-test.js      # 36/36
node tools/test-roles.mjs     # 51/51  (rôles, permissions, portes admin)
node tools/test-cart.mjs      # 26/26  (panier multi-articles, livraison)
node tools/test-catalog.mjs   # 44/44  (catégories, stock, promotions)
```

> Les suites utilisent le même quota de connexion (10/min/IP) : espacez-les
> d'une minute si vous les enchaînez.
