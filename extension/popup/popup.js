const $ = (s) => document.querySelector(s);

function faviconUrl(pageUrl) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', '32');
  return u.toString();
}

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function render() {
  const { rules = [], enabled = true, recording = null, runLog = [] } = await chrome.storage.local.get(['rules', 'enabled', 'recording', 'runLog']);
  const tab = await activeTab();
  const canRecord = /^https?:/.test(tab?.url || '');

  $('#global').checked = enabled !== false;
  $('#banner').hidden = !recording;
  $('#empty').hidden = rules.length > 0;
  $('#record').disabled = !canRecord || !!recording;
  $('#hint').textContent = canRecord
    ? 'Astuce : déconnecte-toi du site avant d’enregistrer.'
    : 'Ouvre la page de connexion d’un site pour l’enregistrer.';

  const last = $('#last');
  last.hidden = !runLog.length;
  last.replaceChildren(
    el('strong', {}, 'Dernières vérifications'),
    ...runLog.map((r) => el('div', {}, `${new Date(r.at).toLocaleTimeString('fr-FR')} · ${new URL(r.url).pathname} : ${r.result}`))
  );

  const list = $('#list');
  list.replaceChildren(...rules.map((rule) => ruleItem(rule, rules)));
}

function ruleItem(rule, rules) {
  const host = new URL(rule.startUrl).hostname;
  const on = rule.enabled !== false;

  const toggle = el('input', { type: 'checkbox' });
  toggle.checked = on;
  toggle.addEventListener('change', async () => {
    rule.enabled = toggle.checked;
    await chrome.storage.local.set({ rules });
  });

  const del = el('button', { class: 'icon', title: 'Supprimer' }, '🗑');
  let armed = false;
  del.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      del.className = 'icon confirm';
      del.textContent = 'Confirmer ?';
      setTimeout(() => {
        armed = false;
        del.className = 'icon';
        del.textContent = '🗑';
      }, 3000);
      return;
    }
    await chrome.storage.local.set({ rules: rules.filter((r) => r.id !== rule.id) });
  });

  const open = el('button', { class: 'icon', title: 'Ouvrir la page de connexion' }, '↗');
  open.addEventListener('click', () => chrome.tabs.create({ url: rule.startUrl }));

  const steps = el('ol', {}, ...rule.steps.map((s) => el('li', { style: 'background:none;border:0;padding:0' }, s.label)));
  const n = rule.steps.length;

  return el(
    'li',
    { class: on ? '' : 'off' },
    el(
      'div',
      { class: 'top' },
      el('img', { src: faviconUrl(rule.startUrl), alt: '' }),
      el('div', { class: 'info' }, el('div', { class: 'name' }, rule.name), el('div', { class: 'sub' }, host)),
      el('div', { class: 'actions' }, open, del),
      el('label', { class: 'switch', title: 'Activer pour ce site' }, toggle, el('span'))
    ),
    el('details', {}, el('summary', {}, `${n} étape${n > 1 ? 's' : ''}`), steps)
  );
}

$('#global').addEventListener('change', (e) => chrome.storage.local.set({ enabled: e.target.checked }));

$('#record').addEventListener('click', async () => {
  const tab = await activeTab();
  const u = new URL(tab.url);
  await chrome.storage.local.set({
    recording: { tabId: tab.id, startUrl: u.origin + u.pathname, name: u.hostname.replace(/^www\./, ''), steps: [], startedAt: Date.now() },
  });
  await chrome.tabs.reload(tab.id); // repart d'une page propre : Bitwarden remplira à nouveau, l'enregistreur s'affiche
  window.close();
});

$('#cancel-rec').addEventListener('click', () => chrome.storage.local.set({ recording: null }));

chrome.storage.onChanged.addListener(render);
render();
