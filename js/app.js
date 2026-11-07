import { AHService, ONLINE_ONLY_SETTING_KEY } from './ah-service.js';
import { GeminiService } from './gemini-service.js';
import { RecipesService } from './recipes-service.js';
import { UIComponents } from './ui-components.js';

class MyFoodApp {
  constructor() {
    this.ahService = new AHService();
    this.geminiService = new GeminiService();
    this.recipesService = new RecipesService(this.ahService);
    this.ui = new UIComponents(this.ahService, this.geminiService, this.recipesService);
    
    this.activeRecipeId = null;
    this.activeIngredientIndex = null;
    this.modalServings = 2;
    this.visibleRecipeCount = 30;
  }

  async init() {
    // 1. Laad recepten (AH-prijzen worden live opgehaald)
    await this.recipesService.loadRecipes(() => {
      this.initCuisineFilters();
      this.render();
    });

    // 2. Initialiseer UI elementen & filters
    this.initCuisineFilters();
    this.bindEvents();
    this.initTheme();
    this.initBuildTimeBadge();
    this.render();
    this.refreshExternalPrices();
  }

  initCuisineFilters() {
    const cuisineContainer = document.getElementById('cuisine-pills');
    if (!cuisineContainer) return;

    const cuisines = this.recipesService.getAvailableCuisines();
    let pillsHtml = `
      <button type="button" class="cuisine-pill is-active" data-cuisine="all" aria-pressed="true">
        Alle stijlen
      </button>
    `;

    cuisines.forEach(c => {
      pillsHtml += `
        <button type="button" class="cuisine-pill" data-cuisine="${this.ui.escapeHtml(c)}" aria-pressed="false">
          ${this.ui.escapeHtml(c)}
        </button>
      `;
    });

    cuisineContainer.innerHTML = pillsHtml;
  }

