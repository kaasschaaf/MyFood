# 🍲 MyFood — Slimme Recepten & AI Kookassistent

Een moderne, razendsnelle en mobielvriendelijke recepten-webapp geoptimaliseerd voor **GitHub Pages**. Vind recepten, bekijk direct de actuele **Albert Heijn prijzen & Bonusaanbiedingen** (standaard berekend voor **2 personen**), bekijk visuele balkjes voor **eiwitten en gezondheid**, en stel al je kookvragen aan de geïntegreerde **Gemini AI Kookassistent**.

---

## 🌟 Belangrijkste Functies

- **🔍 Slim Zoeken & Filteren**:
  - Filter op gerechtstijl / keuken: *Italiaans, Aziatisch, Mexicaans, Mediterraans, Hollands, Indiaas*.
  - Snelle toggles voor:
    - 🔥 **AH Bonus Deals**: Toon direct gerechten waarvan ingrediënten deze week in de aanbieding zijn.
    - 🥩 **Eiwitrijk**: Filter op gerechten met meer dan 30 gram eiwit per persoon.
    - ⏱️ **Snel**: Filter op gerechten die binnen 25 minuten op tafel staan.
  - Sorteren op: *Prijs per persoon (laag-hoog), Meeste bonusvoordeel, Meeste proteïne, Gezondheidsscore of Bereidingstijd*.

- **🛒 Albert Heijn Prijzen & Bonus (Standaard 2 personen)**:
  - Berekent direct de totale kosten én de prijs per persoon bij Albert Heijn.
  - Dynamische portie-schakelaar (`[-] 2 pers [+]`): alle gewichten en prijzen schalen realtime mee van 1 t/m 8 personen.
  - Duidelijke **BONUS** badges, doorgestreepte normale prijzen en weergave van het exacte bespaarde bonusbedrag.
  - Afvinkbare ingrediëntenlijst met AH productnamen handig voor tijdens het boodschappen doen.

- **📊 Visuele Eiwit- & Gezondheidsindicatoren**:
  - Compacte progress bar voor **Proteïne** (met opvallend kleurverloop bij >30g eiwit).
  - Visuele scorebalk voor **Gezondheid** (0-100 score).
  - Gedetailleerd overzicht per persoon van *kcal, eiwit, koolhydraten en vetten*.

- **✨ Geïntegreerde Gemini AI Kookassistent**:
  - Stel direct vragen over het geopende recept aan Google Gemini.
  - Snelle actieknoppen voor:
    - 🥩 *"Hoe maak ik dit gerecht nóg eiwitrijker?"*
    - 🔄 *"Wat kan ik vervangen als ik bepaalde ingrediënten niet lust of mis?"*
    - 🍷 *"Welke wijn of drank past hier perfect bij?"*
    - 🥦 *"Hoe tover ik dit om tot een vegetarische variant?"*
  - Vrije chat-invoer voor al je persoonlijke kookvragen.
  - Je eigen Google Gemini API-sleutel wordt 100% veilig lokaal in je eigen browser opgeslagen (`localStorage`).

- **📱 Volledig Responsive & Thema's**:
  - Geoptimaliseerd voor zowel smartphone/mobiel als desktop pc.
  - Inclusief lichte en donkere modus (Dark Mode).

---

## 🚀 Publiceren op GitHub Pages (Stap-voor-stap)

Omdat de webapp volledig statisch is, kun je deze in 3 minuten gratis online zetten via GitHub Pages:

### Stap 1: Maak een nieuwe repository op GitHub
1. Ga naar [GitHub.com/new](https://github.com/new).
2. Geef je repo een naam, bijvoorbeeld `MyFood`.
3. Kies voor **Public** (openbaar) zodat GitHub Pages en GitHub Actions 100% gratis en onbeperkt zijn.
4. Klik op **Create repository**.

### Stap 2: Push de code naar je repository
Open je terminal in deze map en voer uit:
```bash
git add .
git commit -m "feat: eerste versie van MyFood webapp"
git remote add origin https://github.com/JOUW-GEBRUIKERSNAAM/MyFood.git
git push -u origin main
```

### Stap 3: Zet GitHub Pages aan
1. Ga in je GitHub repository naar **Settings** > **Pages** (in het linkermenu).
2. Onder **Build and deployment** > **Source**:
   - Kies **GitHub Actions** (er staat al automatisch een workflow voor je klaar in `.github/workflows/deploy.yml`!).
3. Na circa 1 minuut is je website live op:
   `https://JOUW-GEBRUIKERSNAAM.github.io/MyFood/`

---

## 🤖 Gratis Gemini API Sleutel Instellen

1. Ga naar [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Klik op **Create API key** (volledig gratis met je Google-account).
3. Open je MyFood webapp, klik rechtsboven op **🔑 Gemini AI**, plak je sleutel en klik op **Opslaan**.
4. Je kunt nu direct vragen stellen bij elk gerecht!

---

## 🔄 Automatische Wekelijkse AH Bonus Updates

In de map `.github/workflows/update-ah-bonus.yml` staat een geautomatiseerde cron-job:
- Deze draait **elke maandagochtend om 06:00** (wanneer de nieuwe AH Bonus ingaat).
- Het script haalt de actuele aanbiedingen en prijzen op en werkt automatisch `data/ah-bonus.json` en `data/recipes.json` bij.
- Dit kost bij een gratis GitHub account minder dan 0,2% van je eventuele privélimiet en is in publieke repo's onbeperkt gratis.
- Je kunt deze actie in GitHub ook altijd handmatig starten via het tabblad **Actions** > **Update Wekelijkse AH Bonus & Prijzen** > **Run workflow**.

---

## 💻 Lokaal Draaien & Testen

Wil je de app eerst lokaal bekijken op je eigen pc?
```bash
# Start een lokale webserver
npx serve .
# Of gebruik Python:
python3 -m http.server 8000
```
Open vervolgens `http://localhost:3000` of `http://localhost:8000` in je browser.
