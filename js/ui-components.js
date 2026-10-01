/**
 * UI Components - Rendert receptenkaarten, modalen, balkjes en interactieve elementen
 */
export class UIComponents {
  constructor(ahService, geminiService, recipesService) {
    this.ahService = ahService;
    this.geminiService = geminiService;
    this.recipesService = recipesService;
  }

  /**
   * Rendert de receptenkaart in het hoofdraster
   * @param {Object} recipe 
   * @param {number} servings 
   * @returns {string} HTML string
   */
  renderRecipeCard(recipe, servings = 2) {
    const priceInfo = this.ahService.calculateRecipePrice(recipe, servings);
    const nutrition = recipe.nutrition || { calories: 0, proteinGrams: 0, healthScore: 70 };
    
    // Proteïne percentage op schaal van 0 tot 50 gram (bij 50g = 100%)
    const proteinPercent = Math.min(100, Math.round((nutrition.proteinGrams / 50) * 100));
    const isHighProtein = nutrition.proteinGrams >= 30;

    // Gezondheid percentage (0-100)
    const healthPercent = Math.min(100, Math.max(0, nutrition.healthScore || 75));

    return `
      <article class="recipe-card group bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border border-slate-100 dark:border-slate-700/60 flex flex-col" data-recipe-id="${recipe.id}">
        <!-- Foto & Badges -->
        <div class="relative h-48 sm:h-52 overflow-hidden bg-slate-100 dark:bg-slate-900">
          <img 
            src="${recipe.image}" 
            alt="${recipe.title}" 
            loading="lazy"
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            onerror="this.src='https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=800&q=80'"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20"></div>
          
          <!-- Badges bovenin -->
          <div class="absolute top-3 left-3 flex flex-wrap gap-1.5">
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-white/90 dark:bg-slate-900/90 text-slate-800 dark:text-slate-100 backdrop-blur-md shadow-sm">
              <span class="text-xs">⏱️</span> ${recipe.prepTimeMinutes} min
            </span>
            <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/90 text-white backdrop-blur-md shadow-sm">
              ${recipe.cuisine}
            </span>
          </div>

          <!-- Bonus Badge -->
          ${priceInfo.hasBonus ? `
            <div class="absolute top-3 right-3 animate-pulse">
              <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-extrabold bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md uppercase tracking-wide">
                <span>🔥</span> AH BONUS
              </span>
            </div>
          ` : ''}

          <!-- Prijs Overlay onderaan de foto -->
          <div class="absolute bottom-2 left-3 right-3 flex items-baseline justify-between text-white">
            <div class="flex items-baseline gap-1.5">
              <span class="text-xl font-bold text-white drop-shadow-md">
                ${this.ahService.formatEuro(priceInfo.totalPrice)}
              </span>
              <span class="text-xs text-white/80 font-medium">
                (${this.ahService.formatEuro(priceInfo.pricePerPerson)} p.p.)
              </span>
            </div>
            ${priceInfo.totalSavings > 0 ? `
              <span class="text-xs font-bold text-amber-300 drop-shadow">
                -${this.ahService.formatEuro(priceInfo.totalSavings)} voordeel
              </span>
            ` : ''}
          </div>
        </div>

        <!-- Kaart Inhoud -->
        <div class="p-4 sm:p-5 flex-1 flex flex-col justify-between">
          <div>
            <h3 class="font-bold text-lg text-slate-800 dark:text-slate-100 line-clamp-1 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
              ${recipe.title}
            </h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
              ${recipe.description}
            </p>
          </div>

          <!-- Visuele Indicatoren: Proteïne & Gezondheid -->
          <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 space-y-2.5">
            <!-- Proteïne Balkje -->
            <div>
              <div class="flex justify-between items-center text-xs mb-1">
                <span class="font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                  🥩 Proteïne
                  ${isHighProtein ? '<span class="text-[10px] bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded font-bold">Hoog</span>' : ''}
                </span>
                <span class="font-bold text-slate-800 dark:text-slate-200">
                  ${nutrition.proteinGrams}g <span class="text-[10px] text-slate-400 font-normal">/ portie</span>
                </span>
              </div>
              <div class="w-full bg-slate-100 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                <div 
                  class="h-full rounded-full transition-all duration-700 ${isHighProtein ? 'bg-gradient-to-r from-blue-500 to-indigo-600' : 'bg-blue-400'}" 
                  style="width: ${proteinPercent}%"
                  title="${nutrition.proteinGrams} gram eiwit per portie"
                ></div>
              </div>
            </div>

            <!-- Gezondheid Balkje -->
            <div>
              <div class="flex justify-between items-center text-xs mb-1">
                <span class="font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                  🥗 Gezondheid
                </span>
                <span class="font-bold ${healthPercent >= 90 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'}">
                  ${healthPercent}/100
                </span>
              </div>
              <div class="w-full bg-slate-100 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                <div 
                  class="h-full rounded-full transition-all duration-700 ${healthPercent >= 90 ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-gradient-to-r from-lime-400 to-emerald-500'}" 
                  style="width: ${healthPercent}%"
                  title="Gezondheidsscore: ${healthPercent}/100"
                ></div>
              </div>
            </div>
          </div>

          <!-- Actieknop -->
          <div class="mt-4 pt-3 flex items-center justify-between gap-2">
            <span class="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
              Standaard voor ${servings} pers.
            </span>
            <button 
              type="button" 
              class="open-recipe-btn inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 dark:bg-emerald-600 hover:bg-emerald-600 dark:hover:bg-emerald-500 rounded-xl transition-colors shadow-sm"
              data-recipe-id="${recipe.id}"
            >
              Kookhulp & Details
              <span>→</span>
            </button>
          </div>
        </div>
      </article>
    `;
  }

