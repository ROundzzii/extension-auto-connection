// Le content script ne connaît pas l'id de son onglet : on le lui donne.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'tabId') {
    sendResponse({ tabId: sender.tab?.id ?? null });
  }
});
