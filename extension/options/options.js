const $ = (s) => document.querySelector(s);

const isMac = /Mac/i.test(navigator.platform);

// « KeyL » → « L », « Digit1 » → « 1 », « F5 » → « F5 »
function keyLabel(code) {
  return code.replace(/^Key/, '').replace(/^Digit/, '');
}

function comboLabel(c) {
  const mods = isMac
    ? [c.ctrl && '⌃', c.alt && '⌥', c.shift && '⇧', c.meta && '⌘']
    : [c.ctrl && 'Ctrl', c.alt && 'Alt', c.shift && 'Maj', c.meta && 'Win'];
  return [...mods.filter(Boolean), keyLabel(c.code)].join(isMac ? '' : '+');
}

async function getSettings() {
  return (await chrome.storage.local.get('settings')).settings || {};
}
async function patchSettings(patch) {
  await chrome.storage.local.set({ settings: { ...(await getSettings()), ...patch } });
}

async function load() {
  const settings = await getSettings();
  $('#shortcut-on').checked = settings.shortcutEnabled !== false;
  $('#custom-on').checked = !!settings.customEnabled;
  $('#custom-key').textContent = settings.custom ? comboLabel(settings.custom) : 'Non défini';
  $('#custom-clear').hidden = !settings.custom;
  $('#custom-note').textContent = settings.custom
    ? 'Évite ⌘⇧L : Bitwarden l’utilise déjà pour remplir les mots de passe.'
    : 'Clique sur « Définir », puis appuie sur ta combinaison (avec Ctrl, Alt ou ⌘).';

  const cmds = await chrome.commands.getAll();
  const cmd = cmds.find((c) => c.name === 'run-login');
  $('#shortcut-key').textContent = cmd?.shortcut || 'Non défini';
  $('#shortcut-note').textContent = cmd?.shortcut
    ? 'Si ce raccourci ne fait rien, un autre programme ou une extension l’utilise peut-être déjà : change-le.'
    : 'Aucun raccourci n’est attribué : clique sur « Modifier » pour en choisir un.';
}

$('#shortcut-on').addEventListener('change', (e) => patchSettings({ shortcutEnabled: e.target.checked }));
$('#custom-on').addEventListener('change', (e) => patchSettings({ customEnabled: e.target.checked }));
$('#custom-clear').addEventListener('click', async () => {
  await patchSettings({ custom: null, customEnabled: false });
  load();
});

// Capture : la prochaine combinaison tapée devient le raccourci.
$('#custom-edit').addEventListener('click', () => {
  const key = $('#custom-key');
  const note = $('#custom-note');
  key.textContent = 'Appuie sur ta combinaison…';
  note.textContent = 'Échap pour annuler.';
  const onKey = async (e) => {
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return; // on attend la vraie touche
    e.preventDefault();
    window.removeEventListener('keydown', onKey, true);
    if (e.key === 'Escape') return load();
    if (!e.ctrlKey && !e.altKey && !e.metaKey) {
      await load();
      $('#custom-note').textContent = 'Il faut au moins Ctrl, Alt ou ⌘ : sinon le raccourci se déclencherait en tapant.';
      return;
    }
    await patchSettings({ custom: { code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }, customEnabled: true });
    load();
  };
  window.addEventListener('keydown', onKey, true);
});

// Chrome n'autorise pas une extension à changer ses raccourcis : on ouvre sa page dédiée.
$('#shortcut-edit').addEventListener('click', () => {
  const firefox = typeof browser !== 'undefined' && !!browser.runtime?.getBrowserInfo;
  chrome.tabs.create({ url: firefox ? 'about:addons' : 'chrome://extensions/shortcuts' });
});

// Le raccourci peut avoir été modifié dans l'autre onglet : on se met à jour au retour.
window.addEventListener('focus', load);
load();
