// Faux site de connexion pour tester AutoConnexion. Aucun vrai compte, aucun réseau.
// ?v=1 (défaut) : site « normal » · ?v=2 : ids renommés · ?v=3 : plus aucun id/name, seulement les libellés
// ?autofill=0 : désactive le faux Bitwarden (qui remplit email et mot de passe après 0,7 s)
const Lab = (() => {
  const params = new URLSearchParams(location.search);
  const version = params.get('v') || '1';
  const opts = [['', '— Choisir —'], ['ges', 'École GES'], ['inti', 'INTI'], ['demo', 'Démo']]
    .map(([v, t]) => `<option value="${v}">${t}</option>`)
    .join('');

  function formHtml() {
    if (version === '3') {
      return `<form class="f"><label for="u-1c">Adresse e-mail</label><input id="u-1c" type="email">
        <label for="p-1c">Mot de passe</label><input id="p-1c" type="password">
        <label for="s-1c">Établissement</label><select id="s-1c">${opts}</select>
        <button type="submit">Se connecter</button></form>`;
    }
    if (version === '2') {
      return `<form class="f"><input id="user-email-field" name="email" type="email" placeholder="Email">
        <input id="user-pass-field" name="password" type="password" placeholder="Mot de passe">
        <select id="school-picker" name="school">${opts}</select>
        <button id="submit-btn-v2" type="submit">Se connecter</button></form>`;
    }
    return `<form class="f"><input id="email" name="email" type="email" placeholder="Email">
      <input id="password" name="password" type="password" placeholder="Mot de passe">
      <select id="school" name="school">${opts}</select>
      <button id="login-btn" type="submit">Se connecter</button></form>`;
  }

  function mount(box) {
    box.innerHTML = `<p class="v">Version du site : v${version}</p>${formHtml()}<div class="res"></div>`;
    const form = box.querySelector('form');
    const email = form.querySelector('input[type=email]');
    const pass = form.querySelector('input[type=password]');
    const select = form.querySelector('select');
    const res = box.querySelector('.res');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ok = email.value && pass.value;
      res.className = 'res ' + (ok ? 'ok' : 'ko');
      res.textContent = ok ? `✓ Connecté · établissement : ${select.selectedOptions[0].text}` : '✗ Champs vides';
    });
    // Faux Bitwarden : remplit les champs sans les connaître (valeurs de démonstration)
    if (params.get('autofill') !== '0') {
      setTimeout(() => {
        for (const [el, v] of [[email, 'demo@example.test'], [pass, 'demo-only']]) {
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, 700);
    }
  }
  return { mount, version };
})();
