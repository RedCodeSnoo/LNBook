# LNBook

Liseuse Android pour les **light novels** et les **web novels**. LNBook lit vos fichiers EPUB et
TXT, suit les novels publiés en ligne grâce aux sources de la communauté LNReader, lit les
chapitres à voix haute, les traduit entre l'anglais et le français et garde vos passages
préférés. Elle compte aussi votre temps de lecture.

Pas de compte, pas de publicité, pas de mesure d'audience : tout reste sur le téléphone.

<p align="center">
  <img src="docs/screenshots/library.webp" width="200" alt="Bibliothèque">
  <img src="docs/screenshots/novel.webp" width="200" alt="Page d'un novel">
  <img src="docs/screenshots/reader-light.webp" width="200" alt="Lecteur, thème clair">
  <img src="docs/screenshots/stats.webp" width="200" alt="Statistiques">
</p>

## Sommaire

- [Captures d'écran](#captures-décran)
- [Fonctionnalités](#fonctionnalités)
- [Installation](#installation)
- [Mises à jour](#mises-à-jour)
- [Sauvegarde et restauration](#sauvegarde-et-restauration)
- [Sources et plugins LNReader](#sources-et-plugins-lnreader)
- [Traduction](#traduction)
- [Confidentialité](#confidentialité)
- [Compiler l'application](#compiler-lapplication)
- [Licences](#licences)

## Captures d'écran

| Bibliothèque | Page du novel | Définir ma progression | Chapitres lus |
| :---: | :---: | :---: | :---: |
| <img src="docs/screenshots/library.webp" width="180" alt="Bibliothèque"> | <img src="docs/screenshots/novel.webp" width="180" alt="Page du novel"> | <img src="docs/screenshots/progress.webp" width="180" alt="Feuille Définir ma progression"> | <img src="docs/screenshots/novel-progress.webp" width="180" alt="Chapitres marqués lus avec le temps estimé"> |

| Lecteur, thème clair | Thème sépia | Thème nuit | Réglages d'affichage |
| :---: | :---: | :---: | :---: |
| <img src="docs/screenshots/reader-light.webp" width="180" alt="Lecteur en thème clair"> | <img src="docs/screenshots/reader-sepia.webp" width="180" alt="Lecteur en thème sépia"> | <img src="docs/screenshots/reader-night.webp" width="180" alt="Lecteur en thème nuit"> | <img src="docs/screenshots/display-settings.webp" width="180" alt="Panneau Aa des réglages d'affichage"> |

| Barres du lecteur | Voix | Traduction | Drapeaux de langue |
| :---: | :---: | :---: | :---: |
| <img src="docs/screenshots/reader-bars.webp" width="180" alt="Barres du lecteur"> | <img src="docs/screenshots/voice.webp" width="180" alt="Lecture à voix haute"> | <img src="docs/screenshots/translated.webp" width="180" alt="Chapitre traduit en français"> | <img src="docs/screenshots/flags.webp" width="180" alt="Drapeaux de langue sur la page du novel"> |

| Citations (dossiers prêts à l'avance) | Historique | Statistiques | Classement et langues |
| :---: | :---: | :---: | :---: |
| <img src="docs/screenshots/quotes.webp" width="180" alt="Onglet Citations, avec la création de dossiers"> | <img src="docs/screenshots/history.webp" width="180" alt="Historique"> | <img src="docs/screenshots/stats.webp" width="180" alt="Statistiques"> | <img src="docs/screenshots/stats-ranking.webp" width="180" alt="Œuvres par temps passé et langues lues"> |

| Temps par jour et séries | | | |
| :---: | :---: | :---: | :---: |
| <img src="docs/screenshots/stats-calendar.webp" width="180" alt="Temps par jour, séries et calendrier"> | | | |

| Traduire un novel | Catalogue des sources | Parcourir une source | Mises à jour |
| :---: | :---: | :---: | :---: |
| <img src="docs/screenshots/translate-sheet.webp" width="180" alt="Feuille Traduire"> | <img src="docs/screenshots/catalogue.webp" width="180" alt="Catalogue des plugins"> | <img src="docs/screenshots/source.webp" width="180" alt="Résultats d'une source"> | <img src="docs/screenshots/updates.webp" width="180" alt="Onglet Mises à jour"> |

## Fonctionnalités

L'application est organisée en cinq onglets.

### Bibliothèque

- Deux sous-onglets : **En ligne** (novels suivis sur un site) et **Local** (fichiers importés et
  novels téléchargés en entier, lisibles sans réseau).
- Affichage en grille ou en liste, avec couverture, badges de chapitres non lus,
  téléchargés et de langue, et barre de progression.
- **Catégories** personnalisées, tri (dernière lecture, ajout, titre, chapitres non lus,
  progression, temps passé, dernière mise à jour), filtres et recherche.
- Sélection multiple pour déplacer, télécharger, marquer lu ou retirer plusieurs novels.
- **Import** de fichiers **EPUB 2 et 3** (couverture, volumes de la table des matières, images)
  et **TXT** (découpage automatique en chapitres, choix de l'encodage), depuis l'app ou avec
  « Ouvrir avec » / « Partager » depuis une autre application.

### Page d'un novel

- En-tête avec couverture, auteur, état, genres, description, **drapeaux de langue** (langue
  d'origine et traductions disponibles), temps total passé et progression.
- Bouton **Continuer** qui reprend au bon chapitre, à la bonne position.
- Liste des chapitres groupée par **volumes** repliables, chapitres lus grisés, temps passé par
  chapitre, filtres (non lus, téléchargés, favoris), recherche par numéro ou titre et **poignée de
  défilement rapide** avec le numéro du chapitre, pratique pour les novels de plusieurs milliers
  de chapitres.
- Onglets **Favoris** et **Citations** propres au novel.
- **Définir ma progression** : pour un novel commencé ailleurs, choisissez le dernier chapitre lu ;
  tous les chapitres jusqu'à celui-ci sont marqués lus et leur temps de lecture est **estimé**
  d'après leur nombre de mots et votre vitesse de lecture (mesurée par l'app, 250 mots/min par
  défaut). Le temps estimé est marqué « ~ » et peut être supprimé à tout moment.
- Téléchargement de chapitres (tous, non lus, une plage…), export **EPUB 3** (original ou
  traduit), modification des informations et de la couverture, réinitialisation de la progression.

### Lecteur

- Mode **défilement** ou **page par page**, zones de tap, boutons de volume pour tourner les pages,
  défilement automatique.
- Bouton **Aa** : thème (clair, sombre, nuit, sépia, papier, gris doux ou thème personnalisé),
  police (dont polices importées), taille, interligne, espacement des paragraphes, retrait,
  alignement et marges, appliqués en direct. Réglages possibles par novel.
- **Barre de progression** réservée en bas de l'écran, aux couleurs du thème : pourcentage du
  chapitre, fine barre de progression, et en option l'heure et la batterie.
- Position exacte gardée au paragraphe près, même après un changement de police ou de taille.
- Recherche dans le chapitre ou dans tout le livre, **règles de remplacement de texte** (pour
  retirer les phrases parasites des sites), modification d'un chapitre.
- Sélection de texte : copier, partager, **citation favorite**, traduire un passage.
- Luminosité, filtre de lumière chaude, écran toujours allumé, orientation.

### Voix

- Lecture à voix haute avec le moteur de synthèse vocale du téléphone, phrase en cours surlignée.
- Fonctionne **écran éteint**, avec notification, écran de verrouillage et boutons du casque.
- Vitesse, ton, voix par langue, pause entre les paragraphes, enchaînement automatique des
  chapitres et **minuteur de mise en veille**.

### Citations

- Enregistrez un passage en un appui long, avec une note, dans un ou plusieurs **dossiers**
  colorés ; les dossiers peuvent être préparés à l'avance, même sans citation.
- Revenez à l'endroit exact du passage, cherchez, triez, exportez en Markdown ou en texte.
- **Partage en image** avec quatre styles.

### Mises à jour

- Recherche des **nouveaux chapitres** des novels suivis, au lancement, à la demande et en
  arrière-plan (fréquence réglable), avec notification et téléchargement automatique au choix.
- Bouton **Rechercher les mises à jour** de l'application, avec le résultat affiché.

### Historique

- Chapitres lus, groupés par jour, avec la durée de lecture ; reprise en un tap ; suppression
  d'une entrée, d'un novel ou de tout l'historique. Le mode **incognito** n'enregistre rien.

### Parcourir

- Les **sources** de la communauté LNReader : catalogue, installation et mises à jour des
  plugins, filtrage par langue.
- Pages Populaires et Dernières sorties de chaque source, filtres propres à la source,
  **recherche globale** dans toutes les sources installées.
- Vue web intégrée, prise en charge des vérifications Cloudflare.

### Plus

- **Téléchargements** : file en arrière-plan (écran éteint), pause, reprise, gestion du stockage.
- **Statistiques** : temps total (lecture et écoute), chapitres et mots lus, vitesse de lecture,
  temps par jour, séries de jours et calendrier, heures préférées, classement des œuvres, temps par
  langue lue et par source, détail par novel et par chapitre. Le temps estimé de « Définir ma
  progression » compte dans les totaux et les classements, jamais dans les séries, le calendrier,
  les heures ni la vitesse.
- **Citations** de tous les novels.
- **Sauvegarde et restauration**.
- **Paramètres** : langue de l'interface (français ou anglais), thème et couleur d'accent, taille
  de l'interface, bibliothèque, lecteur, téléchargements, mises à jour, voix, traduction, réglages
  avancés (User-Agent, cookies, cache, journal d'erreurs).

## Installation

1. Sur le téléphone, ouvrez la page [Releases](https://github.com/RedCodeSnoo/LNBook/releases)
   et téléchargez le fichier `LNBook-vX.Y.Z.apk` de la dernière version. Un fichier `.sha256` est
   publié à côté pour vérifier le téléchargement.
2. Ouvrez le fichier. La première fois, Android demande d'**autoriser l'installation
   d'applications de cette source** (votre navigateur ou votre gestionnaire de fichiers) :
   activez l'option, revenez en arrière, puis touchez **Installer**.
3. Android 8.0 ou plus récent est nécessaire.

Toutes les versions sont signées avec la même clé : une nouvelle version s'installe par-dessus
l'ancienne et vos données sont conservées.

## Mises à jour

LNBook vérifie lui-même s'il existe une nouvelle version sur GitHub : au lancement, au retour dans
l'application et en arrière-plan (toutes les 6 heures par défaut ; 1 h, 12 h, 24 h ou jamais dans
**Plus → Paramètres → Mises à jour**). Une notification annonce chaque nouvelle version.

Vous pouvez aussi toucher **Rechercher les mises à jour** en haut de l'onglet **Mises à jour** ou
dans **Plus → À propos**. La mise à jour est téléchargée, son empreinte SHA-256 est vérifiée, vos
données sont sauvegardées, puis l'installateur Android s'ouvre. La première fois, Android demande
d'autoriser LNBook à installer des applications.

## Sauvegarde et restauration

Dans **Plus → Sauvegarde et restauration** :

- **Créer une sauvegarde** : bibliothèque, catégories, progression, positions de lecture,
  citations et dossiers, historique, statistiques, réglages, glossaires et plugins installés, avec
  en option les chapitres téléchargés, les livres importés et les traductions.
- **Restaurer** une sauvegarde, en remplaçant ou en fusionnant avec les données actuelles.
- **Sauvegarde automatique** quotidienne ou hebdomadaire dans un dossier choisi.
- **Importer une sauvegarde LNReader** : bibliothèque, catégories, progression et historique.

## Sources et plugins LNReader

Les novels en ligne proviennent des **plugins de la communauté
[LNReader](https://github.com/LNReader/lnreader-plugins)**, utilisés sans modification : LNBook
télécharge le catalogue officiel des plugins et les exécute dans l'application. Chaque source
appartient à son site ; LNBook ne fait que l'afficher.

Les plugins sont publiés par le projet LNReader sous **licence MIT**. Merci à leurs auteurs.

## Traduction

- **Google ML Kit**, directement sur le téléphone : gratuit et **hors ligne** une fois le modèle
  de langue téléchargé (environ 30 Mo par langue). Les modèles se gèrent dans
  **Paramètres → Traduction**.
- **DeepL**, en option, avec **votre propre clé** API (l'offre gratuite donne 500 000 caractères
  par mois). La clé est stockée chiffrée sur le téléphone et n'est jamais incluse dans les
  sauvegardes. Le quota restant est affiché.
- Traduction d'un chapitre à l'ouverture, des chapitres suivants à l'avance ou de tout le novel
  en arrière-plan ; **glossaire par œuvre** (noms propres à garder ou à traduire autrement),
  **affichage bilingue**, retour à l'original sur un paragraphe, export EPUB de la version traduite.
- Les **drapeaux de langue** de la page du novel montrent les versions disponibles ; un tap change
  la langue de lecture de tout le novel.

## Confidentialité

- Aucun compte, aucune publicité, aucune statistique d'usage envoyée.
- Vos livres, votre progression, vos citations et vos statistiques restent **sur le téléphone**.
- L'application ne contacte que : les sites des sources que vous installez, le catalogue des
  plugins LNReader, GitHub pour les mises à jour, Google pour télécharger les modèles de
  traduction ML Kit, et DeepL uniquement si vous y avez mis votre clé.

## Compiler l'application

```sh
npm ci
npm run prebuild
cd android && ./gradlew assembleRelease
```

Tests : `npm test`. Vérification des types et du style : `npm run typecheck` et `npm run lint`.

## Licences

LNBook est distribué sous **licence MIT** (voir [LICENSE](LICENSE)).

- Plugins des sources : [LNReader/lnreader-plugins](https://github.com/LNReader/lnreader-plugins),
  licence MIT.
- Traduction hors ligne : Google ML Kit (conditions d'utilisation de Google).
- La liste complète des bibliothèques utilisées et de leurs licences est dans l'application :
  **Plus → À propos → Licences open source**.
