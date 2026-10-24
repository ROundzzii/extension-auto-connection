// Vérifie la syntaxe de tous les JS de l'extension et la validité du manifeste.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'extension');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(root);

for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
console.log(`OK : ${files.length} fichiers JS, manifeste v${manifest.version}`);
