# 🍲 MyFood — Smart Recipes & AI Cooking Assistant

A modern, fast, and mobile-friendly recipe web app for finding dishes, checking current **Albert Heijn prices and bonus deals** (calculated for **2 people by default**), viewing visual **protein and health indicators**, and asking the integrated **Gemini AI cooking assistant** your cooking questions.

Recipes are sourced from the built-in MyFood collection, up to 250 recipes from [TheMealDB](https://www.themealdb.com/), and up to 250 genuine recipes listed in the official [Allerhande recipe sitemap](https://www.ah.nl/sitemaps/entities/allerhande/recipes.xml). Allerhande recipes link directly to AH for their ingredients and instructions. AH product search uses the anonymous, unofficial Albert Heijn mobile API; no AH account or login is needed. Live product results, recipe catalogues, recipe details, and product choices are cached in IndexedDB in your browser and refreshed as they expire.

---

## 🌟 Key Features

- **🔍 Smart Search & Filtering**:
  - Filter by dish style / cuisine: *Italian, Asian, Mexican, Mediterranean, Dutch, Indian*.
  - Quick toggles for:
    - 🔥 **AH Bonus Deals**: Show recipes whose ingredients are currently on sale this week.
    - 🥩 **High Protein**: Filter recipes with more than 30 grams of protein per person.
    - ⏱️ **Quick**: Filter recipes ready within 25 minutes.
  - Sort by: *Price per person (low-high), biggest bonus savings, most protein, health score, or prep time*.
  - Browse genuine Allerhande recipes alongside the built-in and TheMealDB collections.

- **🛒 Albert Heijn Prices & Bonus Deals (Default: 2 people)**:
  - Matches external recipe ingredients against live AH product search results.
  - Choose another AH product when the suggested match is not right.
  - Estimates the cost of the used quantity only when product-pack size and recipe units can be reliably converted. Other products show their pack price without inventing a quantity cost.
  - External recipe prices are calculated and cached so recipes with complete price data can be sorted by estimated price per person; unpriced recipes appear after priced recipes.
  - Dynamic portion switcher (`[-] 2 people [+]`): all weights and prices scale in real time from 1 to 8 people.
  - Clear **BONUS** badges, crossed-out regular prices, and exact savings displayed.
  - Checkable ingredient list with AH product names for convenient shopping.

- **📊 Visual Protein & Health Indicators**:
  - Compact progress bar for **Protein** (with a strong color shift above 30g per person).
  - Visual **Health** score bar (0–100).
  - Detailed per-person breakdown of *kcal, protein, carbohydrates, and fats*.

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

- **💾 Browser Cache & Anonymous Data**:
  - Recipe catalogues and details, AH product search results, and your product-match selections are stored locally in IndexedDB.
  - Cached data is shown when available while updates run; if an external source is unavailable, MyFood keeps usable cached results and indicates when AH data is stale.
  - Anonymous AH access tokens remain in memory only. MyFood does not use your AH login or store AH credentials.
  - AH's recipe pages do not allow anonymous cross-origin access to recipe details, so Allerhande ingredients and instructions open on AH's own website.

---

## 🤖 Set Up Your Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Click **Create API key**.
3. Open your MyFood app, click **🔑 Gemini AI** in the top-right corner, paste your key, and click **Save**.
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

> **Note:** The Albert Heijn mobile API is unofficial and undocumented. AH may change or limit it, and prices or availability may differ by store and over time. TheMealDB recipe data may not include nutrition information or an original publisher link for every recipe.
