# AutoConnexion

Extension Chrome qui se connecte toute seule à tes sites. Tu enregistres une fois ta connexion
(les clics), puis elle est rejouée à chaque visite de la page. **Les identifiants restent dans
Bitwarden** : l'extension attend que Bitwarden remplisse les champs, puis continue les clics.
Elle ne lit ni ne stocke jamais de mot de passe et ne fait aucune requête réseau.
Elle n'a accès **qu'aux sites que tu autorises** : Chrome te demande l'accès au moment
d'enregistrer une connexion, et le retire si tu supprimes la connexion.

## Installation (une seule fois)

1. Ouvre `chrome://extensions`.
2. Active **Mode développeur** (interrupteur en haut à droite).
3. Clique **Charger l'extension non empaquetée** et choisis le dossier `extension/`.
4. Épingle l'icône (puzzle → épingle) pour y accéder facilement.

## Réglage Bitwarden (une seule fois)

Extension Bitwarden → Paramètres → Saisie automatique → active
**Remplir automatiquement au chargement de la page**. Chaque entrée doit avoir l'URL du site
dans ses URI.

## Utilisation

1. Déconnecte-toi du site et ouvre sa page de connexion.
2. Clique sur l'icône AutoConnexion → **Enregistrer une connexion**. La page se recharge et un
   panneau rouge « Enregistrement en cours » apparaît.
3. Connecte-toi normalement (laisse Bitwarden remplir, clique sur « Se connecter »).
4. Clique **Terminer** dans le panneau, donne un nom si tu veux.

Au départ, Chrome demande d'autoriser le site : accepte. Si la connexion passe par un autre
domaine (SSO, CAS…), rouvre l'icône de l'extension sur la nouvelle page et clique
**Continuer ici** pour l'autoriser et poursuivre l'enregistrement.

Une connexion enregistrée avant la version 1.1 affiche un bouton rouge **Autoriser** dans le
popup : clique dessus une fois pour redonner l'accès au site.

La prochaine fois que tu ouvres cette page, la connexion se fait toute seule.

## Gérer ses connexions

- **▶ Tester** : sur la page de connexion, surligne chaque étape sans rien cliquer.
- **Renommer** une connexion : clique sur son nom. **↑ ↓ ✕** dans le détail des étapes pour les
  réordonner ou les supprimer.
- **Sauvegarde** (lien en bas du popup) : export / import des connexions en fichier JSON, sans mot de passe.

## Raccourci clavier et réglages

- **Alt+Shift+L** relance la connexion sur l'onglet actif (même si l'anti-boucle ou l'interrupteur du
  site l'aurait bloquée). Pratique quand la page est déjà chargée.
- Popup → **Réglages** : activer / désactiver le raccourci. Pour le changer, le bouton « Modifier »
  ouvre la page des raccourcis de Chrome (une extension ne peut pas le faire elle-même).

## Ce qui est géré en coulisses

- **Réparation automatique** : chaque étape est enregistrée avec plusieurs repères (identifiant,
  attributs, texte, libellé, position). Si le principal casse après une mise à jour du site, un repère
  de secours prend le relais et l'étape est réparée toute seule. Le popup l'indique
  (« 2 réparées automatiquement »).
- **Menus déroulants** (`<select>`), **iframes du même domaine** et **shadow DOM ouverts**.

## Limites connues

- Les iframes d'un **autre domaine** ne sont pas gérées (le navigateur interdit d'y accéder), ni les
  shadow DOM « fermés ».
- Captchas : à faire à la main.
- Si le site est refait de fond en comble, ré-enregistre la connexion.
- Si la connexion échoue et renvoie sur la même page, aucune nouvelle tentative pendant 20 s
  (évite de bloquer ton compte).

## Tester avec le labo local

`testlab/` contient de faux sites de connexion (aucun compte, aucun réseau) avec un faux Bitwarden
qui remplit l'email et le mot de passe 0,7 s après le chargement.

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory testlab
```

Ouvre ensuite `http://127.0.0.1:8765/` et suis les scénarios de la page d'accueil du labo :

| Scénario | Page | Ce qu'il faut vérifier |
|---|---|---|
| Menu déroulant | `classic.html` | Enregistre en choisissant « INTI » : au rejeu, le menu se positionne seul |
| Site modifié (ids changés) | `classic.html?v=2` | La connexion marche toujours ; le popup dit « réparées automatiquement » |
| Site très modifié | `classic.html?v=3` | Idem, même sans aucun identifiant |
| Iframe | `frame.html` | Enregistrement et rejeu dans le formulaire intégré |
| Shadow DOM | `shadow.html` | Idem |

Pour chaque scénario : enregistre (popup → Enregistrer, choisis « INTI », clique sur « Se connecter »,
Terminer), recharge la page, la connexion doit se rejouer. Le bouton **▶ Tester** montre en plus ↻ pour
une étape qui sera réparée.

## Développement

```bash
npm install               # une fois
npm test                  # syntaxe + tests unitaires
npx playwright install chromium   # une fois, pour les tests e2e
npm run test:e2e          # vrai Chromium + extension chargée, sur les faux sites de testlab/
npm run build             # dist/chrome (Chrome, Edge), dist/firefox, dist/test
npm run lint:firefox      # valide le paquet Firefox avec web-ext
```

La CI GitHub (`.github/workflows/ci.yml`) lance tout cela à chaque push.

## Navigateurs

| Navigateur | Comment | Statut |
|---|---|---|
| Chrome | Charger `extension/` (ou `dist/chrome`) en mode développeur | Testé |
| Edge | Même paquet que Chrome : `edge://extensions` → Mode développeur → Charger | Non testé à la main |
| Firefox | `npm run build`, puis `about:debugging` → Ce Firefox → Charger un module complémentaire temporaire → `dist/firefox/manifest.json` | Paquet validé par `web-ext lint`, non essayé à la main |

Firefox n'a pas l'API de favicons de Chrome : les petites icônes de sites sont simplement omises.
