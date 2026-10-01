# 🍲 MyFood — Smart Recipes & AI Cooking Assistant

A modern, fast, and mobile-friendly recipe web app for finding dishes, checking current **Albert Heijn prices and bonus deals** (calculated for **2 people by default**), viewing visual **protein and health indicators**, and asking the integrated **Gemini AI cooking assistant** your cooking questions.

---

## 🌟 Key Features

- **🔍 Smart Search & Filtering**:
  - Filter by dish style / cuisine: *Italian, Asian, Mexican, Mediterranean, Dutch, Indian*.
  - Quick toggles for:
    - 🔥 **AH Bonus Deals**: Show recipes whose ingredients are currently on sale this week.
    - 🥩 **High Protein**: Filter recipes with more than 30 grams of protein per person.
    - ⏱️ **Quick**: Filter recipes ready within 25 minutes.
  - Sort by: *Price per person (low-high), biggest bonus savings, most protein, health score, or prep time*.

- **🛒 Albert Heijn Prices & Bonus Deals (Default: 2 people)**:
  - Instantly calculates total cost and price per person at Albert Heijn.
  - Dynamic portion switcher (`[-] 2 people [+]`): all weights and prices scale in real time from 1 to 8 people.
  - Clear **BONUS** badges, crossed-out regular prices, and exact savings displayed.
  - Checkable ingredient list with AH product names for convenient shopping.

- **📊 Visual Protein & Health Indicators**:
  - Compact progress bar for **Protein** (with a strong color shift above 30g per person).
  - Visual **Health** score bar (0–100).
  - Detailed per-person breakdown of *kcal, protein, carbohydrates, and fats*.

- **✨ Integrated Gemini AI Cooking Assistant**:
  - Ask direct questions about the open recipe to Google Gemini.
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
