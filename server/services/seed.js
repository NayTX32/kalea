/**
 * KALEA — données initiales : les 3 packs par défaut + administrateur.
 * Ne s'exécute que si la base est vide (idempotent).
 */
import crypto from 'node:crypto';
import { all, get, run, newId, now, toRow, parseJson } from '../db.js';
import { config } from '../config.js';
import { hashPassword } from '../lib/crypto.js';
import { log } from '../lib/logger.js';

const DEFAULT_PACKS = [
  {
    id: 'pack_base',
    slug: 'pack-de-base',
    name: 'Pack de Base',
    emoji: '⚡',
    tagline: 'Démarrez plus vite, changez votre pseudo',
    badge: 'Essentiel',
    sort_order: 1,
    price_cents: 400,
    features: [
      'Lancement du jeu plus rapide',
      'Changement de pseudo à volonté',
      'Rôle Discord « Pack de Base »',
      'Livraison automatique après paiement',
    ],
    discord_role_name: 'Pack de Base',
    game_rewards: {
      features: [
        { id: 'fast_launch', name: 'Lancement rapide du jeu' },
        { id: 'nickname_change', name: 'Changement de pseudo' },
      ],
      permissions: [{ id: 'pack.basic', name: 'Pack de Base' }],
      profile: { launch_priority: 'high', nickname_changes: 'unlimited' },
    },
    description:
      'Le pack indispensable pour jouer sans attendre : lancement prioritaire du jeu, ' +
      'changement de pseudo illimité et rôle Discord dédié. Livré automatiquement après confirmation du paiement.',
  },
  {
    id: 'pack_fulllocker',
    slug: 'full-locker',
    name: 'Full Locker',
    emoji: '🔥',
    tagline: 'Le contenu complet du locker, débloqué',
    badge: 'Populaire',
    sort_order: 2,
    price_cents: 1500,
    features: [
      'Accès complet au locker',
      'Skins premium débloqués',
      'Objets exclusifs',
      'Rôle Discord « Full Locker »',
    ],
    discord_role_name: 'Full Locker',
    game_rewards: {
      skins: [
        { id: 'locker_full_set', name: 'Full Locker Set' },
        { id: 'skin_legendary_orion', name: 'Orion Légendaire' },
        { id: 'skin_epic_neon', name: 'Néon Épique' },
      ],
      items: [
        { id: 'vip_crate', name: 'Coffre VIP' },
        { id: 'banner_aurora', name: 'Bannière Aurore' },
      ],
      currency: { type: 'kalea_coins', amount: 2500 },
      permissions: [{ id: 'pack.fulllocker', name: 'Full Locker' }],
      profile: { locker_tier: 'full' },
    },
    description:
      'Le Pack Full Locker débloque l’intégralité du contenu du locker : skins premium, objets exclusifs ' +
      'et monnaie virtuelle. Le rôle Discord « Full Locker » vous est attribué automatiquement. ' +
      'Les récompenses ne sont délivrées qu’une seule fois par transaction.',
  },
  {
    id: 'pack_moder',
    slug: 'moder',
    name: 'Moder',
    emoji: '🛡️',
    tagline: 'Le rôle Moder et ses avantages en jeu',
    badge: 'Premium',
    sort_order: 3,
    price_cents: 3000,
    features: [
      'Rôle Discord « Moder »',
      'Permissions de modération en jeu',
      'Outils de gestion de partie',
      'Avantages exclusifs réservés aux Moder',
    ],
    discord_role_name: 'Moder',
    game_rewards: {
      permissions: [
        { id: 'pack.moder', name: 'Pack Moder' },
        { id: 'mod.kick', name: 'Expulser un joueur' },
        { id: 'mod.mute', name: 'Mute d’un joueur' },
        { id: 'mod.teleport', name: 'Téléportation' },
      ],
      features: [
        { id: 'moderation_tools', name: 'Outils de modération' },
        { id: 'priority_queue', name: 'File d’attente prioritaire' },
      ],
      items: [{ id: 'mod_badge', name: 'Insigne Moder' }],
      currency: { type: 'kalea_coins', amount: 5000 },
      profile: { role: 'moder' },
    },
    description:
      'Le Pack Moder vous attribue automatiquement le rôle Discord « Moder » et active l’ensemble de ses ' +
      'avantages et permissions dans le jeu : outils de modération, file prioritaire et avantages exclusifs. ' +
      'Chaque transaction ne peut délivrer ces avantages qu’une seule fois.',
  },
];

