// Validation d'une sauvegarde importée (partagé entre la page Sauvegarde et les tests).
const STEP_TYPES = ['click', 'fill', 'check', 'enter', 'select'];

// Le fichier importé n'est pas fiable : on reconstruit chaque champ attendu, rien d'autre.
const isStr = (v, max) => typeof v === 'string' && v.length <= max;

function cleanTarget(t) {
  if (!t || !isStr(t.css, 1000) || !isStr(t.tag, 30)) return null;
  const out = {
    css: t.css,
    tag: t.tag,
    text: isStr(t.text, 100) ? t.text : '',
    label: isStr(t.label, 100) ? t.label : '',
    path: isStr(t.path, 1000) ? t.path : '',
    attrs: {},
    chain: [],
  };
  if (t.attrs && typeof t.attrs === 'object') {
    for (const [k, v] of Object.entries(t.attrs).slice(0, 20)) {
      if (/^[\w-]{1,40}$/.test(k) && isStr(v, 100)) out.attrs[k] = v; // la clé finit dans un sélecteur CSS
    }
  }
  if (Array.isArray(t.chain)) {
    if (t.chain.length > 10) return null;
    for (const hop of t.chain) {
      if (!hop || !['shadow', 'frame'].includes(hop.kind) || !isStr(hop.css, 1000)) return null;
      out.chain.push({ kind: hop.kind, css: hop.css });
    }
  }
  return out;
}

function cleanStep(s) {
  if (!s || typeof s !== 'object' || !STEP_TYPES.includes(s.type)) return null;
  if (!isStr(s.origin, 300) || !/^https?:\/\/[^/\s]+$/.test(s.origin)) return null;
  if (!isStr(s.path, 500) || !s.path.startsWith('/')) return null;
  const target = cleanTarget(s.target);
  if (!target) return null;
  const step = { origin: s.origin, path: s.path, type: s.type, target, label: isStr(s.label, 200) && s.label ? s.label : 'Étape' };
  if (s.type === 'check') step.checked = !!s.checked;
  if (s.type === 'select') {
    if (!isStr(s.value, 300)) return null;
    step.value = s.value;
    step.optText = isStr(s.optText, 100) ? s.optText : '';
  }
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

if (typeof module !== 'undefined') module.exports = { cleanRule, cleanStep, cleanTarget };
