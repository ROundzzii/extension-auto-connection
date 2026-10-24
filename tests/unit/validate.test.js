const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanRule } = require('../../extension/validate.js');

const step = (over = {}) => ({
  origin: 'https://www.myges.fr',
  path: '/',
  type: 'click',
  target: { css: '#login-btn', tag: 'button', text: 'se connecter', attrs: { id: 'login-btn' }, chain: [] },
  label: 'Cliquer',
  ...over,
});
const rule = (over = {}) => ({ id: 'a', name: 'MyGES', startUrl: 'https://www.myges.fr/', steps: [step()], ...over });

test('accepte une connexion valide', () => {
  const r = cleanRule(rule());
  assert.equal(r.name, 'MyGES');
  assert.equal(r.enabled, true);
  assert.equal(r.steps.length, 1);
});

test('refuse les URL non http(s)', () => {
  assert.equal(cleanRule(rule({ startUrl: 'javascript:alert(1)' })), null);
  assert.equal(cleanRule(rule({ startUrl: 'file:///etc/passwd' })), null);
});

test('refuse un type d\'étape inconnu ou une liste vide', () => {
  assert.equal(cleanRule(rule({ steps: [step({ type: 'evil' })] })), null);
  assert.equal(cleanRule(rule({ steps: [] })), null);
});

test('garde select avec sa valeur, refuse select sans valeur', () => {
  assert.equal(cleanRule(rule({ steps: [step({ type: 'select', value: 'inti', optText: 'INTI' })] })).steps[0].value, 'inti');
  assert.equal(cleanRule(rule({ steps: [step({ type: 'select' })] })), null);
});

test('refuse une clé d\'attribut dangereuse (elle finit dans un sélecteur CSS)', () => {
  const t = { css: 'a', tag: 'a', attrs: { 'x"] , body [y': 'v', name: 'ok' }, chain: [] };
  const r = cleanRule(rule({ steps: [step({ target: t })] }));
  assert.deepEqual(r.steps[0].target.attrs, { name: 'ok' });
});

test('valide la chaîne iframe / shadow', () => {
  const ok = { css: 'a', tag: 'a', chain: [{ kind: 'frame', css: '#f' }, { kind: 'shadow', css: 'x-y' }] };
  assert.equal(cleanRule(rule({ steps: [step({ target: ok })] })).steps[0].target.chain.length, 2);
  const bad = { css: 'a', tag: 'a', chain: [{ kind: 'script', css: '#f' }] };
  assert.equal(cleanRule(rule({ steps: [step({ target: bad })] })), null);
});

test('ne recopie aucun champ inconnu', () => {
  const r = cleanRule(rule({ steps: [step({ password: 'secret' })], extra: 1 }));
  assert.equal('password' in r.steps[0], false);
  assert.equal('extra' in r, false);
});