  bindEvents() {
    const onlineOnlySetting = document.getElementById('ignore-online-only-products');
    if (onlineOnlySetting) {
      onlineOnlySetting.checked = this.ahService.getIgnoreOnlineOnlyProducts();
      onlineOnlySetting.addEventListener('change', () => {
        try {
          this.ahService.setIgnoreOnlineOnlyProducts(onlineOnlySetting.checked);
        } catch (error) {
          onlineOnlySetting.checked = this.ahService.getIgnoreOnlineOnlyProducts();
          this.showOnlineOnlySettingError(error);
        }
      });
    }
    const refreshOnlineOnlyMatches = event => {
      if (onlineOnlySetting && typeof event.detail?.enabled === 'boolean') {
        onlineOnlySetting.checked = event.detail.enabled;
      }
      this.recipesService.refreshAHMatchesForLoadedRecipes()
        .then(() => {
          this.render();
          if (this.activeRecipeId) this.refreshModalContent();
        })
        .catch(error => this.showOnlineOnlySettingError(error));
    };
    window.addEventListener('myfood:online-only-setting-changed', refreshOnlineOnlyMatches);
    window.addEventListener('storage', event => {
      if (event.key !== ONLINE_ONLY_SETTING_KEY) return;
      if (onlineOnlySetting) onlineOnlySetting.checked = this.ahService.getIgnoreOnlineOnlyProducts();
      refreshOnlineOnlyMatches(event);
    });

    // Zoekbalk met lichte debounce
    const searchInput = document.getElementById('search-input');
    let debounceTimer;
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.recipesService.setFilters({ searchQuery: e.target.value });
          this.render();
        }, 200);
      });
    }

    // Keukenstijl filters
    const cuisineContainer = document.getElementById('cuisine-pills');
    if (cuisineContainer) {
      cuisineContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.cuisine-pill');
        if (!btn) return;

        cuisineContainer.querySelectorAll('.cuisine-pill').forEach(b => {
          b.classList.remove('is-active');
          b.setAttribute('aria-pressed', 'false');
        });

        btn.classList.add('is-active');
        btn.setAttribute('aria-pressed', 'true');

        this.recipesService.setFilters({ cuisine: btn.dataset.cuisine });
        this.render();
      });
    }

    // Snelkeuze toggles
    const bonusToggle = document.getElementById('filter-bonus');
    if (bonusToggle) {
      bonusToggle.addEventListener('click', () => {
        const isActive = bonusToggle.classList.toggle('is-active');
        bonusToggle.setAttribute('aria-pressed', String(isActive));
        this.recipesService.setFilters({ bonusOnly: isActive });
        this.render();
      });
    }

    const proteinToggle = document.getElementById('filter-protein');
    if (proteinToggle) {
      proteinToggle.addEventListener('click', () => {
        const isActive = proteinToggle.classList.toggle('is-active');
        proteinToggle.setAttribute('aria-pressed', String(isActive));
        this.recipesService.setFilters({ highProteinOnly: isActive });
        this.render();
      });
    }

    const quickTimeToggle = document.getElementById('filter-quick');
    if (quickTimeToggle) {
      quickTimeToggle.addEventListener('click', () => {
        const isActive = quickTimeToggle.classList.toggle('is-active');
        quickTimeToggle.setAttribute('aria-pressed', String(isActive));
        this.recipesService.setFilters({ maxTime: isActive ? 25 : 0 });
        this.render();
      });
    }

    // Sortering
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this.recipesService.setFilters({ sortBy: e.target.value });
        this.render();
      });
    }

    // Portie Schakelaar in de Hoofdbalk (Standaard 2 personen)
    const mainPortionMinus = document.getElementById('main-portion-minus');
    const mainPortionPlus = document.getElementById('main-portion-plus');
    const mainPortionCount = document.getElementById('main-portion-count');

    if (mainPortionMinus && mainPortionPlus && mainPortionCount) {
      const syncPortionLabels = () => {
        const label = `${this.recipesService.getServings()} pers.`;
        mainPortionCount.textContent = label;
        const mobileLabel = document.getElementById('mobile-portion-label');
        if (mobileLabel) mobileLabel.textContent = label;
      };

      mainPortionMinus.addEventListener('click', () => {
        const current = this.recipesService.getServings();
        if (current > 1) {
          this.recipesService.setServings(current - 1);
          syncPortionLabels();
          this.render();
        }
      });

      mainPortionPlus.addEventListener('click', () => {
        const current = this.recipesService.getServings();
        if (current < 8) {
          this.recipesService.setServings(current + 1);
          syncPortionLabels();
          this.render();
        }
      });

      const adjustServings = delta => {
        const next = this.recipesService.getServings() + delta;
        if (next < 1 || next > 8) return;
        this.recipesService.setServings(next);
        syncPortionLabels();
        this.render();
      };
      document.getElementById('mobile-portion-minus')?.addEventListener('click', () => adjustServings(-1));
      document.getElementById('mobile-portion-plus')?.addEventListener('click', () => adjustServings(1));
    }

    // Recept Klik (Kaart openen)
    const recipeGrid = document.getElementById('recipes-grid');
    if (recipeGrid) {
      recipeGrid.addEventListener('click', (e) => {
        if (e.target.closest('#load-more-recipes')) {
          this.visibleRecipeCount += 30;
          this.render();
          return;
        }
        if (e.target.closest('a')) return;
        const card = e.target.closest('[data-recipe-id]');
        if (card) {
          this.openRecipeModal(card.dataset.recipeId);
        }
      });
    }

    // Modale dialoogvenster events (sluiten, porties, Gemini)
    const recipeModal = document.getElementById('recipe-modal');
    if (recipeModal) {
      recipeModal.addEventListener('click', (e) => {
        // Klik op de achtergrond van het dialoogvenster
        if (e.target === recipeModal || e.target.closest('#close-modal-btn, [data-close-modal]')) {
          this.closeRecipeModal();
        }

        // Porties in modal
        if (e.target.closest('#modal-portion-minus')) {
          if (this.modalServings > 1) {
            this.modalServings--;
            this.refreshModalContent();
          }
        }
        if (e.target.closest('#modal-portion-plus')) {
          if (this.modalServings < 8) {
            this.modalServings++;
            this.refreshModalContent();
          }
        }

        // Ingrediënt-opties: het hele venster schuift naar een nieuwe pagina
        const ingredientButton = e.target.closest('[data-ingredient-open]');
        if (ingredientButton) {
          this.showIngredientOptions(Number(ingredientButton.dataset.ingredientOpen));
        }
        if (e.target.closest('[data-ingredient-back]')) {
          this.hideIngredientOptions();
        }

        // Gemini Quick knoppen
        const quickBtn = e.target.closest('.gemini-quick-btn');
        if (quickBtn) {
          const prompt = quickBtn.dataset.prompt;
          this.askGemini(prompt);
        }

        // Open settings vanuit modal
        if (e.target.closest('.open-settings-btn')) {
          this.openSettingsModal();
        }
      });

      recipeModal.addEventListener('change', async (e) => {
        const select = e.target.closest('.ah-product-select');
        if (!select) return;
        try {
          await this.recipesService.selectProductMatch(
            this.activeRecipeId,
            Number(select.dataset.ingredientIndex),
            select.value
          );
          this.refreshModalContent();
          this.render();
        } catch (error) {
          console.error('AH-productkeuze opslaan mislukt.', error);
          const status = recipeModal.querySelector('#product-match-status');
          if (status) status.textContent = `Productkeuze opslaan mislukt: ${error.message}`;
        }
      });

      // Gemini vraag formulier
      recipeModal.addEventListener('submit', (e) => {
        if (e.target.id === 'gemini-ask-form') {
          e.preventDefault();
          const input = document.getElementById('gemini-question-input');
          if (input && input.value.trim()) {
            this.askGemini(input.value.trim());
            input.value = '';
          }
        }
      });

      // Escape gaat eerst terug naar de ingrediëntenlijst
      recipeModal.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || this.activeIngredientIndex === null) return;
        e.preventDefault();
        e.stopPropagation();
        this.hideIngredientOptions();
      });
      recipeModal.addEventListener('cancel', (e) => {
        if (this.activeIngredientIndex === null) return;
        e.preventDefault();
        this.hideIngredientOptions();
      });
    }

    // Settings Modal
    const settingsModal = document.getElementById('settings-modal');
    const openSettingsNav = document.getElementById('nav-settings-btn');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    const apiKeyInput = document.getElementById('api-key-input');

    if (openSettingsNav) {
      openSettingsNav.addEventListener('click', () => this.openSettingsModal());
    }

    if (closeSettingsBtn && settingsModal) {
      closeSettingsBtn.addEventListener('click', () => settingsModal.close());
      settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) settingsModal.close();
      });
    }

    if (saveSettingsBtn && apiKeyInput && settingsModal) {
      saveSettingsBtn.addEventListener('click', () => {
        this.geminiService.setApiKey(apiKeyInput.value);
        settingsModal.close();
        if (this.activeRecipeId) {
          this.refreshModalContent();
        }
      });
    }
  }

  showOnlineOnlySettingError(error) {
    console.error('AH-matches voor de online-only instelling konden niet worden bijgewerkt.', error);
    const status = document.getElementById('catalog-status');
    if (status) status.textContent = `Productinstelling opslaan of toepassen is mislukt: ${error.message}`;
  }

  async openRecipeModal(recipeId) {
    const recipe = this.recipesService.getRecipeById(recipeId);
    if (recipe?.ahRecipeOnly) {
      window.open(recipe.sourceUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    this.activeRecipeId = recipeId;
    this.activeIngredientIndex = null;
    this.modalServings = this.recipesService.getServings();
    const modal = document.getElementById('recipe-modal');
    if (modal) {
      modal.innerHTML = `
        <div class="flex h-full flex-col items-center justify-center gap-3 px-8 py-16 text-center">
          <span class="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-600 dark:border-neutral-700 dark:border-t-emerald-400" aria-hidden="true"></span>
          <p class="text-sm text-slate-600 dark:text-neutral-300">Receptdetails en AH-producten laden…</p>
        </div>
      `;
      modal.showModal();
    }
    try {
      await this.recipesService.getRecipeDetails(recipeId);
      if (this.activeRecipeId === recipeId) {
        this.refreshModalContent();
        this.render();
      }
    } catch (error) {
      console.error('Receptdetails laden mislukt.', error);
      if (modal && this.activeRecipeId === recipeId) {
        modal.innerHTML = `<div class="flex h-full items-center justify-center p-8 text-center"><p class="text-sm text-rose-600 dark:text-rose-400">Receptdetails konden niet worden geladen: ${this.ui.escapeHtml(error.message)}</p></div>`;
      }
    }
  }

  closeRecipeModal() {
    const modal = document.getElementById('recipe-modal');
    if (modal) {
      modal.close();
    }
    this.activeRecipeId = null;
    this.activeIngredientIndex = null;
  }

  refreshModalContent() {
    const modal = document.getElementById('recipe-modal');
    const recipe = this.recipesService.getRecipeById(this.activeRecipeId);
    if (modal && recipe) {
      modal.innerHTML = this.ui.renderRecipeModal(recipe, this.modalServings, {
        ingredientIndex: this.activeIngredientIndex
      });
    }
  }

  /**
   * Laat het hele venster naar de AH-opties van één ingrediënt schuiven.
   * @param {number} index
   */
  showIngredientOptions(index) {
    const recipe = this.recipesService.getRecipeById(this.activeRecipeId);
    const viewport = document.getElementById('recipe-viewport');
    const ingredientPage = viewport?.querySelector('[data-panel="ingredient"]');
    const recipePage = viewport?.querySelector('[data-panel="recipe"]');
    if (!recipe || !viewport || !ingredientPage || !recipePage || !Number.isInteger(index)) return;
    if (!(recipe.ingredients || [])[index]) return;

    ingredientPage.innerHTML = this.ui.renderIngredientPage(recipe, index, this.modalServings);
    this.activeIngredientIndex = index;
    viewport.dataset.activePanel = 'ingredient';
    ingredientPage.removeAttribute('aria-hidden');
    ingredientPage.inert = false;
    recipePage.setAttribute('aria-hidden', 'true');
    recipePage.inert = true;
    ingredientPage.scrollTop = 0;
    ingredientPage.querySelector('[data-ingredient-back]')?.focus({ preventScroll: true });
  }

  /**
   * Schuift het venster terug naar het volledige recept.
   */
  hideIngredientOptions() {
    const viewport = document.getElementById('recipe-viewport');
    const ingredientPage = viewport?.querySelector('[data-panel="ingredient"]');
    const recipePage = viewport?.querySelector('[data-panel="recipe"]');
    const previousIndex = this.activeIngredientIndex;
    if (!viewport || !ingredientPage || !recipePage) return;

    viewport.dataset.activePanel = 'recipe';
    recipePage.removeAttribute('aria-hidden');
    recipePage.inert = false;
    ingredientPage.setAttribute('aria-hidden', 'true');
    ingredientPage.inert = true;
    this.activeIngredientIndex = null;
    recipePage.querySelector(`[data-ingredient-open="${previousIndex}"]`)?.focus({ preventScroll: true });
  }

  async askGemini(question) {
    const recipe = this.recipesService.getRecipeById(this.activeRecipeId);
    if (!recipe) return;

    const responseArea = document.getElementById('gemini-response-area');
    const spinner = document.getElementById('gemini-spinner');
    const submitBtn = document.getElementById('gemini-submit-btn');

    if (!responseArea) return;

    responseArea.classList.remove('hidden');
    responseArea.innerHTML = `
      <span class="inline-flex items-center gap-2 font-medium text-indigo-700 dark:text-indigo-300">
        <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600 dark:border-indigo-900 dark:border-t-indigo-400" aria-hidden="true"></span>
        Chef Gemini denkt na over: “${this.ui.escapeHtml(question)}”…
      </span>
    `;
    if (spinner) spinner.classList.remove('hidden');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const answer = await this.geminiService.askAboutRecipe(recipe, question, this.modalServings);
      responseArea.innerHTML = `
        <div class="font-bold text-xs uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1">
          Antwoord van Chef Gemini:
        </div>
        <div class="text-slate-800 dark:text-neutral-100 whitespace-pre-line">${this.ui.escapeHtml(answer)}</div>
      `;
    } catch (err) {
      responseArea.innerHTML = `
        <div class="text-rose-600 dark:text-rose-400 text-xs font-semibold">
          ${this.ui.escapeHtml(err.message)}
        </div>
      `;
    } finally {
      if (spinner) spinner.classList.add('hidden');
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  openSettingsModal() {
    const settingsModal = document.getElementById('settings-modal');
    const apiKeyInput = document.getElementById('api-key-input');
    if (settingsModal && apiKeyInput) {
      apiKeyInput.value = this.geminiService.getApiKey();
      settingsModal.showModal();
    }
  }

  readStoredTheme() {
    try {
      return localStorage.getItem('myfood_theme');
    } catch (error) {
      console.warn('Opgeslagen thema kon niet worden gelezen.', error);
      return null;
    }
  }

  storeTheme(theme) {
    try {
      localStorage.setItem('myfood_theme', theme);
    } catch (error) {
      console.warn('Thema kon niet worden opgeslagen.', error);
    }
  }

  initTheme() {
    const themeBtn = document.getElementById('theme-toggle');
    const storedTheme = this.readStoredTheme();
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const isDark = storedTheme === 'dark' || (!storedTheme && prefersDark);

    document.documentElement.classList.toggle('dark', isDark);

    if (themeBtn) {
      const syncThemeLabel = () => {
        const label = document.documentElement.classList.contains('dark')
          ? 'Schakel naar licht thema'
          : 'Schakel naar donker thema';
        themeBtn.setAttribute('aria-label', label);
        themeBtn.setAttribute('title', label);
      };
      syncThemeLabel();
      themeBtn.addEventListener('click', () => {
        const currentlyDark = document.documentElement.classList.toggle('dark');
        this.storeTheme(currentlyDark ? 'dark' : 'light');
        syncThemeLabel();
      });
    }
  }

  initBuildTimeBadge() {
    const badge = document.getElementById('build-time-badge');
    const label = document.getElementById('build-time-label');
    if (!badge || !label) return;

    const buildTime = String(globalThis.MYFOOD_BUILD_TIME || '').trim();
    if (!buildTime) return;

    const date = new Date(buildTime);
    if (Number.isNaN(date.getTime())) return;

    const formatted = new Intl.DateTimeFormat('nl-NL', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);

    label.textContent = formatted;
    badge.title = `Deze versie is gebouwd en gepubliceerd op ${formatted}`;
    badge.hidden = false;
  }

  render() {
    const grid = document.getElementById('recipes-grid');
    const countEl = document.getElementById('results-count');
    if (!grid) return;

    const filtered = this.recipesService.getFilteredRecipes();
    const servings = this.recipesService.getServings();
    const visibleRecipes = filtered.slice(0, this.visibleRecipeCount);

    if (countEl) {
      countEl.textContent = `${filtered.length} recepten gevonden`;
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-16 text-center dark:border-white/15 dark:bg-white/5">
          <span class="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400 dark:bg-white/10 dark:text-neutral-500">
            <svg aria-hidden="true" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7"/>
              <path d="m20 20-3.5-3.5"/>
            </svg>
          </span>
          <h3 class="font-display mt-4 text-lg font-semibold text-slate-800 dark:text-neutral-100">Geen recepten gevonden</h3>
          <p class="mt-1 max-w-sm text-sm text-slate-500 dark:text-neutral-400">Probeer een ander trefwoord of wis je actieve filters.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = visibleRecipes.map(r => this.ui.renderRecipeCard(r, servings)).join('');
    if (filtered.length > visibleRecipes.length) {
      grid.insertAdjacentHTML('beforeend', `
        <div class="col-span-full py-4 text-center">
          <button id="load-more-recipes" type="button"
            class="inline-flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-800 dark:border-white/10 dark:bg-white/5 dark:text-neutral-200 dark:hover:border-emerald-500/30 dark:hover:text-emerald-300">
            Laad meer recepten
            <span class="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-white/10 dark:text-neutral-400">${filtered.length - visibleRecipes.length}</span>
          </button>
        </div>
      `);
    }
  }

  async refreshExternalPrices() {
    const status = document.getElementById('catalog-status');
    const recipeCount = this.recipesService.recipes.filter(recipe => this.recipesService.isLivePricedRecipe(recipe)).length;
    if (recipeCount === 0) {
      if (status) status.textContent = 'Geen recepten om AH-prijzen voor op te halen.';
      return;
    }
    if (status) {
      status.textContent = `Live AH-productprijzen controleren voor ${recipeCount} recepten...`;
    }
    let failedRecipes = 0;
    try {
      await this.recipesService.refreshPrices(({ completed, total, recipe }) => {
        if (recipe.priceError) failedRecipes++;
        if (status) {
          status.textContent = completed < total
            ? `AH-prijzen gecontroleerd: ${completed}/${total}${failedRecipes ? ` · ${failedRecipes} met zoekfouten` : ''}`
            : `AH-prijzen gecontroleerd voor ${total} recepten${failedRecipes ? ` · ${failedRecipes} met zoekfouten` : ''}`;
        }
        this.render();
        if (recipe.id === this.activeRecipeId) this.refreshModalContent();
      });
    } catch (error) {
      console.error('Externe AH-prijzen konden niet worden bijgewerkt.', error);
      if (status) status.textContent = `AH-prijzen bijwerken is mislukt: ${error.message}`;
    }
  }
}

// Start app wanneer DOM klaar is
document.addEventListener('DOMContentLoaded', () => {
  const app = new MyFoodApp();
  app.init().catch(error => {
    console.error('MyFood kon niet worden gestart.', error);
    const status = document.getElementById('catalog-status');
    if (status) status.textContent = `App starten mislukte: ${error.message}`;
  });
});
