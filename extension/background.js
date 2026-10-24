importScripts('shared.js');

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
