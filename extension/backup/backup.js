const $ = (s) => document.querySelector(s);
const STEP_TYPES = ['click', 'fill', 'check', 'enter'];

function say(text, isError = false) {
  const m = $('#msg');
  m.hidden = false;
  m.className = 'msg' + (isError ? ' err' : '');
  m.textContent = text;
}

async function refreshCount() {
  const { rules = [] } = await chrome.storage.local.get('rules');
  $('#count').textContent = `${rules.length} connexion${rules.length > 1 ? 's' : ''} à exporter.`;
  $('#export').disabled = !rules.length;
}

// Le fichier importé n'est pas fiable : on reconstruit chaque champ attendu, rien d'autre.
const isStr = (v, max) => typeof v === 'string' && v.length <= max;

function cleanStep(s) {
  if (!s || typeof s !== 'object' || !STEP_TYPES.includes(s.type)) return null;
  if (!isStr(s.origin, 300) || !/^https?:\/\/[^/\s]+$/.test(s.origin)) return null;
  if (!isStr(s.path, 500) || !s.path.startsWith('/')) return null;
  const t = s.target;
  if (!t || !isStr(t.css, 1000) || !isStr(t.tag, 30) || (t.text !== undefined && !isStr(t.text, 100))) return null;
  const step = {
    origin: s.origin,
    path: s.path,
    type: s.type,
    target: { css: t.css, tag: t.tag, text: t.text || '' },
    label: isStr(s.label, 200) && s.label ? s.label : 'Étape',
  };
  if (s.type === 'check') step.checked = !!s.checked;
  return step;
}

function cleanRule(r) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.steps) || r.steps.length === 0 || r.steps.length > 100) return null;
  let start;
  try {
    const u = new URL(r.startUrl);
    if (!/^https?:$/.test(u.protocol)) return null;
    start = u.href;
  } catch {
    return null;
  }
  const steps = r.steps.map(cleanStep);
  if (steps.includes(null)) return null;
  return {
    id: isStr(r.id, 60) && r.id ? r.id : crypto.randomUUID(),
    name: isStr(r.name, 80) && r.name.trim() ? r.name.trim() : new URL(start).hostname,
    startUrl: start,
    enabled: r.enabled !== false,
    createdAt: Number(r.createdAt) || Date.now(),
    steps,
  };
}

$('#export').addEventListener('click', async () => {
  const { rules = [] } = await chrome.storage.local.get('rules');
  const data = { app: 'AutoConnexion', version: 1, exportedAt: new Date().toISOString(), rules };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `autoconnexion-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say(`${rules.length} connexion${rules.length > 1 ? 's' : ''} exportée${rules.length > 1 ? 's' : ''}.`);
});

$('#import').addEventListener('click', () => $('#file').click());

$('#file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let list;
  try {
    const data = JSON.parse(await file.text());
    list = Array.isArray(data) ? data : data.rules;
    if (!Array.isArray(list)) throw new Error();
  } catch {
    return say('Fichier illisible : ce n’est pas une sauvegarde AutoConnexion.', true);
  }
  const imported = list.map(cleanRule).filter(Boolean);
  if (!imported.length) return say('Aucune connexion valide dans ce fichier.', true);

  const { rules = [] } = await chrome.storage.local.get('rules');
  const replaced = new Set(rules.filter((r) => imported.some((i) => i.id === r.id || i.startUrl === r.startUrl)).map((r) => r.id));
  const kept = rules.filter((r) => !replaced.has(r.id));
  await chrome.storage.local.set({ rules: [...kept, ...imported] });
  const ignored = list.length - imported.length;
  say(
    `${imported.length} connexion${imported.length > 1 ? 's' : ''} importée${imported.length > 1 ? 's' : ''}` +
      (ignored ? `, ${ignored} ignorée${ignored > 1 ? 's' : ''} (format invalide)` : '') +
      '. Ouvre le popup et clique sur « Autoriser » pour chaque site : Chrome doit redonner l’accès.'
  );
  refreshCount();
});

refreshCount();
