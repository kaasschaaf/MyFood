import { AHService, ONLINE_ONLY_SETTING_KEY } from './ah-service.js';
import { GeminiService } from './gemini-service.js';
import { RecipesService } from './recipes-service.js';
import { UIComponents } from './ui-components.js';
import { ContentTranslator } from './content-translator.js';
import { canonicalCuisine, cuisineLabel, getLang, getLocale, initLanguage, t } from './i18n.js';

// Alleen de meest voorkomende keukens als pil tonen; de rest blijft vindbaar
// via de zoekbalk, want tientallen pillen maken de filterrij onbruikbaar.
const MIN_RECIPES_PER_CUISINE_PILL = 3;
// Vasthouden op een AH-productrij kiest dat product. Korter = tik (opent AH),
// langer = onbedoeld wachten.
const HOLD_TO_CHOOSE_MS = 450;
const HOLD_MOVE_TOLERANCE_PX = 12;
// Hoe lang na het loslaten de klik wordt tegengehouden (die zou AH openen).
const SUPPRESS_CLICK_MS = 900;
const MAX_CUISINE_PILLS = 10;

class KostApp {
  constructor() {
    this.ahService = new AHService();
    this.geminiService = new GeminiService();
    this.recipesService = new RecipesService(this.ahService);
    this.translator = new ContentTranslator(this.geminiService);
    // AH zoekt alleen op Nederlandse namen; TheMealDB levert Engels.
    this.recipesService.setIngredientTranslator(name => this.translator.ingredientToDutch(name));
    this.ui = new UIComponents(this.ahService, this.geminiService, this.recipesService, this.translator);
    
    this.activeRecipeId = null;
    this.activeIngredientIndex = null;
    this.modalServings = 2;
    this.visibleRecipeCount = 30;
    this.hydrationPromise = null;
    this.renderTimer = null;
    this.holdTimer = null;
    this.holdTarget = null;
    this.holdStart = null;
    this.suppressProductClickUntil = 0;
  }

  async init() {
    this.initLanguage();

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
    this.translateVisibleRecipes();
    this.hydrateVisibleRecipes();

    // Recipes were rendered in Dutch first; cached translations or a fresh
    // Gemini pass repaint the grid as English when that language is active.
  }

