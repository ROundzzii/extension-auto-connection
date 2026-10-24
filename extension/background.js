if (typeof importScripts === 'function') importScripts('shared.js'); // Firefox charge shared.js via le manifeste

const SCRIPT_ID = 'autoconnexion';

// Le content script ne connaît pas l'id de son onglet : on le lui donne.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'tabId') {
    sendResponse({ tabId: sender.tab?.id ?? null });
  } else if (msg?.type === 'sync') {
    sync().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// Le content script n'est injecté que sur les sites que l'utilisateur a autorisés.
async function sync() {
  const { origins = [] } = await chrome.permissions.getAll();
  const matches = origins.filter((o) => /^https?:\/\//.test(o));
  await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => {});
  if (!matches.length) return;
  await chrome.scripting.registerContentScripts([
    { id: SCRIPT_ID, js: ['content.js'], matches, runAt: 'document_idle', persistAcrossSessions: true },
  ]);
}

// Retire les accès qui ne servent plus (connexion supprimée, enregistrement annulé).
async function prune() {
  const { rules = [], recording } = await chrome.storage.local.get(['rules', 'recording']);
  if (recording) return; // pendant un enregistrement, les accès accordés restent
  const needed = neededOrigins(rules);
  const { origins = [] } = await chrome.permissions.getAll();
  const extra = origins.filter((o) => /^https?:\/\//.test(o) && !needed.has(o));
  if (extra.length) await chrome.permissions.remove({ origins: extra }).catch(() => {});
  await sync();
}

chrome.runtime.onInstalled.addListener(prune);
chrome.runtime.onStartup.addListener(prune);
chrome.permissions.onAdded.addListener(sync);
chrome.permissions.onRemoved.addListener(sync);
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && (ch.rules || ch.recording)) prune();
});

// Raccourci clavier : relance la connexion sur l'onglet actif (réglable dans la page Réglages).
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'run-login') return;
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (settings.shortcutEnabled === false) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const run = () => chrome.tabs.sendMessage(tab.id, { type: 'run' });
  try {
    await run();
  } catch {
    // Pas encore injecté : le raccourci donne un accès temporaire à l'onglet, on s'en sert.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await run();
    } catch {
      /* page non injectable (chrome://, store…) */
    }
  }
});
