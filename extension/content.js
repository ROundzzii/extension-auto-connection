// AutoConnexion : enregistre les clics d'une connexion, puis les rejoue.
// Les mots de passe ne sont jamais lus ni stockés : on attend que Bitwarden
// remplisse les champs, puis on continue les clics.
(() => {
  'use strict';
  if (window.top !== window || window.__autoConnexion) return; // évite la double injection
  window.__autoConnexion = true;

  const UNSTABLE = /\d{4,}|[0-9a-f]{8,}|^:r|^ember|^react/i;
  const TEXT_TYPES = ['text', 'email', 'password', 'tel', 'number', 'search', 'url'];
  const GUARD_MS = 20000;

  let rec = null;
  let myTabId = null;
  let overlay = null;
  let running = false;
  const recordedFields = new WeakSet();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const normPath = () => location.pathname.replace(/\/+$/, '') || '/';
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const textOf = (el) => norm(el.innerText || el.value || el.getAttribute('aria-label') || '');
  const isTextField = (el) => el.localName === 'input' && TEXT_TYPES.includes(el.type);

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  }

  async function getAll() {
    try {
      return await chrome.storage.local.get(['rules', 'enabled', 'recording']);
    } catch {
      return {};
    }
  }

  // ---------- Sélecteurs ----------
  // Une cible = un chemin (iframes, shadow DOM) + plusieurs repères pour retrouver l'élément.
  // Si le repère principal casse (le site a changé), un repère de secours prend le relais
  // et la cible est réparée automatiquement.

  const ATTRS = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'name', 'aria-label', 'autocomplete', 'placeholder'];
  const KEEP_ATTRS = ['id', 'name', 'type', 'aria-label', 'placeholder', 'data-testid', 'autocomplete', 'role'];

  const q = (root, css) => {
    try {
      return [...root.querySelectorAll(css)];
    } catch {
      return []; // sélecteur invalide
    }
  };
  const only = (list) => (list.length === 1 ? list[0] : null);
  const labelOf = (el) => norm(el.labels?.[0]?.innerText || '').slice(0, 60);

  // Sélecteur structurel (tags + positions), relatif au document ou au shadow root de l'élément.
  // structural = true ignore les ids : c'est le repère de secours quand les ids ont changé.
  function pathSelector(el, structural = false) {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== n.ownerDocument.body && parts.length < 6) {
      if (!structural && n.id && !UNSTABLE.test(n.id)) {
        parts.unshift('#' + CSS.escape(n.id));
        break;
      }
      let part = n.localName;
      const sib = [...n.parentNode.children].filter((c) => c.localName === n.localName);
      if (sib.length > 1) part += `:nth-of-type(${sib.indexOf(n) + 1})`;
      parts.unshift(part);
      n = n.parentElement;
    }
    return parts.join(' > ');
  }

  function candidates(el) {
    const tag = el.localName;
    const out = [];
    if (el.id && !UNSTABLE.test(el.id)) out.push('#' + CSS.escape(el.id));
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && !UNSTABLE.test(v)) out.push(`${tag}[${a}="${CSS.escape(v)}"]`);
    }
    if (el.type) out.push(`${tag}[type="${el.type}"]`);
    return out;
  }

  function selectorIn(el) {
    const scope = el.getRootNode();
    return candidates(el).find((c) => only(q(scope, c)) === el) || pathSelector(el);
  }

  // Chemin depuis la page jusqu'au document (iframe) ou shadow root qui contient l'élément.
  function chainOf(el) {
    const chain = [];
    let n = el;
    for (;;) {
      const root = n.getRootNode();
      if (root.nodeType === 11 && root.host) {
        chain.unshift({ kind: 'shadow', css: selectorIn(root.host) });
        n = root.host;
      } else if (root.nodeType === 9 && root.defaultView && root.defaultView !== window && root.defaultView.frameElement) {
        const frame = root.defaultView.frameElement;
        chain.unshift({ kind: 'frame', css: selectorIn(frame) });
        n = frame;
      } else {
        return chain;
      }
    }
  }

  function buildTarget(el) {
    const tag = el.localName;
    const clickable = ['button', 'a', 'summary'].includes(tag) || el.getAttribute('role') === 'button' || el.type === 'submit';
    const attrs = {};
    for (const a of KEEP_ATTRS) {
      const v = el.getAttribute(a);
      if (v && !UNSTABLE.test(v)) attrs[a] = v.slice(0, 80);
    }
    return {
      css: selectorIn(el),
      tag,
      text: clickable ? textOf(el).slice(0, 60) : '',
      label: labelOf(el),
      attrs,
      path: pathSelector(el, true),
      chain: chainOf(el),
    };
  }

  function rootFor(chain) {
    let root = document;
    for (const hop of chain || []) {
      const host = root.querySelector(hop.css);
      if (!host) return null;
      root = hop.kind === 'shadow' ? host.shadowRoot : host.contentDocument; // null si fermé / autre domaine
      if (!root) return null;
    }
    return root;
  }

  // Renvoie { el, via } : via = 'css' si le repère principal marche, sinon le repère de secours utilisé.
  function locate(t) {
    let root = null;
    try {
      root = rootFor(t.chain);
    } catch {
      /* sélecteur invalide */
    }
    if (!root) return null;
    const primary = q(root, t.css);
    if (primary.length === 1) return { el: primary[0], via: 'css' };
    const visible = (l) => l.filter(isVisible);
    const tries = [
      ['attributs', () => Object.entries(t.attrs || {}).map(([k, v]) => only(visible(q(root, `${t.tag}[${k}="${CSS.escape(v)}"]`)))).find(Boolean)],
      ['texte', () => t.text && only(visible(q(root, t.tag).filter((e) => textOf(e) === t.text)))],
      ['étiquette', () => t.label && only(visible(q(root, t.tag).filter((e) => labelOf(e) === t.label)))],
      ['position', () => t.path && only(q(root, t.path))],
    ];
    for (const [via, fn] of tries) {
      const el = fn();
      if (el) return { el, via };
    }
    const first = visible(primary)[0]; // dernier recours : sélecteur principal ambigu
    return first ? { el: first, via: 'css' } : null;
  }

  // Position à l'écran, y compris pour un élément dans une iframe.
  function absRect(el) {
    const r = el.getBoundingClientRect();
    let { left, top } = r;
    let w = el.ownerDocument.defaultView;
    while (w && w !== window && w.frameElement) {
      const f = w.frameElement.getBoundingClientRect();
      left += f.left;
      top += f.top;
      w = w.parent;
    }
    return { left, top, width: r.width, height: r.height };
  }

  function hint(el) {
    return el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || el.type || el.localName;
  }

  // ---------- UI (shadow DOM pour ne pas être touché par le CSS du site) ----------

  const CSS_TEXT = `
    :host{all:initial}
    *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
    .card{background:#fff;color:#1c1b22;border:1px solid #e3e3ea;border-radius:12px;box-shadow:0 8px 28px rgba(20,20,40,.2);padding:12px 14px;font-size:13px;line-height:1.4;width:310px;display:flex;flex-direction:column;gap:10px}
    @media (prefers-color-scheme:dark){.card{background:#25242c;color:#f1f0f5;border-color:#3a3945}input{background:#1a1920!important;color:#f1f0f5!important;border-color:#3a3945!important}}
    .row{display:flex;align-items:center;gap:8px}.row.end{justify-content:flex-end}
    .msg{flex:1}.count{margin-left:auto;opacity:.65;font-size:12px}.hint{opacity:.75;font-size:12px}
    .dot{width:10px;height:10px;border-radius:50%;flex:none;background:#8a8aa0}
    .dot.busy{border:2px solid #c9c6ff;border-top-color:#5b5bf0;background:none;width:14px;height:14px;animation:spin .8s linear infinite}
    .dot.ok{background:#1f9d55}.dot.err{background:#d64545}
    .dot.rec{background:#d64545;animation:pulse 1.2s ease-in-out infinite}
    @keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{50%{opacity:.35}}
    button{font:inherit;font-weight:600;border-radius:8px;padding:6px 12px;cursor:pointer;border:1px solid transparent}
    .primary{background:#5b5bf0;color:#fff}.primary:hover{background:#4a4ae0}
    .ghost{background:transparent;color:inherit;border-color:#c8c8d4}.ghost:hover{background:rgba(128,128,160,.15)}
    input{width:100%;padding:7px 9px;border:1px solid #d3d3de;border-radius:8px;font:inherit;background:#fff;color:#1c1b22}
  `;

  function h(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    e.append(...kids);
    return e;
  }

  function shadowHost(pos) {
    const host = h('div', { 'data-ac-host': '1', style: `all:initial;position:fixed;z-index:2147483647;${pos}` });
    const root = host.attachShadow({ mode: 'open' });
    root.append(h('style', {}, CSS_TEXT));
    (document.body || document.documentElement).appendChild(host);
    return { host, root };
  }

  function toast(message) {
    const { host, root } = shadowHost('bottom:16px;right:16px');
    const dot = h('span', { class: 'dot busy' });
    const text = h('span', { class: 'msg' }, message);
    const cancel = h('button', { class: 'ghost' }, 'Annuler');
    root.append(h('div', { class: 'card' }, h('div', { class: 'row' }, dot, text, cancel)));
    let timer;
    const api = {
      cancelled: false,
      set(m) {
        text.textContent = m;
      },
      end(kind, m, ms) {
        dot.className = 'dot ' + kind;
        text.textContent = m;
        cancel.hidden = true;
        clearTimeout(timer);
        timer = setTimeout(api.close, ms);
      },
      close() {
        host.remove();
      },
    };
    cancel.addEventListener('click', () => {
      api.cancelled = true;
      api.close();
    });
    return api;
  }

  // ---------- Enregistrement ----------

  function showOverlay() {
    if (overlay) return;
    const { host, root } = shadowHost('top:16px;right:16px');
    const count = h('span', { class: 'count' });
    const hintEl = h('div', { class: 'hint' }, 'Connecte-toi normalement : laisse Bitwarden remplir les champs, puis clique sur « Se connecter ». Si le site te renvoie vers un autre domaine, rouvre l’icône de l’extension sur la nouvelle page.');
    const name = h('input', { type: 'text', 'aria-label': 'Nom de la connexion', value: rec.name || location.hostname });
    root.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'row' }, h('span', { class: 'dot rec' }), h('strong', {}, 'Enregistrement en cours'), count),
        hintEl,
        name,
        h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: cancelRecording }, 'Annuler'), h('button', { class: 'primary', onclick: finishRecording }, 'Terminer'))
      )
    );
    overlay = { host, count, name, hintEl };
    updateCount();
  }

  function hideOverlay() {
    overlay?.host.remove();
    overlay = null;
  }

  function updateCount() {
    if (!overlay) return;
    const n = rec.steps.length;
    overlay.count.textContent = `${n} étape${n > 1 ? 's' : ''}`;
  }

  function persist() {
    chrome.storage.local.set({ recording: rec }).catch(() => {});
  }

  function addStep(step) {
    rec.steps.push({ origin: location.origin, path: normPath(), ...step });
    persist();
    updateCount();
  }

  // Tous les inputs de la page, y compris dans les shadow DOM et les iframes du même domaine.
  function deepInputs(root = document, out = []) {
    for (const el of root.querySelectorAll('*')) {
      if (el.hasAttribute('data-ac-host')) continue; // notre propre interface
      if (el.localName === 'input') out.push(el);
      if (el.shadowRoot) deepInputs(el.shadowRoot, out);
      if (el.localName === 'iframe' || el.localName === 'frame') {
        try {
          if (el.contentDocument) deepInputs(el.contentDocument, out);
        } catch {
          /* autre domaine : inaccessible */
        }
      }
    }
    return out;
  }

  // Ajoute un « remplir » pour chaque champ déjà rempli (par Bitwarden ou à la main).
  // La valeur n'est jamais lue : on ne retient que le sélecteur.
  function flushFilled() {
    for (const el of deepInputs()) {
      if (!isTextField(el) || !el.value || recordedFields.has(el) || !isVisible(el)) continue;
      recordedFields.add(el);
      addStep({ type: 'fill', target: buildTarget(el), label: `Attendre le champ « ${hint(el)} »` });
    }
  }

  // Vrai si l'événement vient de notre propre interface (panneau, bulle).
  const isOurs = (e) => e.composedPath().some((n) => n.nodeType === 1 && n.hasAttribute('data-ac-host'));

  function onClick(e) {
    if (!rec || !e.isTrusted || isOurs(e)) return;
    const t = e.composedPath()[0]; // vraie cible, même dans un shadow DOM ouvert
    if (!t || t.nodeType !== 1) return;
    const el = t.closest('button,a[href],input[type=submit],input[type=button],input[type=checkbox],input[type=radio],[role=button],[role=link],summary,label') || t;
    if (el.localName === 'label' && el.control) return; // le clic sur l'input suivra
    if (isTextField(el) || ['textarea', 'select', 'option', 'body', 'html'].includes(el.localName)) return;
    flushFilled();
    if (el.type === 'checkbox') {
      setTimeout(() => addStep({ type: 'check', checked: el.checked, target: buildTarget(el), label: `Case « ${hint(el)} » ${el.checked ? 'cochée' : 'décochée'}` }), 0);
      return;
    }
    addStep({ type: 'click', target: buildTarget(el), label: `Cliquer « ${textOf(el).slice(0, 40) || hint(el)} »` });
  }

  function onKey(e) {
    if (!rec || !e.isTrusted || e.key !== 'Enter' || isOurs(e)) return;
    const el = e.composedPath()[0];
    if (!el || el.nodeType !== 1 || !isTextField(el)) return;
    flushFilled();
    addStep({ type: 'enter', target: buildTarget(el), label: `Valider avec Entrée dans « ${hint(el)} »` });
  }

  // Menu déroulant : l'événement « input » traverse les shadow DOM, pas « change ».
  function onSelect(e) {
    if (!rec || !e.isTrusted || isOurs(e)) return;
    const el = e.composedPath()[0];
    if (!el || el.localName !== 'select') return;
    flushFilled();
    const target = buildTarget(el);
    const last = rec.steps[rec.steps.length - 1];
    if (last?.type === 'select' && last.target.css === target.css) rec.steps.pop(); // il a changé d'avis
    const text = el.selectedOptions[0]?.text.trim().slice(0, 80) || '';
    addStep({ type: 'select', value: el.value, optText: text, target, label: `Choisir « ${text.slice(0, 40) || el.value} »` });
  }

  // Les iframes du même domaine ont leur propre document : on y branche aussi les écouteurs.
  const hooked = new WeakSet();
  function hookDoc(doc) {
    if (hooked.has(doc)) return;
    hooked.add(doc);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('input', onSelect, true);
  }
  function hookFrames(root = document) {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) hookFrames(el.shadowRoot);
      if (el.localName === 'iframe' || el.localName === 'frame') {
        try {
          if (el.contentDocument) {
            hookDoc(el.contentDocument);
            hookFrames(el.contentDocument);
          }
        } catch {
          /* autre domaine : inaccessible */
        }
      }
    }
  }

  async function finishRecording() {
    if (!rec.steps.length) {
      overlay.hintEl.textContent = 'Rien n’a été enregistré : fais d’abord ta connexion.';
      return;
    }
    const { rules = [] } = await getAll();
    const rule = {
      id: crypto.randomUUID(),
      name: overlay.name.value.trim() || location.hostname,
      startUrl: rec.startUrl,
      enabled: true,
      createdAt: Date.now(),
      steps: rec.steps,
    };
    rec = null;
    hideOverlay();
    await chrome.storage.local.set({ rules: [...rules.filter((r) => r.startUrl !== rule.startUrl), rule], recording: null });
    toast('').end('ok', `Connexion « ${rule.name} » enregistrée`, 3500);
  }

  async function cancelRecording() {
    rec = null;
    hideOverlay();
    await chrome.storage.local.set({ recording: null });
  }

  // ---------- Rejeu ----------

  async function waitFor(fn, timeout, stop) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (stop?.()) return null;
      const v = fn();
      if (v) return v;
      await sleep(120);
    }
    return null;
  }

  // Remplace la cible d'une étape par une neuve, construite depuis l'élément réellement trouvé.
  async function healStep(ruleId, step, el) {
    try {
      const { rules = [] } = await getAll();
      const rule = rules.find((r) => r.id === ruleId);
      const saved = rule?.steps.find((x) => x.origin === step.origin && x.path === step.path && x.type === step.type && x.target.css === step.target.css);
      if (!saved) return;
      saved.target = buildTarget(el);
      await chrome.storage.local.set({ rules });
    } catch {
      /* extension rechargée */
    }
  }

  // Renvoie un court compte rendu, affiché dans le popup (« Dernière vérification »).
  async function runSteps(rule, steps, onEngaged) {
    const t = toast(`Connexion à ${rule.name}…`);
    let healed = 0;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const found = await waitFor(() => locate(step.target), i === 0 ? 5000 : 12000, () => t.cancelled);
      if (t.cancelled) return 'Annulé.';
      const el = found?.el;
      if (!el) {
        // Premier élément absent : probablement déjà connecté, on reste discret.
        if (i === 0) {
          t.close();
          return `Rien à faire : « ${step.label} » est introuvable sur cette page (déjà connecté ?).`;
        }
        t.end('err', `Élément introuvable : ${step.label}`, 7000);
        return `Échec : élément introuvable (${step.label}).`;
      }
      if (i === 0) onEngaged();
      if (found.via !== 'css') {
        healed++; // le repère principal a cassé : on met la cible à jour pour la prochaine fois
        healStep(rule.id, step, el);
      }
      if (step.type === 'fill') {
        if (!el.value) {
          t.set('En attente de Bitwarden… (déverrouille ton coffre si besoin)');
          const ok = await waitFor(() => el.value, 60000, () => t.cancelled);
          if (t.cancelled) return 'Annulé.';
          if (!ok) {
            t.end('err', 'Le champ est resté vide : Bitwarden est-il déverrouillé ?', 7000);
            return 'Échec : Bitwarden n’a pas rempli le champ.';
          }
          t.set(`Connexion à ${rule.name}…`);
        }
        await sleep(250);
      } else if (step.type === 'select') {
        const findOpt = () => [...el.options].find((o) => o.value === step.value) || [...el.options].find((o) => norm(o.text) === norm(step.optText || ''));
        const opt = await waitFor(findOpt, 8000, () => t.cancelled);
        if (t.cancelled) return 'Annulé.';
        if (!opt) {
          t.end('err', `Option introuvable : ${step.optText}`, 7000);
          return `Échec : option introuvable (${step.optText}).`;
        }
        el.value = opt.value;
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (step.type === 'check') {
        if (el.checked !== step.checked) el.click();
      } else if (step.type === 'enter') {
        if (el.form?.requestSubmit) el.form.requestSubmit();
        else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      } else {
        el.click();
      }
      await sleep(150);
    }
    t.end('ok', 'Connexion envoyée', 2500);
    const fixed = healed ? `, ${healed} réparée${healed > 1 ? 's' : ''} automatiquement` : '';
    return `Connexion « ${rule.name} » lancée (${steps.length} étape${steps.length > 1 ? 's' : ''}${fixed}).`;
  }

  // « www.site.fr » et « site.fr » sont traités comme le même site.
  const sameSite = (a, b) => a.replace('//www.', '//') === b.replace('//www.', '//');

  async function report(result) {
    try {
      const { runLog = [] } = await chrome.storage.local.get('runLog');
      const entry = { url: location.origin + normPath(), at: Date.now(), result };
      await chrome.storage.local.set({ runLog: [entry, ...runLog].slice(0, 6) });
    } catch {
      /* extension rechargée */
    }
  }

  // force = lancement manuel (raccourci clavier) : ignore l'anti-boucle et les interrupteurs.
  async function maybeRun(force = false) {
    if (running) return;
    const { rules = [], enabled = true, recording } = await getAll();
    const mine = rules.filter((r) => r.steps.some((s) => sameSite(s.origin, location.origin)));
    if (!mine.length) {
      if (force) toast('').end('err', 'Aucune connexion enregistrée pour ce site.', 3500);
      return; // site inconnu : on ne laisse aucune trace
    }
    if (rec || recording) return report('Un enregistrement est en cours : le rejeu est suspendu.');
    if (enabled === false && !force) return report('AutoConnexion est désactivé (interrupteur en haut du popup).');
    const path = normPath();
    let why = `Aucune étape enregistrée pour la page ${path}.`;
    for (const rule of mine) {
      if (rule.enabled === false && !force) {
        why = `« ${rule.name} » est désactivé.`;
        continue;
      }
      const steps = rule.steps.filter((s) => sameSite(s.origin, location.origin) && s.path === path);
      if (!steps.length) continue;
      // Anti-boucle : si le login échoue et renvoie sur la même page, on ne réessaie pas en rafale.
      // Le verrou ne se pose qu'une fois la première étape réellement trouvée.
      const key = `autoconnexion:${rule.id}:${path}`;
      try {
        if (!force && Date.now() - Number(sessionStorage.getItem(key) || 0) < GUARD_MS) {
          why = 'Ignoré par l’anti-boucle (déjà lancé il y a moins de 20 s).';
          continue;
        }
      } catch {
        /* sessionStorage indisponible */
      }
      const engage = () => {
        try {
          sessionStorage.setItem(key, String(Date.now()));
        } catch {
          /* ignoré */
        }
      };
      running = true;
      try {
        return report(await runSteps(rule, steps, engage));
      } finally {
        running = false;
      }
    }
    report(why);
    if (force) toast('').end('err', 'Aucune étape enregistrée pour cette page.', 3500);
  }

  // ---------- Test à blanc ----------
  // Surligne chaque étape de la page courante sans rien cliquer ni remplir.

  const TEST_CSS = `
    .trow{display:flex;align-items:flex-start;gap:8px;font-size:12px}
    .ic{width:14px;text-align:center;flex:none}
    .hl{position:fixed;border:3px solid #5b5bf0;border-radius:6px;box-shadow:0 0 0 4px rgba(91,91,240,.25);pointer-events:none;transition:all .15s}
  `;
  let testUI = null;

  function closeTest() {
    testUI?.panel.remove();
    testUI?.box.remove();
    testUI = null;
  }

  async function testRule(ruleId) {
    closeTest();
    const { rules = [] } = await getAll();
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return;
    const steps = rule.steps.filter((s) => sameSite(s.origin, location.origin) && s.path === normPath());

    const { host: panel, root } = shadowHost('top:16px;left:16px');
    const { host: box, root: boxRoot } = shadowHost('top:0;left:0;pointer-events:none');
    const hl = h('div', { class: 'hl' });
    hl.hidden = true;
    boxRoot.append(h('style', {}, TEST_CSS), hl);

    const rows = steps.map((s) => {
      const ic = h('span', { class: 'ic' }, '○');
      const lbl = h('span', { class: 'msg' }, s.label);
      return { s, ic, lbl, row: h('div', { class: 'trow' }, ic, lbl) };
    });
    const summary = h('div', { class: 'hint' }, 'Test en cours : rien n’est cliqué ni rempli.');
    root.append(
      h('style', {}, TEST_CSS),
      h(
        'div',
        { class: 'card' },
        h('strong', {}, `Test : ${rule.name}`),
        ...rows.map((r) => r.row),
        summary,
        h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => testRule(ruleId) }, 'Relancer'), h('button', { class: 'primary', onclick: closeTest }, 'Fermer'))
      )
    );
    testUI = { panel, box };

    let ok = 0;
    for (const { s, ic, lbl } of rows) {
      if (testUI?.panel !== panel) return; // fermé ou relancé entre-temps
      ic.textContent = '…';
      const found = locate(s.target);
      const el = found?.el;
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        await sleep(450);
        const r = absRect(el);
        Object.assign(hl.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width}px`, height: `${r.height}px` });
        hl.hidden = false;
        ic.textContent = found.via === 'css' ? '✓' : '↻';
        ok++;
        if (found.via !== 'css') lbl.textContent += ` (repère de secours : ${found.via}, sera réparé)`;
        if (s.type === 'fill') lbl.textContent += el.value ? ' (déjà rempli)' : ' (vide pour l’instant)';
      } else {
        hl.hidden = true;
        ic.textContent = '⚠';
        lbl.textContent += ' : introuvable';
      }
      await sleep(600);
    }
    hl.hidden = true;
    summary.textContent =
      ok === rows.length
        ? `Tout est trouvé (${ok}/${rows.length}). La connexion devrait fonctionner.`
        : `${ok}/${rows.length} trouvées. Une étape introuvable peut n’apparaître qu’après un clic (fenêtre, menu) : lance une vraie connexion pour vérifier.`;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'test') {
      testRule(msg.ruleId);
      sendResponse({ ok: true });
    } else if (msg?.type === 'run') {
      maybeRun(true);
      sendResponse({ ok: true });
    }
  });

  // ---------- Démarrage ----------

  hookDoc(document);

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local' || !ch.recording) return;
    const v = ch.recording.newValue;
    if (v && v.tabId === myTabId) {
      if (!rec) {
        rec = v;
        showOverlay();
      }
    } else if (!v && rec) {
      rec = null;
      hideOverlay();
    }
  });

  (async function init() {
    try {
      myTabId = (await chrome.runtime.sendMessage({ type: 'tabId' }))?.tabId ?? null;
    } catch {
      /* extension rechargée */
    }
    const { recording } = await getAll();
    if (recording && recording.tabId === myTabId) {
      rec = recording;
      showOverlay();
    } else {
      maybeRun();
    }
    // Sites en SPA : l'URL change sans rechargement.
    let last = location.href;
    setInterval(() => {
      if (rec) hookFrames(); // une iframe a pu apparaître
      if (location.href !== last) {
        last = location.href;
        maybeRun();
      }
    }, 700);
  })();
})();
