/**
 * KALEA — récupère et auto-héberge les polices Google Fonts.
 *
 *   node tools/fetch-fonts.js
 *
 * Télécharge les fichiers .woff2 (sous-ensembles latin + latin-ext, ceux dont
 * le français a besoin) dans public/assets/fonts/ et génère
 * public/assets/css/fonts.css. Les polices sont ensuite servies par le site
 * lui-même : aucune requête tierce, aucune modification de la CSP.
 *
 * Google sert des polices *variables* : un même fichier couvre toutes les
 * graisses. Le script regroupe donc les blocs identiques et déclare une plage
 * `font-weight: min max`, ce qui laisse le navigateur interpoler l'axe de
 * graisse (au lieu de dupliquer le fichier pour chaque poids).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = path.join(ROOT, 'public', 'assets', 'fonts');
const CSS_OUT = path.join(ROOT, 'public', 'assets', 'css', 'fonts.css');

/** Chrome récent : nécessaire pour que Google Fonts renvoie du woff2. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const FAMILIES = [
  { css: 'Space+Grotesk:wght@500;600;700', slug: 'space-grotesk' },
  { css: 'Inter:wght@400;500;600;700', slug: 'inter' },
];
const SUBSETS = new Set(['latin', 'latin-ext']);

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res;
}

async function main() {
  fs.mkdirSync(FONT_DIR, { recursive: true });

  /** @type {Map<string, {family:string, subset:string, url:string, weights:Set<number>, range:string}>} */
  const groups = new Map();

  for (const family of FAMILIES) {
    const url = `https://fonts.googleapis.com/css2?family=${family.css}&display=swap`;
    const css = await (await get(url)).text();

    // Chaque bloc est annoncé par un commentaire : /* latin */, /* latin-ext */…
    const pattern = /\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g;
    let match;
    while ((match = pattern.exec(css)) !== null) {
      const [, subset, block] = match;
      if (!SUBSETS.has(subset)) continue;

      const weight = Number(/font-weight:\s*(\d+)/.exec(block)?.[1] ?? 400);
      const src = /src:\s*url\(([^)]+)\)/.exec(block)?.[1];
      const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1] ?? '';
      if (!src) continue;

      const key = `${family.slug}|${subset}|${src}`;
      const group = groups.get(key) ?? {
        family: family.slug, subset, url: src, weights: new Set(), range,
      };
      group.weights.add(weight);
      groups.set(key, group);
    }
  }

  const blocks = [];
  let bytes = 0;
  let files = 0;

  for (const group of groups.values()) {
    const file = `${group.family}-${group.subset}.woff2`;
    const target = path.join(FONT_DIR, file);
    if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
      const buf = Buffer.from(await (await get(group.url)).arrayBuffer());
      fs.writeFileSync(target, buf);
    }
    bytes += fs.statSync(target).size;
    files += 1;

    const weights = [...group.weights].sort((a, b) => a - b);
    // Une seule source → polaire variable : on déclare une plage de graisses.
    const weightDesc = weights.length > 1
      ? `${weights[0]} ${weights.at(-1)}`
      : String(weights[0]);

    blocks.push(`@font-face {
  font-family: '${group.family === 'inter' ? 'Inter' : 'Space Grotesk'}';
  font-style: normal;
  font-weight: ${weightDesc};
  font-display: swap;
  src: url("../fonts/${file}") format('woff2');
  unicode-range: ${group.range};
}`);
  }

  const header = '/* KALEA — polices auto-hébergées (généré par tools/fetch-fonts.js) */\n\n';
  fs.writeFileSync(CSS_OUT, header + blocks.join('\n\n') + '\n', 'utf8');

  console.log(`✔ ${blocks.length} déclarations @font-face → ${path.relative(ROOT, CSS_OUT)}`);
  console.log(`✔ ${files} fichiers woff2 — ${(bytes / 1024).toFixed(0)} Ko au total`);
}

main().catch((error) => {
  console.error('✘ échec :', error.message);
  process.exitCode = 1;
});
