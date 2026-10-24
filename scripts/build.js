// Produit dist/chrome (Chrome + Edge), dist/firefox et dist/test (Chrome + accès 127.0.0.1 pré-accordé,
// pour les tests e2e : un test automatique ne peut pas cliquer sur la fenêtre d'autorisation de Chrome).
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '..', 'extension');
const out = path.join(__dirname, '..', 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));

function emit(name, tweak) {
  const dir = path.join(out, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(src, dir, { recursive: true });
  const m = structuredClone(manifest);
  tweak(m);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  console.log(`dist/${name}`);
}

emit('chrome', () => {});

emit('test', (m) => {
  m.host_permissions = ['http://127.0.0.1/*'];
  m.name += ' (test)';
});
// Le menu déroulant natif ne se pilote pas au clavier de façon fiable en test : on accepte aussi les
// événements non « trusted » dans la version de test uniquement (la version publiée les refuse).
const testContent = path.join(out, 'test', 'content.js');
fs.writeFileSync(testContent, fs.readFileSync(testContent, 'utf8').replace(/ \|\| !e\.isTrusted/g, ''));

emit('firefox', (m) => {
  // Firefox charge le worker en « background scripts » et n'a pas l'API _favicon de Chrome.
  m.background = { scripts: ['shared.js', 'background.js'] };
  m.permissions = m.permissions.filter((p) => p !== 'favicon');
  m.browser_specific_settings = { gecko: { id: 'autoconnexion@roundzzii.local', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } } };
  m.options_ui = { page: m.options_ui.page };
});