const DEFAULT_SETTINGS = {
  site_name: 'KALEA',
  tagline: 'La boutique officielle du jeu',
  support_email: 'support@kalea.gg',
  discord_invite: 'https://discord.gg/kalea',
  legal_company: 'KALEA',
  checkout_note: 'Paiement sécurisé — aucune donnée bancaire n’est stockée par KALEA.',
};

export function seed() {
  // --- Packs ---
  const count = all('SELECT id FROM packs').length;
  if (count === 0) {
    const ts = now();
    for (const pack of DEFAULT_PACKS) {
      run(
        `INSERT INTO packs (id, slug, name, emoji, tagline, description, image_url, price_cents, currency,
           badge, features, discord_role_id, discord_role_name, game_rewards, active, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, 'EUR', ?, ?, '', ?, ?, 1, ?, ?, ?)`,
        pack.id, pack.slug, pack.name, pack.emoji, pack.tagline, pack.description,
        pack.price_cents, pack.badge, toRow(pack.features), pack.discord_role_name,
        toRow(pack.game_rewards), pack.sort_order, ts, ts,
      );
    }
    log.info('seed_packs', { count: DEFAULT_PACKS.length });
  } else {
    // Complète les récompenses manquantes sans écraser la config admin.
    for (const pack of DEFAULT_PACKS) {
      const row = get('SELECT * FROM packs WHERE id = ? OR slug = ?', pack.id, pack.slug);
      if (row) {
        const current = parseJson(row.game_rewards, {}) ?? {};
        if (Object.keys(current).length === 0) {
          run('UPDATE packs SET game_rewards = ? WHERE id = ?', toRow(pack.game_rewards), row.id);
        }
      }
    }
  }

  // --- Paramètres par défaut ---
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const exists = get('SELECT key FROM settings WHERE key = ?', key);
    if (!exists) run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(value), now());
  }

  // --- Administrateur ---
  const adminEmail = config.admin.email;
  const existing = get('SELECT id FROM users WHERE email = ?', adminEmail);
  if (!existing) {
    let password = config.admin.password;
    let generated = false;
    if (!password) {
      if (config.isProd) {
        log.error('admin_password_missing', { message: 'ADMIN_PASSWORD doit être défini en production.' });
        return;
      }
      password = 'KaleaAdmin2026!';
      generated = true;
    }
    const id = newId('usr');
    run(
      `INSERT INTO users (id, email, password_hash, display_name, role, status, locale, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', 'active', 'fr', ?, ?)`,
      id, adminEmail, hashPassword(password), 'Administrateur KALEA', now(), now(),
    );
    log.info('seed_admin', { email: adminEmail, generatedPassword: generated });
    if (generated) {
      console.log('');
      console.log('  ┌─────────────────────────────────────────────────────────────┐');
      console.log('  │  COMPTE ADMINISTRATEUR CRÉÉ                                │');
      console.log('  ├─────────────────────────────────────────────────────────────┤');
      console.log(`  │  E-mail     : ${adminEmail.padEnd(45)}│`);
      console.log(`  │  Mot de passe: ${password.padEnd(44)}│`);
      console.log('  │  → Changez-le dès la première connexion (Mon compte).      │');
      console.log('  └─────────────────────────────────────────────────────────────┘');
      console.log('');
    }
  }
}

export { DEFAULT_PACKS, crypto };
