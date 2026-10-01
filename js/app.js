import { AHService } from './ah-service.js';
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
    this.modalServings = 2;
  }

  async init() {
    // 1. Initialiseer AH data & recepten
    await this.ahService.init();
    await this.recipesService.loadRecipes();

    // 2. Initialiseer UI elementen & filters
    this.initCuisineFilters();
    this.bindEvents();
    this.initTheme();
    this.render();
  }

  initCuisineFilters() {
    const cuisineContainer = document.getElementById('cuisine-pills');
    if (!cuisineContainer) return;

    const cuisines = this.recipesService.getAvailableCuisines();
    let pillsHtml = `
      <button type="button" class="cuisine-pill active px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 text-white shadow-sm transition" data-cuisine="all">
        Alle stijlen
      </button>
    `;

    cuisines.forEach(c => {
      pillsHtml += `
        <button type="button" class="cuisine-pill px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 transition" data-cuisine="${c}">
          ${c}
        </button>
      `;
    });

    cuisineContainer.innerHTML = pillsHtml;
  }

  bindEvents() {
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
          b.classList.remove('active', 'bg-emerald-600', 'text-white');
          b.classList.add('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');
        });

        btn.classList.add('active', 'bg-emerald-600', 'text-white');
        btn.classList.remove('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');

        this.recipesService.setFilters({ cuisine: btn.dataset.cuisine });
        this.render();
      });
    }

    // Snelkeuze toggles
    const bonusToggle = document.getElementById('filter-bonus');
    if (bonusToggle) {
      bonusToggle.addEventListener('click', () => {
        const isActive = bonusToggle.classList.toggle('active');
        if (isActive) {
          bonusToggle.classList.add('bg-amber-500', 'text-white', 'border-amber-500');
          bonusToggle.classList.remove('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');
        } else {
          bonusToggle.classList.remove('bg-amber-500', 'text-white', 'border-amber-500');
          bonusToggle.classList.add('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');
        }
        this.recipesService.setFilters({ bonusOnly: isActive });
        this.render();
      });
    }

    const proteinToggle = document.getElementById('filter-protein');
    if (proteinToggle) {
      proteinToggle.addEventListener('click', () => {
        const isActive = proteinToggle.classList.toggle('active');
        if (isActive) {
          proteinToggle.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
          proteinToggle.classList.remove('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');
        } else {
          proteinToggle.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
          proteinToggle.classList.add('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');
        }
        this.recipesService.setFilters({ highProteinOnly: isActive });
        this.render();
      });
    }

    const quickTimeToggle = document.getElementById('filter-quick');
    if (quickTimeToggle) {
      quickTimeToggle.addEventListener('click', () => {
        const isActive = quickTimeToggle.classList.toggle('active');
        if (isActive) {
          quickTimeToggle.classList.add('bg-slate-900', 'text-white', 'dark:bg-emerald-600');
          quickTimeToggle.classList.remove('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');
        } else {
          quickTimeToggle.classList.remove('bg-slate-900', 'text-white', 'dark:bg-emerald-600');
          quickTimeToggle.classList.add('bg-white', 'dark:bg-slate-800', 'text-slate-700', 'dark:text-slate-300');
        }
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
      mainPortionMinus.addEventListener('click', () => {
        const current = this.recipesService.getServings();
        if (current > 1) {
          this.recipesService.setServings(current - 1);
          mainPortionCount.textContent = `${current - 1} pers.`;
          this.render();
        }
      });

      mainPortionPlus.addEventListener('click', () => {
        const current = this.recipesService.getServings();
        if (current < 8) {
          this.recipesService.setServings(current + 1);
          mainPortionCount.textContent = `${current + 1} pers.`;
          this.render();
        }
      });
    }

    // Recept Klik (Kaart openen)
    const recipeGrid = document.getElementById('recipes-grid');
    if (recipeGrid) {
      recipeGrid.addEventListener('click', (e) => {
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
        if (e.target === recipeModal || e.target.closest('#close-modal-btn')) {
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

  openRecipeModal(recipeId) {
    this.activeRecipeId = recipeId;
    this.modalServings = this.recipesService.getServings();
    this.refreshModalContent();
    const modal = document.getElementById('recipe-modal');
    if (modal) {
      modal.showModal();
    }
  }

  closeRecipeModal() {
    const modal = document.getElementById('recipe-modal');
    if (modal) {
      modal.close();
    }
    this.activeRecipeId = null;
  }

  refreshModalContent() {
    const modal = document.getElementById('recipe-modal');
    const recipe = this.recipesService.getRecipeById(this.activeRecipeId);
    if (modal && recipe) {
      modal.innerHTML = this.ui.renderRecipeModal(recipe, this.modalServings);
    }
  }

  async askGemini(question) {
    const recipe = this.recipesService.getRecipeById(this.activeRecipeId);
    if (!recipe) return;

    const responseArea = document.getElementById('gemini-response-area');
    const spinner = document.getElementById('gemini-spinner');
    const submitBtn = document.getElementById('gemini-submit-btn');

    if (!responseArea) return;

    responseArea.classList.remove('hidden');
    responseArea.innerHTML = `<span class="text-indigo-600 dark:text-indigo-400 font-medium">🤔 Chef Gemini denkt na over: "${question}"...</span>`;
    if (spinner) spinner.classList.remove('hidden');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const answer = await this.geminiService.askAboutRecipe(recipe, question, this.modalServings);
      responseArea.innerHTML = `
        <div class="font-bold text-xs uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1">
          Antwoord van Chef Gemini:
        </div>
        <div class="text-slate-800 dark:text-slate-100">${answer}</div>
      `;
    } catch (err) {
      responseArea.innerHTML = `
        <div class="text-rose-600 dark:text-rose-400 text-xs font-semibold">
          ⚠️ ${err.message}
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

  initTheme() {
    const themeBtn = document.getElementById('theme-toggle');
    const isDark = localStorage.getItem('myfood_theme') === 'dark' || 
                   (!localStorage.getItem('myfood_theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const currentlyDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('myfood_theme', currentlyDark ? 'dark' : 'light');
      });
    }
  }

  render() {
    const grid = document.getElementById('recipes-grid');
    const countEl = document.getElementById('results-count');
    if (!grid) return;

    const filtered = this.recipesService.getFilteredRecipes();
    const servings = this.recipesService.getServings();

    if (countEl) {
      countEl.textContent = `${filtered.length} recepten gevonden`;
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full py-16 text-center">
          <span class="text-4xl block mb-2">🔍</span>
          <h3 class="text-lg font-bold text-slate-700 dark:text-slate-200">Geen recepten gevonden</h3>
          <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Probeer een ander trefwoord of wis je filters.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(r => this.ui.renderRecipeCard(r, servings)).join('');
  }
}

// Start app wanneer DOM klaar is
document.addEventListener('DOMContentLoaded', () => {
  const app = new MyFoodApp();
  app.init();
});
