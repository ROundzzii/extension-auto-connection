const { test, expect, chromium } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const EXT = path.join(ROOT, 'dist', 'test');
const LAB = path.join(ROOT, 'testlab');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

let server, base, ctx, sw;

test.beforeAll(async () => {
  // Serveur statique du labo (faux sites de connexion)
  server = http.createServer((req, res) => {
    const file = path.join(LAB, new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html'));
    if (!file.startsWith(LAB) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' }).end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ac-')), {
    channel: 'chromium', // nouveau mode headless, qui sait charger des extensions
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  // L'enregistreur n'est injecté qu'une fois les accès synchronisés par le background.
  await expect.poll(() => sw.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((l) => l.length))).toBeGreaterThan(0);
});

test.afterAll(async () => {
  await ctx?.close();
  server?.close();
});

const store = () => sw.evaluate(() => chrome.storage.local.get(null));
const tabIdOf = (url) => sw.evaluate(async (u) => Math.max(...(await chrome.tabs.query({})).filter((t) => t.url === u).map((t) => t.id)), url);

// Où se trouve le formulaire selon la page de test.
function scope(page, name) {
  return name === 'frame.html' ? page.frameLocator('#login-frame') : page; // le shadow DOM est traversé par Playwright
}

async function record(name) {
  const page = await ctx.newPage();
  const url = `${base}/${name}`;
  await page.goto(url);
  await sw.evaluate(async ({ tabId, startUrl }) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ recording: { tabId, startUrl, name: 'labo', steps: [] } });
  }, { tabId: await tabIdOf(url), startUrl: url });
  await page.reload();

  const form = scope(page, name);
  await expect(page.getByText('Enregistrement en cours')).toBeVisible();
  await expect(form.locator('input[type=password]')).not.toHaveValue(''); // le faux Bitwarden a rempli
  await form.locator('select').selectOption('inti');
  await form.locator('button[type=submit]').click();
  await expect(form.locator('.res')).toContainText('INTI');
  await page.getByRole('button', { name: 'Terminer' }).click();
  await expect.poll(async () => (await store()).rules?.length).toBe(1);
  await page.close();
}

async function replay(name, query = '') {
  const page = await ctx.newPage(); // nouvel onglet : l'anti-boucle est propre à l'onglet
  await page.goto(`${base}/${name}${query}`);
  await expect(scope(page, name).locator('.res')).toContainText('Connecté · établissement : INTI', { timeout: 20_000 });
  return page;
}

for (const name of ['classic.html', 'frame.html', 'shadow.html']) {
  test(`enregistrer puis rejouer : ${name}`, async () => {
    await record(name);
    const { rules } = await store();
    expect(rules[0].steps.map((s) => s.type)).toEqual(['fill', 'fill', 'select', 'click']);
    const page = await replay(name);
    await expect.poll(async () => (await store()).runLog?.[0]?.result).toContain('lancée');
    await page.close();
  });
}

test('répare les étapes quand le site change (v2 puis v3)', async () => {
  await record('classic.html');
  for (const v of ['?v=2', '?v=3']) {
    const page = await replay('classic.html', v);
    await expect.poll(async () => (await store()).runLog?.[0]?.result).toContain('réparée');
    await page.close();
  }
});

test('le lancement manuel (raccourci) rejoue même sans anti-boucle', async () => {
  await record('classic.html');
  const page = await replay('classic.html');
  await expect.poll(async () => (await store()).runLog?.length).toBeGreaterThan(0); // le compte rendu arrive un peu après
  const before = (await store()).runLog.length;
  await page.reload(); // dans les 20 s : l'anti-boucle bloque le rejeu automatique...
  await expect.poll(async () => (await store()).runLog[0].result).toContain('anti-boucle');
  await sw.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, { type: 'run' }), await tabIdOf(page.url())); // ...pas le raccourci
  await expect(page.locator('.res')).toContainText('INTI', { timeout: 20_000 });
  expect((await store()).runLog.length).toBeGreaterThan(before);
  await page.close();
});

test('un site désactivé ne se connecte pas tout seul', async () => {
  await record('classic.html');
  await sw.evaluate(async () => {
    const { rules } = await chrome.storage.local.get('rules');
    rules[0].enabled = false;
    await chrome.storage.local.set({ rules });
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/classic.html`);
  await page.waitForTimeout(3000);
  await expect(page.locator('.res')).not.toContainText('Connecté');
  await expect.poll(async () => (await store()).runLog?.[0]?.result).toContain('désactivé');
  await page.close();
});

test('page Réglages : on peut désactiver le raccourci', async () => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${new URL(sw.url()).host}/options/options.html`);
  const toggle = page.locator('#shortcut-on');
  await expect(toggle).toBeChecked(); // activé par défaut
  await page.locator('label:has(#shortcut-on)').click();
  await expect.poll(async () => (await store()).settings?.shortcutEnabled).toBe(false);
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('#shortcut-key')).not.toHaveText('…'); // la lecture du raccourci a abouti
  await page.close();
});

test('raccourci personnalisé : une combinaison libre relance la connexion', async () => {
  await record('classic.html');
  await sw.evaluate(() =>
    chrome.storage.local.set({ settings: { customEnabled: true, custom: { code: 'KeyY', ctrl: true, alt: false, shift: true, meta: false } } })
  );
  const page = await replay('classic.html');
  await expect.poll(async () => (await store()).runLog?.length).toBeGreaterThan(0);
  const before = (await store()).runLog.length;
  await page.reload(); // l'anti-boucle bloque le rejeu automatique
  await expect.poll(async () => (await store()).runLog[0].result).toContain('anti-boucle');
  await page.keyboard.press('Control+Shift+Y');
  await expect(page.locator('.res')).toContainText('INTI', { timeout: 20_000 });
  expect((await store()).runLog.length).toBeGreaterThan(before);
  await page.close();
});

test('page Réglages : définir une combinaison au clavier', async () => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${new URL(sw.url()).host}/options/options.html`);
  await page.locator('#custom-edit').click();
  await page.keyboard.press('Shift+KeyK'); // sans Ctrl/Alt/⌘ : refusée
  await expect(page.locator('#custom-note')).toContainText('au moins');
  await page.locator('#custom-edit').click();
  await page.keyboard.press('Alt+Shift+KeyK');
  await expect.poll(async () => (await store()).settings?.custom?.code).toBe('KeyK');
  const { settings } = await store();
  expect(settings).toMatchObject({ customEnabled: true, custom: { alt: true, shift: true, ctrl: false, meta: false } });
  await expect(page.locator('#custom-key')).toContainText('K');
  await page.close();
});
