const $ = (s) => document.querySelector(s);

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
