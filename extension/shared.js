// Partagé entre le background (importScripts) et le popup (balise script).

// « site.fr » et « www.site.fr » sont considérés comme un seul site.
function altHost(host) {
  if (host.startsWith('www.')) return host.slice(4);
  return host.split('.').length === 2 ? 'www.' + host : null;
}

// Motifs d'accès demandés à Chrome pour une origine (le port est ignoré par Chrome).
function originsFor(origin) {
  const u = new URL(origin);
  const out = [`${u.protocol}//${u.hostname}/*`];
  const alt = altHost(u.hostname);
  if (alt) out.push(`${u.protocol}//${alt}/*`);
  return out;
}

// Tous les accès dont les connexions enregistrées ont besoin.
function neededOrigins(rules) {
  const set = new Set();
  for (const rule of rules) {
    for (const s of rule.steps) originsFor(s.origin).forEach((o) => set.add(o));
    originsFor(new URL(rule.startUrl).origin).forEach((o) => set.add(o));
  }
  return set;
}

// Même logique que le content script : www ignoré, slash final ignoré.
const sameSite = (a, b) => a.replace('//www.', '//') === b.replace('//www.', '//');
const normPath = (pathname) => pathname.replace(/\/+$/, '') || '/';
