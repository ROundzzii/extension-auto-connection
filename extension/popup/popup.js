const $ = (s) => document.querySelector(s);

let currentTab = null;
const openIds = new Set(); // connexions dont le détail est déplié (conservé entre deux rendus)

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
  currentTab = await activeTab();
  const url = currentTab?.url || '';
  const canRecord = /^https?:/.test(url);

  // En cours d'enregistrement sur un nouveau domaine (SSO) : il faut l'autoriser pour continuer.
  const hop =
    !!recording && canRecord && recording.tabId === currentTab.id && !(await chrome.permissions.contains({ origins: originsFor(new URL(url).origin) }));

  $('#global').checked = enabled !== false;
  $('#banner').hidden = !recording;
  $('#hop').hidden = !hop;
  $('#empty').hidden = rules.length > 0;
  $('#record').disabled = !canRecord || !!recording;
  $('#hint').textContent = canRecord
    ? 'Astuce : déconnecte-toi du site avant d’enregistrer. Chrome te demandera d’autoriser le site.'
    : 'Ouvre la page de connexion d’un site pour l’enregistrer.';

  const last = $('#last');
  last.hidden = !runLog.length;
  last.replaceChildren(
    el('strong', {}, 'Dernières vérifications'),
    ...runLog.map((r) => el('div', {}, `${new Date(r.at).toLocaleTimeString('fr-FR')} · ${new URL(r.url).pathname} : ${r.result}`))
  );

  const granted = await Promise.all(rules.map((r) => chrome.permissions.contains({ origins: [...neededOrigins([r])] })));
  $('#list').replaceChildren(...rules.map((rule, i) => ruleItem(rule, rules, granted[i])));
}

function ruleItem(rule, rules, hasAccess) {
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

  // Le test se lance sur l'onglet actif, s'il montre une page de cette connexion.
  let here = false;
  try {
    const u = new URL(currentTab.url);
    here = rule.steps.some((s) => sameSite(s.origin, u.origin) && s.path === normPath(u.pathname));
  } catch {
    /* onglet sans URL lisible */
  }
  const test = el('button', { class: 'icon', title: here ? 'Tester sur cette page (rien n’est cliqué)' : 'Ouvre la page de connexion de ce site pour tester' }, '▶');
  test.disabled = !here;
  test.addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(currentTab.id, { type: 'test', ruleId: rule.id });
      window.close();
    } catch {
      $('#hint').textContent = 'Test impossible : recharge la page puis réessaie.';
    }
  });

  // Sans accès au site, rien ne se lance : le bouton doit être cliqué par l'utilisateur.
  const origins = [...neededOrigins([rule])];
  const authorize = el('button', { class: 'warn', title: 'Autoriser l’extension sur ce site' }, 'Autoriser');
  authorize.addEventListener('click', async () => {
    if (await chrome.permissions.request({ origins })) await chrome.runtime.sendMessage({ type: 'sync' });
    render();
  });

  const save = () => chrome.storage.local.set({ rules });
  const swap = (i, k) => {
    [rule.steps[i], rule.steps[k]] = [rule.steps[k], rule.steps[i]];
    save();
  };
  const stepBtn = (text, title, enabled, fn) => {
    const b = el('button', { class: 'icon', title }, text);
    b.disabled = !enabled;
    b.addEventListener('click', fn);
    return b;
  };
  const n = rule.steps.length;
  const steps = el(
    'ol',
    {},
    ...rule.steps.map((s, i) =>
      el(
        'li',
        { class: 'step' },
        el('span', { class: 'lbl' }, s.label),
        stepBtn('↑', 'Monter', i > 0, () => swap(i, i - 1)),
        stepBtn('↓', 'Descendre', i < n - 1, () => swap(i, i + 1)),
        stepBtn('✕', n > 1 ? 'Supprimer cette étape' : 'Supprime la connexion entière', n > 1, () => {
          rule.steps.splice(i, 1);
          save();
        })
      )
    )
  );

  const name = el('input', { class: 'name', value: rule.name, 'aria-label': 'Nom de la connexion' });
  name.addEventListener('change', () => {
    rule.name = name.value.trim() || host;
    save();
  });
  name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());

  const details = el('details', {}, el('summary', {}, `${n} étape${n > 1 ? 's' : ''}`), steps);
  details.open = openIds.has(rule.id);
  details.addEventListener('toggle', () => (details.open ? openIds.add(rule.id) : openIds.delete(rule.id)));

  const icon = el('img', { src: faviconUrl(rule.startUrl), alt: '' });
  icon.addEventListener('error', () => icon.remove()); // Firefox n'a pas l'API de favicons

  return el(
    'li',
    { class: on ? '' : 'off' },
    el(
      'div',
      { class: 'top' },
      icon,
      el('div', { class: 'info' }, name, el('div', { class: 'sub' }, host)),
      hasAccess ? el('div', { class: 'actions' }, test, open, del) : el('div', { class: 'actions' }, authorize, del),
      el('label', { class: 'switch', title: 'Activer pour ce site' }, toggle, el('span'))
    ),
    details
  );
}

$('#global').addEventListener('change', (e) => chrome.storage.local.set({ enabled: e.target.checked }));

// La demande d'accès doit partir directement du clic : on utilise l'onglet déjà connu.
$('#record').addEventListener('click', async () => {
  const tab = currentTab;
  const u = new URL(tab.url);
  if (!(await chrome.permissions.request({ origins: originsFor(u.origin) }))) {
    $('#hint').textContent = 'Accès refusé : impossible d’enregistrer sans autoriser le site.';
    return;
  }
  await chrome.storage.local.set({
    recording: { tabId: tab.id, startUrl: u.origin + u.pathname, name: u.hostname.replace(/^www\./, ''), steps: [], startedAt: Date.now() },
  });
  await chrome.runtime.sendMessage({ type: 'sync' }); // injecte l'enregistreur avant le rechargement
  await chrome.tabs.reload(tab.id); // repart d'une page propre : Bitwarden remplira à nouveau
  window.close();
});

$('#continue').addEventListener('click', async () => {
  const tab = currentTab;
  if (!(await chrome.permissions.request({ origins: originsFor(new URL(tab.url).origin) }))) return;
  await chrome.runtime.sendMessage({ type: 'sync' });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  window.close();
});

$('#backup').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('backup/backup.html') });
  window.close();
});

$('#settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

$('#cancel-rec').addEventListener('click', () => chrome.storage.local.set({ recording: null }));

chrome.storage.onChanged.addListener(render);
render();
