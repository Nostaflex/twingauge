<p align="center"><img src="docs/assets/logo.svg" width="96" alt="Logo TwinGauge"></p>

<h1 align="center">TwinGauge</h1>

<p align="center">Les limites, sessions et agents de Claude Code et de Codex, côte à côte dans VS Code.</p>

<p align="center"><a href="README.md">English</a> · MIT · tout reste local</p>

---

Tu fais tourner Claude Code et Codex en parallèle et tu passes ton temps sur `/usage` pour savoir ce qu'il
te reste. TwinGauge réunit les deux dans un panneau, à côté de ton éditeur :

- **La fenêtre de 5 h** en courbe, avec une prévision (≈) de l'heure où tu atteindras la limite à ce rythme.
- **Les limites de 7 jours** de Claude (globale et par modèle) et de Codex. Un trait montre la part de la
  semaine déjà écoulée : une barre qui le dépasse consomme plus vite que le temps.
- **Les sessions des deux moteurs**, groupées par ce qui te concerne : t'attend, en marche, fini pas vu,
  au repos. Chaque ligne donne le modèle, le contexte, le coût (équivalent API) et ce que fait la session.
- **Les agents et sous-agents** sous leur session, chacun avec son modèle.
- **Aujourd'hui** : les jetons par heure de chaque moteur, empilés par modèle, les lectures du cache
  hachurées ; la part de l'entrée servie par le cache.
- **Barre d'état**, **badge** sur l'icône quand une session t'attend, notifications à 80 % et 95 %,
  sourdine d'une heure.
- **Canal des agents** entre Claude Code et Codex : ils se laissent demandes de revue et réponses dans ton
  projet, et chacun est prévenu des nouveaux messages de l'autre.

Un clic ouvre la conversation ; un clic droit épingle ou masque la session. L'interface suit la langue
de VS Code.

## Fonctionnement

Trois petites pièces, qui n'envoient rien nulle part.

| Pièce | Rôle |
|---|---|
| `claude-plugin/` : plugin Claude Code | Écrit l'état de chaque session dans `~/.claude/twingauge/sessions/<id>.json`. Toutes les 5 min, lit les limites du forfait au même point d'accès que `/usage`, par les identifiants de Claude Code lui-même. |
| `codex-hook/` : hook Codex | Écrit l'état de chaque session Codex dans `~/.claude/twingauge/codex/<id>.json`. |
| `vscode/` : extension VS Code | Lit ces fichiers et dessine le panneau. Demande à Codex lui-même (`codex app-server`) ses limites et sa liste de fils, sans jamais ouvrir un fichier sous `~/.codex`. |

## Installation

1. **Extension VS Code** : depuis le Marketplace VS Code ou Open VSX, ou `cd vscode && npm ci && npx @vscode/vsce package`.
2. **Plugin Claude Code** : `/plugin install twingauge --marketplace Nostaflex/twingauge`, puis `y` et une portée.
3. **Hook Codex (facultatif)** : `python3 -I codex-hook/installer.py`, puis `codex` et `/hooks` pour
   approuver les entrées TwinGauge.

## Canal des agents

Commande **TwinGauge : créer le canal des agents dans cet espace de travail** (menu `…` du panneau). Elle crée
`.twingauge/channel/` dans ton projet, avec `claude/`, `codex/` et un `README.md` qui donne le protocole.
Chaque agent écrit dans son dossier, un fichier Markdown par message ; au début de chaque session et à chaque
message, le plugin prévient Claude Code des nouveaux messages de Codex, et le hook prévient Codex de ceux de
Claude Code. Seuls les canaux créés sur cette machine comptent (listés dans `~/.claude/twingauge/channels.json`) :
un canal présent dans un dépôt cloné est ignoré. Un message reste une note de collègue, jamais une instruction de ta part : il n'accorde aucune
permission. Spécification : [docs/CHANNEL.md](docs/CHANNEL.md).

## Confidentialité

Tout reste sur ta machine : ni télémétrie, ni serveur, ni compte. Aucun prompt, aucune réponse, aucune
commande ni aucun contenu de fichier n'est écrit. TwinGauge ne lit ni ne garde aucun identifiant. Les
fichiers d'état gardent les chemins de tes projets, en local, et sont supprimés après sept jours. Testé sur macOS ;
Linux devrait fonctionner ; Windows non testé.

TwinGauge est un projet indépendant, sans lien avec Anthropic ni OpenAI.

## Feuille de route

- **Plus d'assistants** : jauges, sessions et place dans le canal pour les autres assistants (GitHub Copilot,
  Gemini, Cursor, Cline, Continue, modèles locaux…), configurables depuis un seul fichier.
- **Modèle par rôle** : choisir quel modèle pilote, relit ou fait les sous-agents, et s'y tenir.

## Licence

[MIT](LICENSE). Les icônes et le logo sont dessinés pour ce projet, sous la même licence.
