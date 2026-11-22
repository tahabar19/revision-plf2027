# 🎧 Révision audio – ميزانية وزارة النقل واللوجيستيك · PLF 2027

Site web de révision **en audio** (arabe), construit à partir de la présentation
*Budget du Ministère du Transport et de la Logistique – PLF 2027* (Chambre des représentants, 3 novembre 2026).

- **53 épisodes** (~1 h 40 au total) répartis en 8 axes : vue d'ensemble (cadre, faits marquants 2026, indicateurs), transport ferroviaire, transport aérien et aéroports, transport routier, sécurité routière, logistique, secteurs transversaux (digitalisation, plan législatif), budget 2027
  — tous les axes de la présentation sauf le transport maritime (النقل البحري)
- Pour chaque axe : un épisode « مراجعة سريعة » (révision express des chiffres) et un **quiz audio** (question → 3 s de réflexion → réponse)
- Onglet **الأرقام المفتاحية** (chiffres clés) et onglet **اختبر نفسك** (cartes question/réponse)
- Texte affiché et surligné pendant l'écoute, vitesse réglable (0,8× à 2×), reprise là où vous vous êtes arrêté, fonctionne hors ligne une fois installé

## Deux façons d'avoir le son

| Mode | Qualité | Ce qu'il faut faire |
|---|---|---|
| **Voix du téléphone** (par défaut) | correcte, dépend du téléphone | rien : le site lit le texte avec la synthèse vocale arabe de l'appareil |
| **Fichiers MP3** (recommandé) | voix neuronale arabe naturelle (`ar-MA-JamalNeural`) | activer GitHub Actions (option B) : les MP3 sont générés automatiquement |

Le site choisit tout seul : MP3 s'ils existent, sinon voix du téléphone.

---

## Option A – Publication rapide (5 min, possible depuis le téléphone)

1. Créez un dépôt sur GitHub (ex. `revision-plf2027`), public.
2. **Add file → Upload files** et envoyez les fichiers de la racine :
   `index.html`, `styles.css`, `app.js`, `data.js`, `sw.js`, `manifest.webmanifest`, `icon.svg`, `README.md`.
3. **Settings → Pages → Build and deployment → Source : Deploy from a branch**, branche `main`, dossier `/ (root)` → **Save**.
4. Après 1–2 minutes, le site est en ligne : `https://VOTRE-NOM.github.io/revision-plf2027/`.

➡️ Le son utilise alors la voix arabe du téléphone (voir « Installer une voix arabe » plus bas).

## Option B – Avec les MP3 générés automatiquement (recommandé)

À faire depuis un ordinateur (pour envoyer les dossiers `scripts/` et `.github/`) :

1. Envoyez **tout le contenu** du zip dans le dépôt, y compris `scripts/generate_audio.py` et `.github/workflows/pages.yml`.
   > Le dossier `.github` est caché sur certains systèmes. Si l'upload ne le prend pas, créez le fichier à la main :
   > **Add file → Create new file**, nom `.github/workflows/pages.yml`, puis collez le contenu du fichier.
2. **Settings → Pages → Build and deployment → Source : GitHub Actions**.
3. Onglet **Actions** : le workflow « Audio + GitHub Pages » se lance à chaque push (ou bouton **Run workflow**).
   Il génère les 53 MP3 (~10 min la première fois, puis seulement les épisodes modifiés), puis publie le site.
4. Pour changer de voix : **Actions → Audio + GitHub Pages → Run workflow** et saisissez par ex.
   `ar-MA-MounaNeural` (voix féminine marocaine), `ar-SA-HamedNeural`, `ar-EG-ShakirNeural`…

Si la génération échoue (service de voix indisponible), le site est publié quand même et utilise la voix du téléphone.

### Générer les MP3 sur votre ordinateur (alternative)

```bash
pip install edge-tts          # + ffmpeg installé (https://ffmpeg.org)
python scripts/generate_audio.py                       # voix par défaut
python scripts/generate_audio.py --voice ar-MA-MounaNeural
```
Puis envoyez le dossier `audio/` dans le dépôt (avec l'option A, c'est suffisant).

## Écouter hors ligne

Ouvrez le site une fois avec Internet, puis ⚙️ **الإعدادات → تحميل كل الحلقات على هذا الجهاز**.
Sur téléphone, « Ajouter à l'écran d'accueil » pour l'avoir comme une application.

## Installer une voix arabe sur le téléphone (mode « voix du téléphone »)

- **Android** : Paramètres → Gestion globale / Accessibilité → Synthèse vocale → moteur Google → installer les données vocales **العربية**.
- **iPhone** : Réglages → Accessibilité → Contenu énoncé → Voix → **Arabe** → télécharger (ex. Majed, voix « améliorée »).
- Puis dans le site : ⚙️ → choisir la voix → « جرّب الصوت ».

## Modifier le contenu

Tout le texte est dans `data.js` (JSON : axes → épisodes → paragraphes, chiffres clés, quiz).
Les chiffres sont écrits normalement (`4.786`, `18,9%`) : ils sont convertis automatiquement pour la lecture
(« 4786 », « 18 فاصلة 9 في المائة »). Après modification, le workflow régénère uniquement les épisodes changés.

## Structure

```
index.html  styles.css  app.js     interface et lecteur
data.js                            contenu (texte des épisodes, chiffres clés, quiz)
sw.js  manifest.webmanifest  icon.svg   mode hors ligne / application
scripts/generate_audio.py          génération des MP3 + audio/manifest.json
.github/workflows/pages.yml        génération automatique + publication GitHub Pages
```

---
Contenu rédigé à partir de la présentation du ministère (PLF 2027) pour la révision personnelle ; en cas de doute sur un chiffre, se référer au document officiel.
