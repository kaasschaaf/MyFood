# 🍲 Kost — Smart Recipes & AI Cooking Assistant

A modern, fast, and mobile-friendly recipe web app for finding dishes, checking current **Albert Heijn prices and bonus deals** (calculated for **2 people by default**), viewing visual **protein and health indicators**, and asking the integrated **Gemini AI cooking assistant** your cooking questions.

Recipes, translations and product matches are **static data files** built by a pipeline in [`scripts/`](./scripts) and committed to the repository, so the app itself only downloads JSON and does the price arithmetic locally:

- `data/catalog.json` — the lean index the recipe grid renders (one entry per recipe).
- `data/recipes/NNN.json` — full recipes, 100 per shard, with Dutch **and** English titles, steps and ingredient names.
- `data/products.json` — every ingredient Kost needs, with the Albert Heijn products that match it, including nutrition.
- `data/prices.json` — the current price snapshot for those products, refreshed every Monday.

The recipe corpus is a curated **dinner** selection from the [Recipe Dataset (over 2M)](https://www.kaggle.com/datasets/wilmerarltstrmberg/recipe-dataset-over-2m), queried through ClickHouse's public playground (the dataset's original source), plus the hand-written Kost recipes and Allerhande links from the official [AH recipe sitemap](https://www.ah.nl/sitemaps/entities/allerhande/recipes.xml). Allerhande recipes link directly to AH for their ingredients and instructions, because AH blocks automated access to the recipe pages.

AH product search still exists, but only for **Mijn producten**: queries that the static database knows are answered from the snapshot, and only unknown queries go to the anonymous, unofficial Albert Heijn mobile API. No AH account or login is needed.

---

## 🌟 Key Features

- **🛒 Frequent Product Price & Health Comparison**:
  - Keep a private, browser-saved list of product types you buy often.
  - Preview live AH matches before adding a search group, and refresh the available category filters from AH for the current search.
  - Use a sliding overview and comparison detail panel; scoring criteria are saved separately for each product type.
  - Add a product as a draft directly to the overview, then edit its search term, AH category, and score criteria alongside live AH results; save to keep the changes or cancel to discard them.
  - Compare live Albert Heijn search results by price per kilogram, Nutri-Score, and protein per kcal; configure which criteria count separately for each product type.
  - Show protein per 100 g and a protein score based on the share of calories from protein, using AH's product nutrition details.
  - Current AH bonus prices are used when available; products without a per-kilogram unit price are shown without an invented conversion.
  - A shared setting to ignore online-only products is on by default and applies to recipe matches as well as product comparisons.

- **🔍 Smart Search & Filtering**:
  - Filter by dish style / cuisine: *Italian, Asian, Mexican, Mediterranean, Dutch, Indian*.
  - Quick toggles for:
    - 🔥 **AH Bonus Deals**: Show recipes whose ingredients are currently on sale this week.
    - 🥩 **High Protein**: Filter recipes with more than 30 grams of protein per person.
    - ⏱️ **Quick**: Filter recipes ready within 25 minutes.
  - Sort by: *Price per person (low-high), biggest bonus savings, most protein, health score, or prep time*.
  - Browse genuine Allerhande recipes alongside the cooked dataset; dinner dishes are tagged by type (pasta, kip, vis, stoof, oven…).

- **🛒 Albert Heijn Prices & Bonus Deals (Default: 2 people)**:
  - Matches every ingredient against the AH products stored in `data/products.json`, ranked by the same rules as a live search (completeness, exactness, pack size, price).
  - Shows the suitable AH products per ingredient as clickable links straight to the AH store page, with the current match highlighted.
  - Every amount is metric: `350 g broccoli`, `1,5 l water`, `2 teentjes knoflook` — cups, spoons and pounds from the source recipes are converted once by the pipeline.
  - Estimates the cost of the used quantity only when product-pack size and recipe units can be reliably converted. Other products show their pack price without inventing a quantity cost.
  - Recipe prices are calculated and cached so recipes with complete price data can be sorted by estimated price per person; unpriced recipes appear after priced recipes.
  - Dynamic portion switcher (`[-] 2 people [+]`): all weights and prices scale in real time from 1 to 8 people.
  - Clear **BONUS** badges, crossed-out regular prices, and exact savings displayed.

- **📊 Visual Protein & Health Indicators**:
  - Compact progress bar for **Protein** (with a strong color shift above 30g per person).
  - Visual **Health** score bar (0–100).
  - Detailed per-person breakdown of *kcal, protein, carbohydrates, and fats*.

- **🌍 On-Device Translation**:
  - Recipes are shown in the language you picked: TheMealDB is English and is translated to Dutch in Dutch mode, while the built-in Dutch recipes are translated to English in English mode. Translation uses the browser's built-in `Translator` API — no API key, nothing leaves your device. Chrome/Edge only, experimental, and the language pack may need to download once.
  - Your own Gemini key is used as a fallback when that API is unavailable; without either, recipes stay in the original language and Kost says so.
  - Ingredients are always translated to **Dutch** before the Albert Heijn lookup, using a built-in EN→NL glossary first and the on-device model for anything it does not know.

- **🥗 Protein & Health for Every Recipe**:
  - Built-in recipes carry hand-written nutrition; external recipes get an estimate from their ingredients (a compact offline food table with per-piece weights), so every card shows the same protein and health bars.
  - Estimates are marked as such in the card tooltip and under the nutrition dashboard.

- **✨ Integrated Gemini AI Cooking Assistant**:
  - Ask direct questions about the open recipe using Google's Gemini 3.8 Flash model and Interactions API.
  - Quick action buttons for:
    - 🥩 *"How can I make this dish even higher in protein?"*
    - 🔄 *"What can I replace if I dislike or don’t have certain ingredients?"*
    - 🍷 *"Which wine or drink pairs best with this meal?"*
    - 🥦 *"How can I turn this into a vegetarian version?"*
  - Free-form chat for all your personal cooking questions.
  - Your own Google Gemini API key is stored locally in your browser with `localStorage` for maximum privacy.

- **📱 Fully Responsive & Theme Support**:
  - Optimized for both mobile and desktop devices.
  - Includes light and dark mode.

- **📲 Installeerbaar als PWA**:
  - Installeer Kost als app via je browser (*Installeren* of *Zet op beginscherm*) op telefoon, tablet en desktop.
  - Een service worker bewaart de app-shell — pagina's, styling, scripts en de receptencatalogus — zodat Kost ook zonder internet opent. Live AH-prijzen en Gemini-vragen hebben uiteraard wel een verbinding nodig.
  - De app gebruikt `manifest.json`, de iconen in `icons/` en de offline-cache in `sw.js`. Verhoog `CACHE_VERSION` in `sw.js` wanneer je de offline-cache of de lijst met vooraf opgeslagen bestanden wijzigt.

- **💾 Browser Cache & Anonymous Data**:
  - Recipe catalogues and details, AH product search results, and your product-match selections are stored locally in IndexedDB.
  - AH price/search results are cached only within the current day and are re-fetched after local midnight, so daily/weekly bonus changes are always reflected. Cached data is shown immediately while live updates run; if AH is unavailable, Kost keeps usable cached results and indicates when AH data is stale.
  - Anonymous AH access tokens remain in memory only. Kost does not use your AH login or store AH credentials.
  - AH's recipe pages do not allow anonymous cross-origin access to recipe details, so Allerhande ingredients and instructions open on AH's own website.

---

## 🗂️ Data pipeline

The app never builds its own dataset. [`scripts/`](./scripts) does, and the
result is committed so GitHub Pages serves it as plain files.

```bash
cd scripts
npm install                 # @huggingface/transformers for local translation

npm run build:recipes       # dinner curation + local translation -> catalog + shards
npm run build:products      # one AH search per ingredient -> products + first prices
npm run build:allerhande    # Allerhande sitemap -> link-only cards
npm run verify              # integrity gate (also runs in CI and the test suite)
```

Useful flags: `--limit N` (dataset size), `--dry-run` (fetch and count only),
`--stage filter` (reuse the fetched candidates), `--verbose`.

**Curation.** Every row passes a counted funnel: structure (6–14 ingredients,
≥3 steps), blog noise, dessert markers in the title, dessert make-up in the
ingredients, a savoury dinner anchor, sweet-dominance, a parseable-ingredient
check and duplicate detection. The report prints how many rows each gate kept
and dropped, so the rules can be tuned from real numbers.

**Translation.** Titles, steps and ingredient names are translated with a local
MarianMT model (`Xenova/opus-mt-en-nl` / `Xenova/opus-mt-nl-en`, int8 ONNX)
through transformers.js. Nothing is sent to a translation service, results are
cached in `scripts/.cache/translations.json`, and outputs that look broken fall
back to the source text.

**Ingredients.** [`js/ingredient-canonical.js`](./js/ingredient-canonical.js)
turns a raw line into a stable Dutch key — fractions, ranges, brackets, prep
qualifiers and Dutch wording are normalised, so `To taste salt` is simply
`zout` and `1 1/2 cups (180 g) all-purpose flour, divided` is `bloem`.

**Metric only.** Recipes arrive in cups, spoons, ounces and pounds as often as in
grams. [`js/measure.js`](./js/measure.js) converts every amount once, at build
time: weight becomes `g`/`kg`, volume becomes `ml`/`l`, and counted things
(`clove`, `slice`, `can`, `pkg`, `bunch`, `pinch`…) keep their number with a
label that is localised when shown (`2 teentjes` / `2 cloves`). Cups, spoons and
imperial words never reach the page: measurements that end up inside an
ingredient name are stripped, and lost fraction slashes (`34 cup sour cream`)
are repaired. The app converts at render time as well, so a live TheMealDB
recipe is shown in metric too.

**Reports.** Every script prints one aligned block at the end: per-phase timings
with share of total, the per-gate funnel, translation/cache counts, ingredient
mapping coverage, real output sizes, throughput, and a sizing table extrapolated
from the run (build time, data size, product count and weekly price-job length
for 500 / 2 000 / 5 000 / 10 000 recipes). The same block is written to
`scripts/.reports/*.json` and to the GitHub Actions step summary, so the
dataset size can be chosen from measurements.

### Refreshing prices

`.github/workflows/data-prices.yml` runs every **Monday at 00:00 UTC (01:00
Amsterdam)** and on demand. It re-reads only the products already stored in
`data/products.json`, updates `data/prices.json`, and commits to `develop`. If
more than 20 % of the products disappear from AH, or fewer than 80 % of stored
products come back, the job aborts instead of writing a half-filled snapshot.

`.github/workflows/data-recipes.yml` rebuilds the whole dataset by hand (and on
the first of the month).

### Deployment

`.github/workflows/deploy.yml` publishes the site to GitHub Pages. GitHub Pages
serves one site per repository, so both branches are shipped from a single
artifact built by [`.github/scripts/build-site.sh`](./.github/scripts/build-site.sh):

| Path | Branch | Purpose |
| --- | --- | --- |
| `/` | `main` | production, the public URL |
| `/dev/` | `develop` | preview of the integration branch |

Every deploy rebuilds both trees, whichever branch triggered it, so releasing
`main` never wipes the preview and pushing `develop` never touches production.
The preview is marked `noindex, nofollow` and carries a small `dev · <sha>`
badge that links back to production; it uses its own service-worker cache
(`kost-<scope>-static-vN`), so the two installs never share storage.

`main` is production and is only fast-forwarded from `develop` when a change is
ready. The workflow also runs lint, the tests and, when the pipeline is present,
`scripts/verify-data.js` before anything is uploaded.

**The `github-pages` environment only accepts deployments from `main`.** A push
to `develop` therefore verifies its own commit and then dispatches the same
workflow on `main`, which rebuilds both trees; the deployment itself always runs
from a `main` ref. Nothing has to be changed in the repository settings for the
preview to work, and the deploy job fails loudly if `/dev/` is not live after
publishing.

---

## 📜 Data & licences

- **Recipe corpus**: [Recipe Dataset (over 2M)](https://www.kaggle.com/datasets/wilmerarltstrmberg/recipe-dataset-over-2m)
  by Wilmer Arlt Strömberg, licensed **CC BY-NC-SA 4.0** (attribution,
  non-commercial, share-alike). Kost curates it to dinner recipes and translates
  the text; the derived data in `data/` carries the same licence.
- **TheMealDB** — free for non-commercial use.
- **Albert Heijn** — product names, pack sizes and prices come from the public
  mobile API and are a snapshot, not a live quote. Allerhande recipe pages are
  linked, not copied.

Because the corpus is non-commercial, so is this app.

---

## 🤖 Set Up Your Gemini API Key (optional)

A key is only needed for the cooking assistant and as a translation fallback. Recipe translation works without one in browsers that ship the on-device `Translator` API.

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Click **Create API key**.
3. Open your Kost app, click **🔑 Gemini AI** in the top-right corner, paste your key, and click **Save**.
4. You can now ask questions directly about any recipe.

---

## 💻 Run Locally

To view the app on your own machine:

```bash
# Start a local web server
npx serve .
# Or use Python:
python3 -m http.server 8000
```

Then open `http://localhost:3000` or `http://localhost:8000` in your browser.

---

## 📲 Install as an App

Kost is a Progressive Web App. Open the deployed site over HTTPS (or `http://localhost`) and use your browser's install option:

- **Chrome / Edge (desktop or Android):** choose **Install app** in the address bar or browser menu.
- **Safari (iOS / iPadOS):** choose **Share → Add to Home Screen**.
- **Firefox:** installation is not supported on every platform; the app still works as a normal website.

The first visit caches the app shell. After that, Kost opens offline; live prices, new recipes, and Gemini answers still need a connection. Service workers only run on HTTPS or localhost, so opening `index.html` directly from disk will not register one.

> **Note:** The Albert Heijn mobile API is unofficial and undocumented. AH may change or limit it, and prices or availability may differ by store and over time. Static prices are a Monday snapshot, not a live quote; Mijn producten still queries AH live for products Kost does not know.