  /**
   * Rendert de detailweergave van een recept in het modale dialoogvenster
   * @param {Object} recipe 
   * @param {number} servings 
   * @returns {string} HTML string
   */
  renderRecipeModal(recipe, servings = 2) {
    const scale = servings / (recipe.baseServings || 2);
    const priceInfo = this.ahService.calculateRecipePrice(recipe, servings);
    const nutrition = recipe.nutrition || { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0, healthScore: 80 };

    return `
      <div class="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
        <!-- Header & Sluitknop -->
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                ${recipe.cuisine}
              </span>
              <span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                ⏱️ ${recipe.prepTimeMinutes} minuten
              </span>
              <span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                ⭐ ${recipe.difficulty}
              </span>
              ${priceInfo.hasBonus ? `
                <span class="px-2.5 py-1 rounded-full text-xs font-extrabold bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm">
                  🔥 BONUS DEAL
                </span>
              ` : ''}
            </div>
            <h2 class="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              ${recipe.title}
            </h2>
            <p class="text-sm text-slate-600 dark:text-slate-300 mt-1">
              ${recipe.description}
            </p>
          </div>
          <button 
            type="button" 
            id="close-modal-btn" 
            class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-2xl p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            aria-label="Sluiten"
          >
            ✕
          </button>
        </div>

        <!-- Portie Schakelaar & AH Prijs Banner -->
        <div class="bg-gradient-to-r from-slate-50 to-emerald-50/50 dark:from-slate-800 dark:to-slate-800/80 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-4">
          <!-- Portie selector -->
          <div class="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
            <span class="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Aantal personen:
            </span>
            <div class="inline-flex items-center bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl overflow-hidden shadow-sm">
              <button 
                type="button" 
                id="modal-portion-minus" 
                class="px-3.5 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition font-bold"
                ${servings <= 1 ? 'disabled' : ''}
              >
                -
              </button>
              <span id="modal-portion-count" class="px-4 py-1.5 font-bold text-sm text-emerald-600 dark:text-emerald-400 min-w-[3rem] text-center">
                ${servings} pers.
              </span>
              <button 
                type="button" 
                id="modal-portion-plus" 
                class="px-3.5 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition font-bold"
                ${servings >= 8 ? 'disabled' : ''}
              >
                +
              </button>
            </div>
          </div>

          <!-- AH Prijs Samenvatting -->
          <div class="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
            <div class="text-right">
              <div class="text-xs text-slate-500 dark:text-slate-400">
                Geschatte AH prijs (${servings} pers.)
              </div>
              <div class="text-xl font-extrabold text-slate-900 dark:text-white">
                ${this.ahService.formatEuro(priceInfo.totalPrice)}
                <span class="text-xs font-medium text-slate-500 dark:text-slate-400">(${this.ahService.formatEuro(priceInfo.pricePerPerson)} p.p.)</span>
              </div>
            </div>
            ${priceInfo.totalSavings > 0 ? `
              <div class="bg-amber-100 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-700 px-3 py-1.5 rounded-xl text-right">
                <div class="text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase">Jouw Bonusvoordeel</div>
                <div class="text-sm font-extrabold text-amber-700 dark:text-amber-400">-${this.ahService.formatEuro(priceInfo.totalSavings)}</div>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Voedingswaarden dashboard -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div class="bg-white dark:bg-slate-800/80 p-3 rounded-xl border border-slate-100 dark:border-slate-700 text-center shadow-sm">
            <span class="text-xs text-slate-400 block">Calorieën p.p.</span>
            <span class="text-lg font-bold text-slate-800 dark:text-slate-100">${nutrition.calories} <span class="text-xs font-normal">kcal</span></span>
          </div>
          <div class="bg-blue-50/50 dark:bg-blue-950/30 p-3 rounded-xl border border-blue-100 dark:border-blue-900/40 text-center shadow-sm">
            <span class="text-xs text-blue-600 dark:text-blue-400 block font-medium">🥩 Proteïne p.p.</span>
            <span class="text-lg font-bold text-blue-700 dark:text-blue-300">${nutrition.proteinGrams}g</span>
          </div>
          <div class="bg-white dark:bg-slate-800/80 p-3 rounded-xl border border-slate-100 dark:border-slate-700 text-center shadow-sm">
            <span class="text-xs text-slate-400 block">Koolhydraten p.p.</span>
            <span class="text-lg font-bold text-slate-800 dark:text-slate-100">${nutrition.carbsGrams}g</span>
          </div>
          <div class="bg-white dark:bg-slate-800/80 p-3 rounded-xl border border-slate-100 dark:border-slate-700 text-center shadow-sm">
            <span class="text-xs text-slate-400 block">Vetten p.p.</span>
            <span class="text-lg font-bold text-slate-800 dark:text-slate-100">${nutrition.fatGrams}g</span>
          </div>
        </div>

        <!-- Twee Kolommen: Ingrediënten & Bereiding -->
        <div class="grid grid-cols-1 md:grid-cols-12 gap-6">
          <!-- Ingrediëntenlijst (5 kolommen op desktop) -->
          <div class="md:col-span-5 space-y-3">
            <h3 class="font-bold text-base text-slate-800 dark:text-slate-100 flex items-center justify-between">
              <span>🛒 Ingrediënten</span>
              <span class="text-xs font-normal text-slate-400">Vink af voor winkelmand</span>
            </h3>
            <ul class="divide-y divide-slate-100 dark:divide-slate-700/60 bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700/60 overflow-hidden shadow-sm">
              ${(recipe.ingredients || []).map((ing, idx) => {
                const scaledAmount = Math.round((ing.amount * scale) * 10) / 10;
                let isBonus = ing.isBonus;
                let price = isBonus && ing.bonusPrice ? ing.bonusPrice : ing.standardPrice;
                let bonusDesc = ing.bonusText || 'Bonus';

                // Check override in bonus data
                if (this.ahService.bonusData?.discounts?.[ing.ahProductId]) {
                  const d = this.ahService.bonusData.discounts[ing.ahProductId];
                  isBonus = d.isBonus;
                  price = isBonus && d.bonusPrice ? d.bonusPrice : d.originalPrice;
                  bonusDesc = d.bonusText || bonusDesc;
                }

                return `
                  <li class="p-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition">
                    <input 
                      type="checkbox" 
                      id="ing-${recipe.id}-${idx}" 
                      class="mt-1 w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 dark:border-slate-600 dark:bg-slate-700 cursor-pointer"
                    />
                    <label for="ing-${recipe.id}-${idx}" class="flex-1 text-sm cursor-pointer select-none">
                      <div class="flex items-baseline justify-between gap-1">
                        <span class="font-semibold text-slate-800 dark:text-slate-200">
                          ${scaledAmount} ${ing.unit} ${ing.name}
                        </span>
                        <span class="text-xs font-bold text-slate-700 dark:text-slate-300 shrink-0">
                          ${this.ahService.formatEuro(price * scale)}
                        </span>
                      </div>
                      <div class="text-[11px] text-slate-400 flex items-center justify-between mt-0.5">
                        <span>${ing.ahName || 'AH artikel'}</span>
                        ${isBonus ? `
                          <span class="inline-flex items-center gap-0.5 text-[10px] font-extrabold text-amber-600 dark:text-amber-400">
                            ★ ${bonusDesc}
                          </span>
                        ` : ''}
                      </div>
                    </label>
                  </li>
                `;
              }).join('')}
            </ul>
          </div>

          <!-- Bereidingswijze (7 kolommen op desktop) -->
          <div class="md:col-span-7 space-y-3">
            <h3 class="font-bold text-base text-slate-800 dark:text-slate-100 flex items-center justify-between">
              <span>👨‍🍳 Bereidingswijze</span>
              <span class="text-xs font-normal text-slate-400">Stap voor stap koken</span>
            </h3>
            <ol class="space-y-2.5">
              ${(recipe.instructions || []).map((step, idx) => `
                <li class="bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-slate-100 dark:border-slate-700/60 shadow-sm flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  <span class="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    ${idx + 1}
                  </span>
                  <span class="flex-1">${step}</span>
                </li>
              `).join('')}
            </ol>
          </div>
        </div>

        <!-- Gemini AI Kookhulp Sectie -->
        <div class="bg-gradient-to-br from-indigo-50/70 via-white to-purple-50/50 dark:from-slate-800/90 dark:via-slate-800 dark:to-indigo-950/40 p-4 sm:p-5 rounded-2xl border border-indigo-100 dark:border-indigo-900/50 shadow-sm">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <span class="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center text-sm shadow-md font-bold">
                ✨
              </span>
              <div>
                <h4 class="font-bold text-slate-900 dark:text-white text-sm sm:text-base">
                  Vraag Gemini Kookassistent
                </h4>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  Stel een vraag over ingrediënten vervangen, bereiding of tips
                </p>
              </div>
            </div>
            ${!this.geminiService.hasApiKey() ? `
              <button 
                type="button" 
                class="open-settings-btn text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/80 px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 transition"
              >
                🔑 API Sleutel instellen
              </button>
            ` : ''}
          </div>

          <!-- Snelkeuze vragen knoppen -->
          <div class="flex flex-wrap gap-1.5 mb-3">
            <button type="button" class="gemini-quick-btn text-xs bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 border border-slate-200 dark:border-slate-600 px-3 py-1.5 rounded-lg transition" data-prompt="Hoe kan ik dit gerecht nóg eiwitrijker maken zonder veel extra calorieën?">
              🥩 Nóg eiwitrijker maken
            </button>
            <button type="button" class="gemini-quick-btn text-xs bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 border border-slate-200 dark:border-slate-600 px-3 py-1.5 rounded-lg transition" data-prompt="Wat kan ik vervangen als ik bepaalde ingrediënten niet lust of in huis heb?">
              🔄 Ingrediënten vervangen
            </button>
            <button type="button" class="gemini-quick-btn text-xs bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 border border-slate-200 dark:border-slate-600 px-3 py-1.5 rounded-lg transition" data-prompt="Welke wijn, bier of alcoholvrije drank past perfect bij de smaken van dit gerecht?">
              🍷 Wijn- & drankparing
            </button>
            <button type="button" class="gemini-quick-btn text-xs bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 border border-slate-200 dark:border-slate-600 px-3 py-1.5 rounded-lg transition" data-prompt="Hoe kan ik dit recept het makkelijkst omtoveren tot een 100% vegetarische of plantaardige variant?">
              🥦 Vegetarische variant
            </button>
          </div>

          <!-- Chat antwoord venster -->
          <div id="gemini-response-area" class="hidden mb-3 p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-indigo-100 dark:border-indigo-950 text-sm text-slate-800 dark:text-slate-200 leading-relaxed max-h-60 overflow-y-auto whitespace-pre-line shadow-inner"></div>

          <!-- Chat invoer veld -->
          <form id="gemini-ask-form" class="flex gap-2">
            <input 
              type="text" 
              id="gemini-question-input" 
              placeholder="${this.geminiService.hasApiKey() ? 'Stel een vraag over dit gerecht aan Gemini...' : 'Vul eerst je Gemini API key in om vragen te stellen...'}" 
              class="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              ${!this.geminiService.hasApiKey() ? 'disabled' : ''}
            />
            <button 
              type="submit" 
              id="gemini-submit-btn" 
              class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition flex items-center gap-1.5 shadow-sm"
              ${!this.geminiService.hasApiKey() ? 'disabled' : ''}
            >
              <span>Vraag</span>
              <span id="gemini-spinner" class="hidden animate-spin">⏳</span>
            </button>
          </form>
        </div>
      </div>
    `;
  }
}
