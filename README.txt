# Signalement de travaux — app web (PC / Android / tablette)

Cette app est une version “signalement de travaux” sur carte, au même esprit que votre app *Patrimoine arboré* :
- Clic/tap sur la carte → place les coordonnées (prépare une nouvelle fiche)
- Bouton GPS → récupère la position et remplit lat/lng
- Photos depuis caméra + galerie, avec tampon **date + GPS** sur l’image
- Galerie + carrousel dans l’aperçu
- Liste + recherche, export/import JSON
- Mode “agent” (fiche en bottom sheet)

## Lancer en local
Ouvrez `index.html` dans un navigateur (Chrome/Edge recommandé).  
Pour le mode PWA + service worker, servez via un petit serveur local (ex: `python -m http.server`).

## Activer la synchro Google Sheets (optionnel)
1. Déployez une WebApp Google Apps Script (comme votre app Patrimoine arboré).
2. Mettez l’URL dans `API_URL` dans `app.js`.
3. Adaptez votre script GAS pour enregistrer les champs :
   - id, lat, lng, secteur, address, dateDemande, dateExecution, nature, comment, photos

Ensuite, l’app affichera l’écran de connexion (mot de passe) et enverra les données au format `payload`.



🔒 Version limitée à Marcq-en-Barœul (maxBounds + contrôles clic/GPS/enregistrement + filtrage import).


🟦 Contour EXACT de Marcq-en-Barœul (geo.api.gouv.fr, geometry=contour) affiché sur la carte.

🟢 Interne / 🔴 Externe : pastille sur le marqueur (restauré)

📧 Envoi de la fiche par mail (mailto)
🖨️ Impression directe de la fiche

📄 Export PDF avec photos intégré (téléchargement local)

🏛️ En-tête avec logo officiel de la Ville de Marcq-en-Barœul (écran + PDF)


## Numérotation centralisée Google Sheets (anti-doublons)
1) Déployez une WebApp Google Apps Script.
2) Implémentez l'action POST `nextDossier` (voir ci-dessous).
3) Collez l'URL dans `CENTRAL_DOSSIER_URL` dans `app.js`.

### Exemple GAS (à ajouter à votre doPost)
Si `e.parameter.action === "nextDossier"` :
- verrouillez avec LockService
- lisez/écrivez le compteur annuel dans une feuille PARAMETRES
- retournez `{ok:true, dossierNumber:"MARCQ-YYYY-XXXX"}`


✅ Connexion Apps Script active : renseignez GAS_URL dans app.js.
✅ Script Code.gs fourni (Hippodrome supprimé).
