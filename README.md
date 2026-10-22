# AutoConnexion

Extension Chrome qui se connecte toute seule à tes sites. Tu enregistres une fois ta connexion
(les clics), puis elle est rejouée à chaque visite de la page. **Les identifiants restent dans
Bitwarden** : l'extension attend que Bitwarden remplisse les champs, puis continue les clics.
Elle ne lit ni ne stocke jamais de mot de passe et ne fait aucune requête réseau.

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

La prochaine fois que tu ouvres cette page, la connexion se fait toute seule.

## Limites connues

- Les formulaires dans une iframe ne sont pas gérés.
- Les menus déroulants (`<select>`) ne sont pas enregistrés.
- Captchas : à faire à la main.
- Si le site change son HTML, ré-enregistre la connexion.
- Si la connexion échoue et renvoie sur la même page, aucune nouvelle tentative pendant 20 s
  (évite de bloquer ton compte).