  initCuisineFilters() {
    const cuisineContainer = document.getElementById('cuisine-pills');
    if (!cuisineContainer) return;

    // TheMealDB levert tientallen keukens met één of twee recepten. Die als pil
    // tonen maakt de filterrij onbruikbaar, dus alleen wat genoeg keuze biedt.
    const counts = new Map();
    this.recipesService.recipes.forEach(recipe => {
      // Allerhande-regels zijn alleen links; die mogen de pilvolgorde niet bepalen.
      if (recipe.ahRecipeOnly) return;
      const key = canonicalCuisine(recipe.cuisine);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    const cuisines = this.recipesService
      .getAvailableCuisines()
      .filter(cuisine => (counts.get(cuisine) || 0) >= MIN_RECIPES_PER_CUISINE_PILL)
      .sort((a, b) => (counts.get(b) - counts.get(a)) || a.localeCompare(b, 'nl'))
      .slice(0, MAX_CUISINE_PILLS);

    let pillsHtml = `
      <button type="button" class="cuisine-pill is-active" data-cuisine="all" aria-pressed="true">
        ${this.ui.escapeHtml(t('catalog.allCuisines'))}
      </button>
    `;

    cuisines.forEach(c => {
      pillsHtml += `
        <button type="button" class="cuisine-pill" data-cuisine="${this.ui.escapeHtml(c)}" aria-pressed="false">
          ${this.ui.escapeHtml(cuisineLabel(c))}
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
        const label = t('portions.people', { count: this.recipesService.getServings() });
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
      this.syncPortionLabels = syncPortionLabels;
      syncPortionLabels();
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

      this.bindHoldToChoose(recipeModal);

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
    if (status) status.textContent = t('products.settingsFailed', { message: error.message });
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
          <p class="text-sm text-slate-600 dark:text-neutral-300">${this.ui.escapeHtml(t('recipe.loading'))}</p>
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
        modal.innerHTML = `<div class="flex h-full items-center justify-center p-8 text-center"><p class="text-sm text-rose-600 dark:text-rose-400">${this.ui.escapeHtml(t('recipe.loadFailed', { message: error.message }))}</p></div>`;
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
    if (!modal || !recipe) return;
    // De ingrediëntpagina opnieuw tekenen mag de lezer niet naar boven sturen.
    const previousScroll = modal.querySelector('[data-panel="ingredient"]')?.scrollTop || 0;
    modal.innerHTML = this.ui.renderRecipeModal(recipe, this.modalServings, {
      ingredientIndex: this.activeIngredientIndex
    });
    const ingredientPage = modal.querySelector('[data-panel="ingredient"]');
    if (ingredientPage && previousScroll) ingredientPage.scrollTop = previousScroll;
  }

  /**
   * Vasthouden op een AH-productrij kiest dat product als het ingrediënt.
   * Een korte tik opent de AH-pagina, vasthouden en loslaten kiest. Op een
   * toetsenbord doet de spatiebalk hetzelfde en rechtermuisknop op de desktop.
   * @param {HTMLElement} recipeModal
   */
  bindHoldToChoose(recipeModal) {
    const optionFrom = event => event.target.closest?.('[data-product-option]');
    let press = null;
    let armTimer = null;

    const clearPress = () => {
      if (armTimer) clearTimeout(armTimer);
      armTimer = null;
      if (press?.element) {
        press.element.classList.remove('is-holding', 'is-armed');
      }
      press = null;
    };

    const startPress = event => {
      const element = optionFrom(event);
      // Alleen de primaire aanwijzer: vinger, pen of linkermuisknop.
      if (!element || (event.pointerType === 'mouse' && event.button !== 0)) return;
      clearPress();
      press = { id: element.dataset.productOption, element, x: event.clientX, y: event.clientY, at: Date.now() };
      element.classList.add('is-holding');
      // Visuele hint zodra vasthouden lang genoeg duurt; loslaten maakt de keuze.
      armTimer = setTimeout(() => {
        armTimer = null;
        if (!press) return;
        press.element.classList.add('is-armed');
      }, HOLD_TO_CHOOSE_MS);
    };

    const movePress = event => {
      if (!press) return;
      // Scrollen of vegen mag nooit per ongeluk een product kiezen.
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > HOLD_MOVE_TOLERANCE_PX) {
        clearPress();
      }
    };

    const endPress = event => {
      if (!press) return;
      const { id, at, element } = press;
      const heldLongEnough = Date.now() - at >= HOLD_TO_CHOOSE_MS;
      const stillOnSameRow = optionFrom(event)?.dataset.productOption === id;
      clearPress();
      if (!heldLongEnough || !stillOnSameRow) return;
      // De klik die op dit loslaten volgt zou AH openen; die slikken we in.
      // Een tijdstempel in plaats van een timer: die is immuun voor het
      // vertragen van timers op de achtergrond.
      this.suppressProductClickUntil = Date.now() + SUPPRESS_CLICK_MS;
      element.classList.remove('is-holding', 'is-armed');
      this.chooseProduct(id);
    };

    recipeModal.addEventListener('pointerdown', startPress);
    recipeModal.addEventListener('pointermove', movePress);
    recipeModal.addEventListener('pointerup', endPress);
    recipeModal.addEventListener('pointercancel', clearPress);
    recipeModal.addEventListener('pointerleave', clearPress);

    // Rechtermuisknop is de desktopvariant van vasthouden.
    recipeModal.addEventListener('contextmenu', event => {
      const option = optionFrom(event);
      if (!option) return;
      event.preventDefault();
      // Android toont dit menu bij vasthouden; de keuze is dan al gemaakt.
      clearPress();
      this.chooseProduct(option.dataset.productOption);
    });

    // Spatie kiest; Enter opent nog steeds de AH-link.
    recipeModal.addEventListener('keydown', event => {
      const option = optionFrom(event);
      if (!option || (event.key !== ' ' && event.key !== 'Spacebar')) return;
      event.preventDefault();
      this.chooseProduct(option.dataset.productOption);
    });

    recipeModal.addEventListener('click', event => {
      if (!optionFrom(event)) return;
      if (!this.suppressProductClickUntil || Date.now() > this.suppressProductClickUntil) return;
      event.preventDefault();
      event.stopPropagation();
      this.suppressProductClickUntil = 0;
    }, true);
  }

  /**
   * Kiest een AH-product voor het ingrediënt dat nu openstaat.
   * @param {string} productId
   */
  async chooseProduct(productId) {
    const recipe = this.recipesService.getRecipeById(this.activeRecipeId);
    const index = this.activeIngredientIndex;
    if (!recipe || !Number.isInteger(index) || !productId) return;
    const product = (recipe.ingredients?.[index]?.ahProductOptions || [])
      .find(option => option.id === productId);
    try {
      await this.recipesService.selectProductMatch(this.activeRecipeId, index, productId);
      if (globalThis.navigator?.vibrate) globalThis.navigator.vibrate(12);
      this.refreshModalContent();
      this.render();
      this.announceProductChoice(product?.title);
    } catch (error) {
      console.error('AH-productkeuze opslaan mislukt.', error);
      this.announceProductChoice(null, error.message);
    }
  }

  /**
   * Bevestigt de keuze in de live-regio van de ingrediëntweergave.
   * @param {string} [title]
   * @param {string} [errorMessage]
   */
  announceProductChoice(title, errorMessage) {
    const status = document.querySelector('#recipe-modal [data-selection-status]');
    if (!status) return;
    status.classList.remove('hidden', 'bg-emerald-50', 'text-emerald-800', 'dark:bg-emerald-950/30', 'dark:text-emerald-300');
    if (errorMessage) {
      status.classList.add('bg-rose-50', 'text-rose-700', 'dark:bg-rose-950/30', 'dark:text-rose-300');
      status.textContent = errorMessage;
      return;
    }
    status.textContent = t('recipe.options.holdChosen', { title: title || '' });
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
        ${this.ui.escapeHtml(t('ai.thinking', { question }))}
      </span>
    `;
    if (spinner) spinner.classList.remove('hidden');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const answer = await this.geminiService.askAboutRecipe(recipe, question, this.modalServings);
      responseArea.innerHTML = `
        <div class="font-bold text-xs uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1">
          ${this.ui.escapeHtml(t('ai.answer'))}
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

  initLanguage() {
    initLanguage({ onChange: () => this.onLanguageChanged() });
    this.initBuildTimeBadge();
  }

  /**
   * Re-renders the interface and translates recipe content after a switch.
   */
  async onLanguageChanged() {
    this.initCuisineFilters();
    this.syncPortionLabels?.();
    this.render();
    if (this.activeRecipeId) {
      // Vertalen mag mislukken (geen Gemini-sleutel); het venster moet hoe dan
      // ook in de nieuwe taal opnieuw worden getekend.
      try {
        await this.translateActiveRecipe();
      } catch (error) {
        console.warn('Recept kon niet worden vertaald.', error);
      }
      this.refreshModalContent();
      this.render();
    }
    this.translateVisibleRecipes();
  }

  /**
   * Shows or hides the notice explaining that recipe text stays Dutch when
   * neither the browser's built-in translation nor Gemini is available.
   */
  async syncTranslationNotice() {
    const notice = document.getElementById('translation-notice');
    const text = document.getElementById('translation-notice-text');
    if (!notice || !text) return;
    const available = await this.translator.isTranslationAvailable();
    const show = getLang() === 'en' && !available;
    text.textContent = show ? t('recipe.translateNeedsKey') : '';
    notice.classList.toggle('hidden', !show);
    notice.classList.toggle('flex', show);
  }

  /**
   * Translates the recipes currently on screen, then repaints the grid.
   */
  async translateVisibleRecipes() {
    await this.syncTranslationNotice();
    if (getLang() !== 'en') return;
    if (!(await this.translator.isTranslationAvailable())) return;
    const visible = this.recipesService.getFilteredRecipes().slice(0, this.visibleRecipeCount);
    await this.translator.applyCachedSummaries(visible);
    this.render();
    const translated = await this.translator.translateSummaries(visible);
    if (translated > 0) this.render();
  }

  /**
   * Translates the open recipe's full content.
   */
  async translateActiveRecipe() {
    const recipe = this.recipesService.getRecipeById(this.activeRecipeId);
    if (!recipe) return;
    if (getLang() !== 'en') return;
    if (await this.translator.isTranslationAvailable()) {
      await this.translator.translateRecipe(recipe);
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

    const formatted = new Intl.DateTimeFormat(getLocale(), {
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
      // Allerhande-regels zijn links, geen volledige recepten; dat verschil mag
      // de teller niet verbergen.
      const linkCount = filtered.filter(recipe => recipe.ahRecipeOnly).length;
      countEl.textContent = linkCount
        ? t('catalog.resultsWithLinks', { count: filtered.length - linkCount, links: linkCount })
        : t('catalog.results', { count: filtered.length });
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
          <h3 class="font-display mt-4 text-lg font-semibold text-slate-800 dark:text-neutral-100">${this.ui.escapeHtml(t('catalog.emptyTitle'))}</h3>
          <p class="mt-1 max-w-sm text-sm text-slate-500 dark:text-neutral-400">${this.ui.escapeHtml(t('catalog.emptyBody'))}</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = visibleRecipes.map(r => this.ui.renderRecipeCard(r, servings)).join('');
    // Nieuwe kaarten (filter, sortering of "meer laden") meteen verrijken.
    // De aanroep is idempotent zolang er nog een ronde loopt.
    this.hydrateVisibleRecipes();
    if (filtered.length > visibleRecipes.length) {
      grid.insertAdjacentHTML('beforeend', `
        <div class="col-span-full py-4 text-center">
          <button id="load-more-recipes" type="button"
            class="inline-flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-800 dark:border-white/10 dark:bg-white/5 dark:text-neutral-200 dark:hover:border-emerald-500/30 dark:hover:text-emerald-300">
            ${this.ui.escapeHtml(t('catalog.loadMore'))}
            <span class="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-white/10 dark:text-neutral-400">${filtered.length - visibleRecipes.length}</span>
          </button>
        </div>
      `);
    }
  }

  /**
   * Vult de kaarten die nu zichtbaar zijn met echte receptgegevens: eerst
   * ingrediënten en stappen, daarna de live AH-prijzen. Zo draait het dure
   * AH-zoekwerk alleen voor wat de bezoeker echt ziet, in plaats van voor de
   * hele catalogus.
   */
  async hydrateVisibleRecipes() {
    if (this.hydrationPromise) return this.hydrationPromise;
    const status = document.getElementById('catalog-status');
    const visibleRecipes = this.recipesService
      .getFilteredRecipes()
      .slice(0, this.visibleRecipeCount);
    const pending = visibleRecipes.filter(recipe =>
      this.recipesService.isLivePricedRecipe(recipe) &&
      (
        this.recipesService.needsDetails(recipe) ||
        (recipe.ingredients?.length && !recipe.priceUpdatedAt && !recipe.priceAttempted)
      )
    );
    if (pending.length === 0) {
      if (status) status.textContent = t('catalog.status.done', { total: visibleRecipes.length });
      return null;
    }

    if (status) status.textContent = t('catalog.status.checking', { count: pending.length });
    let failedRecipes = 0;
    this.hydrationPromise = this.recipesService.hydrateRecipes(pending, ({ phase, completed, total, recipe }) => {
      if (recipe.priceError || recipe.detailError) failedRecipes++;
      if (status) {
        const progress = phase === 'details'
          ? t('catalog.status.details', { done: completed, total })
          : t('catalog.status.progress', { done: completed, total });
        status.textContent = progress + (failedRecipes ? t('catalog.status.withErrors', { count: failedRecipes }) : '');
      }
      // Een volle hertekening per recept laat de foto's knipperen; daarom
      // bundelen we de tussenstanden en tekenen we aan het eind definitief.
      this.scheduleRender();
      if (recipe.id === this.activeRecipeId) this.refreshModalContent();
    }).then(() => {
      if (status) {
        status.textContent = t('catalog.status.done', { total: pending.length }) +
          (failedRecipes ? t('catalog.status.withErrors', { count: failedRecipes }) : '');
      }
    }).catch(error => {
      console.error('Receptgegevens konden niet worden bijgewerkt.', error);
      if (status) status.textContent = t('catalog.status.failed', { message: error.message });
    }).finally(() => {
      this.hydrationPromise = null;
      this.render();
    });
    return this.hydrationPromise;
  }

  /**
   * Bundelt hertekeningen die door dezelfde achtergrondronde worden veroorzaakt.
   */
  scheduleRender() {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, 400);
  }
}

// Start app wanneer DOM klaar is
document.addEventListener('DOMContentLoaded', () => {
  const app = new KostApp();
  app.init().catch(error => {
    console.error('Kost kon niet worden gestart.', error);
    const status = document.getElementById('catalog-status');
    if (status) status.textContent = t('catalog.status.failed', { message: error.message });
  });
});
