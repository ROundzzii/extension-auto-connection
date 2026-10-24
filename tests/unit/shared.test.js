const test = require('node:test');
const assert = require('node:assert/strict');
const { altHost, originsFor, neededOrigins, sameSite, normPath } = require('../../extension/shared.js');

test('altHost : www et sans www', () => {
  assert.equal(altHost('www.myges.fr'), 'myges.fr');
  assert.equal(altHost('myges.fr'), 'www.myges.fr');
  assert.equal(altHost('code.nathan.duckdns.org'), null);
  assert.equal(altHost('localhost'), null);
});

test('originsFor : ignore le port et ajoute la variante www', () => {
  assert.deepEqual(originsFor('https://www.myges.fr'), ['https://www.myges.fr/*', 'https://myges.fr/*']);
  assert.deepEqual(originsFor('http://localhost:3000'), ['http://localhost/*']);
  assert.deepEqual(originsFor('https://code.x.duckdns.org:8443'), ['https://code.x.duckdns.org/*']);
});

test('neededOrigins : étapes + page de départ, sans doublon', () => {
  const rule = {
    startUrl: 'https://www.myges.fr/',
    steps: [{ origin: 'https://www.myges.fr' }, { origin: 'https://authentication.kordis.fr' }],
  };
  assert.deepEqual([...neededOrigins([rule])].sort(), ['https://authentication.kordis.fr/*', 'https://myges.fr/*', 'https://www.myges.fr/*']);
});

test('sameSite et normPath', () => {
  assert.ok(sameSite('https://www.a.fr', 'https://a.fr'));
  assert.ok(!sameSite('https://a.fr', 'https://b.fr'));
  assert.equal(normPath('/login/'), '/login');
  assert.equal(normPath('/'), '/');
  assert.equal(normPath(''), '/');
});
