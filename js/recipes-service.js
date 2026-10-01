import { BrowserCache } from './browser-cache.js';

const THEMEALDB_API = 'https://www.themealdb.com/api/json/v1/1';
const RECIPE_CATALOG_KEY = 'recipes:catalog';
const AH_RECIPE_CATALOG_KEY = 'recipes:ah-catalog';
const AH_RECIPE_SITEMAP = 'https://www.ah.nl/sitemaps/entities/allerhande/recipes.xml';
const RECIPE_CATALOG_TTL = 24 * 60 * 60 * 1000;
const RECIPE_DETAIL_TTL = 7 * 24 * 60 * 60 * 1000;
const RECIPE_LIMIT = 250;

const AH_SEARCH_ALIASES = [
  [/\b(chicken breast|chicken)\b/, 'kipfilet'],
  [/\b(salmon|salmon fillet)\b/, 'zalmfilet'],
  [/\b(spinach)\b/, 'spinazie'],
  [/\b(penne|wholewheat pasta|wholemeal pasta)\b/, 'volkoren penne'],
  [/\b(pasta)\b/, 'pasta'],
  [/\b(cream cheese|dairy spread)\b/, 'zuivelspread'],
  [/\b(canned tomatoes|canned tomato|chopped tomatoes)\b/, 'tomatenblokjes'],
  [/\b(cherry tomatoes|cherry tomato|tomatoes|tomato)\b/, 'tomaten'],
  [/\b(bell pepper|sweet pepper)\b/, 'paprika'],
  [/\b(broccoli)\b/, 'broccoli'],
  [/\b(basmati rice)\b/, 'basmati rijst'],
  [/\b(brown rice)\b/, 'zilvervliesrijst'],
  [/\b(cashews|cashew nuts)\b/, 'cashewnoten'],
  [/\b(avocado)\b/, 'avocado'],
  [/\b(black beans)\b/, 'zwarte bonen'],
  [/\b(sweetcorn|sweet corn|corn kernels)\b/, 'mais'],
  [/\b(cod|cod fillet)\b/, 'kabeljauw'],
  [/\b(kalamata olives|olives)\b/, 'olijven'],
  [/\b(new potatoes|baby potatoes)\b/, 'krieltjes'],
  [/\b(tofu)\b/, 'tofu'],
  [/\b(edamame)\b/, 'edamame'],
  [/\b(bok choy|pak choi)\b/, 'paksoi'],
  [/\b(ground beef|minced beef)\b/, 'rundergehakt'],
  [/\b(feta)\b/, 'feta'],
  [/\b(greek yogurt|greek yoghurt|yogurt|yoghurt)\b/, 'Griekse yoghurt'],
  [/\b(cucumber)\b/, 'komkommer'],
  [/\b(red lentils)\b/, 'rode linzen'],
  [/\b(coconut milk)\b/, 'kokosmelk'],
  [/\b(naan)\b/, 'naanbrood'],
  [/\b(sweet potato|sweet potatoes)\b/, 'zoete aardappel'],
  [/\b(mustard)\b/, 'mosterd'],
  [/\b(eggs|egg)\b/, 'eieren'],
  [/\b(onion|onions)\b/, 'uien'],
  [/\b(garlic)\b/, 'knoflook'],
  [/\b(ginger)\b/, 'gember'],
  [/\b(vegetable oil|olive oil)\b/, 'olie'],
  [/\b(cumin)\b/, 'komijn'],
  [/\b(coriander)\b/, 'koriander'],
  [/\b(turmeric)\b/, 'kurkuma'],
  [/\b(chilli|chili)\b/, 'chilipeper'],
  [/\b(cream)\b/, 'room'],
  [/\b(yogurt|yoghurt)\b/, 'yoghurt'],
  [/\b(pita bread|pita breads)\b/, 'pitabroodjes']
];

export class RecipesService {
  constructor(ahService, cache = new BrowserCache()) {
    this.ahService = ahService;
    this.cache = cache;
    this.recipes = [];
    this.activeServings = 2;
    this.filters = {
      searchQuery: '',
      cuisine: 'all',
      maxTime: 0,
      highProteinOnly: false,
      bonusOnly: false,
      maxPrice: 0,
      sortBy: 'default'
    };
    this.priceUpdatePromise = null;
    this.detailRequests = new Map();
    this.matchRequests = new Map();
  }

  async loadRecipes(onCatalogUpdate = () => {}) {
    let localRecipes = [];
    try {
      const response = await fetch('./data/recipes.json');
      if (!response.ok) throw new Error(`recipes.json laden mislukt (${response.status}).`);
      localRecipes = await response.json();
    } catch (error) {
      console.error('Lokale MyFood-recepten konden niet worden geladen.', error);
    }

    const [cachedCatalog, cachedAHCatalog] = await Promise.all([
      this.readCache(RECIPE_CATALOG_KEY),
      this.readCache(AH_RECIPE_CATALOG_KEY)
    ]);
    const cachedRecipes = [
      ...(cachedCatalog?.value || []),
      ...(cachedAHCatalog?.value || [])
    ];
    if (cachedRecipes.length) {
      this.recipes = this.combineRecipes(localRecipes, cachedRecipes);
      await this.applyCachedPrices();
      const cacheIsStale = [cachedCatalog, cachedAHCatalog].some(cached =>
        !cached?.value?.length || Date.now() - cached.updatedAt > RECIPE_CATALOG_TTL
      );
      if (cacheIsStale) {
        this.refreshCatalog(localRecipes, onCatalogUpdate).catch(error => {
          console.warn('Receptencatalogus verversen mislukt; eerder opgeslagen recepten blijven zichtbaar.', error);
        });
      }
      return this.recipes;
    }

    const [mealDBResult, ahResult] = await Promise.allSettled([
      this.fetchRecipeCatalog(),
      this.fetchAHRecipeCatalog()
    ]);
    const externalRecipes = [];
    if (mealDBResult.status === 'fulfilled') {
      externalRecipes.push(...mealDBResult.value);
      await this.writeCache(RECIPE_CATALOG_KEY, mealDBResult.value);
    } else {
      console.warn('TheMealDB-recepten konden niet worden geladen.', mealDBResult.reason);
    }
    if (ahResult.status === 'fulfilled') {
      externalRecipes.push(...ahResult.value);
      await this.writeCache(AH_RECIPE_CATALOG_KEY, ahResult.value);
    } else {
      console.warn('Allerhande-recepten konden niet worden geladen.', ahResult.reason);
    }
    this.recipes = this.combineRecipes(localRecipes, externalRecipes);
    return this.recipes;
  }

  combineRecipes(localRecipes, externalRecipes) {
    const localTitles = new Set(localRecipes.map(recipe => this.normalizeName(recipe.title)));
    const uniqueExternal = new Map();
    externalRecipes.forEach(recipe => {
      const title = this.normalizeName(recipe.title);
      if (!localTitles.has(title) && !uniqueExternal.has(recipe.id)) uniqueExternal.set(recipe.id, recipe);
    });
    const recipes = [...uniqueExternal.values()];
    return [
      ...localRecipes,
      ...recipes.filter(recipe => recipe.ahRecipeOnly),
      ...recipes.filter(recipe => !recipe.ahRecipeOnly)
    ];
  }

  async refreshCatalog(localRecipes, onCatalogUpdate) {
    const [cachedCatalog, cachedAHCatalog] = await Promise.all([
      this.readCache(RECIPE_CATALOG_KEY),
      this.readCache(AH_RECIPE_CATALOG_KEY)
    ]);
    const [mealDBResult, ahResult] = await Promise.allSettled([
      this.fetchRecipeCatalog(),
      this.fetchAHRecipeCatalog()
    ]);
    const mealDBRecipes = mealDBResult.status === 'fulfilled'
      ? mealDBResult.value
      : cachedCatalog?.value || [];
    const ahRecipes = ahResult.status === 'fulfilled'
      ? ahResult.value
      : cachedAHCatalog?.value || [];
    if (mealDBResult.status === 'fulfilled') {
      await this.writeCache(RECIPE_CATALOG_KEY, mealDBRecipes);
    } else {
      console.warn('TheMealDB-catalogus verversen mislukt; cache blijft behouden.', mealDBResult.reason);
    }
    if (ahResult.status === 'fulfilled') {
      await this.writeCache(AH_RECIPE_CATALOG_KEY, ahRecipes);
    } else {
      console.warn('Allerhande-catalogus verversen mislukt; cache blijft behouden.', ahResult.reason);
    }
    const externalRecipes = [...mealDBRecipes, ...ahRecipes];
    this.recipes = this.combineRecipes(localRecipes, externalRecipes);
    await this.applyCachedPrices();
    onCatalogUpdate(this.recipes);
  }

  async fetchAHRecipeCatalog() {
    const response = await fetch(AH_RECIPE_SITEMAP);
    if (!response.ok) {
      throw new Error(`AH-receptensitemap laden mislukt (${response.status}).`);
    }
    const sitemap = await response.text();
    const urls = [...sitemap.matchAll(/<loc>([\s\S]*?)<\/loc>/g)]
      .map(match => match[1].replaceAll('&amp;', '&'))
      .filter(url => this.isAHRecipeUrl(url));
    if (urls.length === 0) throw new Error('De AH-receptensitemap bevat geen herkenbare recepten.');
    return urls.slice(0, RECIPE_LIMIT).map(url => this.normalizeAHRecipeSummary(url));
  }

  isAHRecipeUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' &&
        url.hostname === 'www.ah.nl' &&
        /^\/allerhande\/recept\/R-R\d+\/[^/]+$/.test(url.pathname);
    } catch {
      return false;
    }
  }

  normalizeAHRecipeSummary(value) {
    const url = new URL(value);
    const match = url.pathname.match(/^\/allerhande\/recept\/R-R(\d+)\/([^/]+)$/);
    if (!match) throw new Error('Ongeldige AH-receptlink in de sitemap.');
    let title = match[2];
    try {
      title = decodeURIComponent(title);
    } catch {
      // Keep the original slug when the sitemap contains malformed escaping.
    }
    title = title.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    title = title.charAt(0).toLocaleUpperCase('nl-NL') + title.slice(1);
    return {
      id: `ah-allerhande-${match[1]}`,
      title,
      description: 'Een origineel Allerhande-recept. Bekijk ingrediënten en bereidingsstappen op de website van Albert Heijn.',
      cuisine: 'Nederlands',
      mealType: 'Recept',
      prepTimeMinutes: 0,
      difficulty: 'Bekijk op Allerhande',
      baseServings: 2,
      image: '',
      sourceName: 'Allerhande',
      sourceUrl: url.href,
      nutrition: null,
      tags: ['ah', 'allerhande'],
      ingredients: [],
      instructions: [],
      ahRecipeOnly: true
    };
  }

  async fetchRecipeCatalog() {
    const categoryResponse = await fetch(`${THEMEALDB_API}/categories.php`);
    if (!categoryResponse.ok) {
      throw new Error(`TheMealDB-categorieën laden mislukt (${categoryResponse.status}).`);
    }
    const categoryData = await categoryResponse.json();
    const categories = (categoryData.categories || []).map(category => category.strCategory).filter(Boolean);
    if (categories.length === 0) throw new Error('TheMealDB gaf geen receptcategorieën terug.');

    const categoryResults = await this.mapWithConcurrency(categories, 3, async category => {
      try {
        const response = await fetch(`${THEMEALDB_API}/filter.php?c=${encodeURIComponent(category)}`);
        if (!response.ok) throw new Error(`TheMealDB-categorie "${category}" laden mislukt (${response.status}).`);
        const data = await response.json();
        return (data.meals || []).map(meal => this.normalizeRecipeSummary(meal, category));
      } catch (error) {
        console.warn(`TheMealDB-categorie "${category}" kon niet worden geladen.`, error);
        return [];
      }
    });
    const categoryRecipes = categoryResults.filter(Array.isArray);
    const unique = new Map();
    categoryRecipes.flat().forEach(recipe => {
      if (recipe.id && !unique.has(recipe.id)) unique.set(recipe.id, recipe);
    });
    return [...unique.values()].slice(0, RECIPE_LIMIT);
  }

  async mapWithConcurrency(items, limit, callback) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await callback(items[index]);
      }
    });
    await Promise.all(workers);
    return results;
  }

  normalizeRecipeSummary(meal, category = '') {
    const id = String(meal.idMeal || '');
    return {
      id: `themealdb-${id}`,
      mealDbId: id,
      title: meal.strMeal || 'Untitled recipe',
      description: `Recipe from TheMealDB. Open the recipe to view its ingredients and calculate AH prices.`,
      cuisine: meal.strArea || meal.strCountry || category || 'International',
      mealType: category || 'Meal',
      prepTimeMinutes: 0,
      difficulty: 'Not listed',
      baseServings: 2,
      image: this.getSafeExternalUrl(meal.strMealThumb) || '',
      sourceName: 'TheMealDB',
      sourceUrl: `https://www.themealdb.com/meal/${encodeURIComponent(id)}`,
      nutrition: null,
      tags: ['external', 'themealdb'],
      ingredients: [],
      instructions: [],
      external: true
    };
  }

  async applyCachedPrices() {
    await Promise.all(this.recipes.filter(recipe => recipe.external && !recipe.ahRecipeOnly).map(async recipe => {
      const cached = await this.readCache(`priced-recipe:${recipe.id}`);
      if (!cached?.value) return;
      Object.assign(recipe, cached.value, { priceUpdatedAt: cached.updatedAt });
    }));
  }

  async refreshPrices(onProgress = () => {}) {
    if (this.priceUpdatePromise) return this.priceUpdatePromise;
    const externalRecipes = this.recipes.filter(recipe => recipe.external && !recipe.ahRecipeOnly);
    let completed = 0;
    this.priceUpdatePromise = (async () => {
      for (const summary of externalRecipes) {
        try {
          const recipe = await this.loadRecipeDetails(summary);
          await this.loadAHMatches(recipe);
          recipe.priceEstimate = this.ahService.calculateRecipePrice(recipe, recipe.baseServings);
          const stored = await this.writeCache(`priced-recipe:${recipe.id}`, recipe);
          recipe.priceUpdatedAt = stored?.updatedAt || Date.now();
          Object.assign(summary, recipe);
        } catch (error) {
          console.warn(`Receptprijs kon niet worden bijgewerkt voor "${summary.title}".`, error);
          summary.priceError = true;
        }
        completed++;
        onProgress({ completed, total: externalRecipes.length, recipe: summary });
      }
    })().finally(() => {
      this.priceUpdatePromise = null;
    });
    return this.priceUpdatePromise;
  }

  async loadRecipeDetails(summary) {
    if (!summary.external) return summary;
    if (this.detailRequests.has(summary.id)) return this.detailRequests.get(summary.id);
    const request = this.fetchRecipeDetails(summary).finally(() => this.detailRequests.delete(summary.id));
    this.detailRequests.set(summary.id, request);
    return request;
  }

  async fetchRecipeDetails(summary) {
    const cached = await this.readCache(`recipe-detail:${summary.id}`);
    if (cached && Date.now() - cached.updatedAt < RECIPE_DETAIL_TTL) return cached.value;

    try {
      const response = await fetch(`${THEMEALDB_API}/lookup.php?i=${encodeURIComponent(summary.mealDbId)}`);
      if (!response.ok) throw new Error(`TheMealDB-recept ophalen mislukt (${response.status}).`);
      const data = await response.json();
      const meal = data.meals?.[0];
      if (!meal) throw new Error(`TheMealDB heeft geen details voor "${summary.title}" teruggegeven.`);
      const recipe = this.normalizeExternalRecipe(meal);
      await this.writeCache(`recipe-detail:${summary.id}`, recipe);
      return recipe;
    } catch (error) {
      if (cached?.value) {
        console.warn(`Gebruik opgeslagen receptdetails voor "${summary.title}".`, error);
        return cached.value;
      }
      throw error;
    }
  }

  async loadAHMatches(recipe) {
    if (this.matchRequests.has(recipe.id)) return this.matchRequests.get(recipe.id);
    const request = this.fetchAHMatches(recipe).finally(() => this.matchRequests.delete(recipe.id));
    this.matchRequests.set(recipe.id, request);
    return request;
  }

  async fetchAHMatches(recipe) {
    const ingredients = recipe.ingredients || [];
    await this.mapWithConcurrency(ingredients, 3, async ingredient => {
      const query = this.getAHSearchQuery(ingredient.name);
      try {
        const result = await this.ahService.searchProducts(query, { revalidate: true });
        ingredient.ahProductOptions = result.products;
        ingredient.productLookupAt = result.updatedAt;
        ingredient.productLookupStale = result.stale;
        const saved = await this.ahService.getSavedMatch(recipe.id, ingredient.name);
        const savedMatch = saved?.value
          ? result.products.find(product => product.id === saved.value.id)
          : null;
        if (saved?.value && !savedMatch) {
          ingredient.ahProductOptions.unshift({ ...saved.value, cachedMatch: true });
          ingredient.productLookupStale = true;
        }
        ingredient.selectedAHProduct = savedMatch || saved?.value || result.products[0] || null;
      } catch (error) {
        ingredient.ahProductOptions = [];
        ingredient.productLookupError = error.message;
        const saved = await this.ahService.getSavedMatch(recipe.id, ingredient.name);
        ingredient.selectedAHProduct = saved?.value || null;
        if (saved?.value) ingredient.ahProductOptions = [{ ...saved.value, cachedMatch: true }];
        ingredient.productLookupStale = Boolean(saved?.value);
      }
    });
    recipe.priceError = ingredients.some(ingredient => ingredient.productLookupError);
    return recipe;
  }

  async selectProductMatch(recipeId, ingredientIndex, productId) {
    const recipe = this.getRecipeById(recipeId);
    const ingredient = recipe?.ingredients?.[ingredientIndex];
    if (!ingredient) throw new Error('Receptingrediënt voor productkeuze niet gevonden.');
    const product = (ingredient.ahProductOptions || []).find(option => option.id === productId);
    if (!product) throw new Error('Gekozen AH-product bestaat niet meer in de zoekresultaten.');
    ingredient.selectedAHProduct = product;
    await this.ahService.saveMatch(recipe.id, ingredient.name, product);
    recipe.priceEstimate = this.ahService.calculateRecipePrice(recipe, recipe.baseServings);
    const stored = await this.writeCache(`priced-recipe:${recipe.id}`, recipe);
    recipe.priceUpdatedAt = stored?.updatedAt || Date.now();
    return recipe;
  }

  normalizeExternalRecipe(meal) {
    const summary = this.normalizeRecipeSummary(meal, meal.strCategory);
    const ingredients = [];
    for (let index = 1; index <= 20; index++) {
      const name = meal[`strIngredient${index}`]?.trim();
      if (!name) continue;
      const parsed = this.parseMeasure(meal[`strMeasure${index}`] || '');
      ingredients.push({
        name,
        amount: parsed.amount,
        unit: parsed.unit,
        ahProductOptions: [],
        selectedAHProduct: null
      });
    }
    summary.description = `Recipe from TheMealDB. Prices use live AH product data when available.`;
    summary.cuisine = meal.strArea || meal.strCountry || summary.cuisine;
    summary.sourceUrl = this.getSafeExternalUrl(meal.strSource) || summary.sourceUrl;
    summary.baseServings = Number.parseInt(meal.strServings, 10) || 2;
    summary.ingredients = ingredients;
    summary.instructions = (meal.strInstructions || '')
      .split(/\r?\n/)
      .map(step => step.trim())
      .filter(Boolean);
    return summary;
  }

  getAHSearchQuery(ingredientName) {
    const normalized = this.normalizeName(ingredientName);
    const alias = AH_SEARCH_ALIASES.find(([pattern]) => pattern.test(normalized));
    return alias ? alias[1] : ingredientName.trim();
  }

  getSafeExternalUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }

  parseMeasure(measure) {
    const value = measure.trim();
    const match = value.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (!match) return { amount: null, unit: value };
    const amountText = match[1];
    const amount = amountText.includes('/')
      ? amountText.split(/\s+/).reduce((total, part) => {
        if (!part.includes('/')) return total + Number(part);
        const [numerator, denominator] = part.split('/').map(Number);
        return total + numerator / denominator;
      }, 0)
      : Number(amountText.replace(',', '.'));
    return { amount, unit: match[2].trim() };
  }

  normalizeName(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  async readCache(key) {
    try {
      return await this.cache.get(key);
    } catch (error) {
      console.warn(`Cache lezen mislukt voor "${key}".`, error);
      return null;
    }
  }

  async writeCache(key, value) {
    try {
      return await this.cache.set(key, value);
    } catch (error) {
      console.warn(`Cache opslaan mislukt voor "${key}".`, error);
      return null;
    }
  }

  setServings(num) {
    if (num >= 1 && num <= 12) this.activeServings = num;
  }

  getServings() {
    return this.activeServings;
  }

  setFilters(partialFilters) {
    this.filters = { ...this.filters, ...partialFilters };
  }

  resetFilters() {
    this.filters = {
      searchQuery: '',
      cuisine: 'all',
      maxTime: 0,
      highProteinOnly: false,
      bonusOnly: false,
      maxPrice: 0,
      sortBy: 'default'
    };
  }

  getFilteredRecipes() {
    return this.recipes.filter(recipe => {
      const query = this.filters.searchQuery.toLowerCase().trim();
      if (query) {
        const fields = [recipe.title, recipe.description, recipe.cuisine, ...(recipe.tags || [])];
        const matchesText = fields.some(value => value?.toLowerCase().includes(query));
        const matchesIngredients = (recipe.ingredients || []).some(ingredient =>
          ingredient.name.toLowerCase().includes(query)
        );
        if (!matchesText && !matchesIngredients) return false;
      }
      if (this.filters.cuisine !== 'all' && recipe.cuisine !== this.filters.cuisine) return false;
      if (this.filters.maxTime > 0 &&
          (!recipe.prepTimeMinutes || recipe.prepTimeMinutes > this.filters.maxTime)) return false;
      if (this.filters.highProteinOnly &&
          (!recipe.nutrition || recipe.nutrition.proteinGrams < 30)) return false;

      const priceInfo = this.ahService.calculateRecipePrice(recipe, this.activeServings);
      if (this.filters.bonusOnly && !priceInfo.hasBonus) return false;
      if (this.filters.maxPrice > 0 &&
          (!priceInfo.hasPriceData || priceInfo.pricePerPerson > this.filters.maxPrice)) return false;
      return true;
    }).sort((a, b) => {
      const priceA = this.ahService.calculateRecipePrice(a, this.activeServings);
      const priceB = this.ahService.calculateRecipePrice(b, this.activeServings);
      switch (this.filters.sortBy) {
        case 'price-asc':
          const rankA = priceA.hasPriceData ? 0 : priceA.hasAnyPriceData ? 1 : 2;
          const rankB = priceB.hasPriceData ? 0 : priceB.hasAnyPriceData ? 1 : 2;
          if (rankA !== rankB) return rankA - rankB;
          if (!priceA.hasAnyPriceData && !priceB.hasAnyPriceData) return 0;
          return priceA.pricePerPerson - priceB.pricePerPerson;
        case 'protein-desc':
          return (b.nutrition?.proteinGrams || 0) - (a.nutrition?.proteinGrams || 0);
        case 'time-asc':
          if (!a.prepTimeMinutes && !b.prepTimeMinutes) return 0;
          if (!a.prepTimeMinutes) return 1;
          if (!b.prepTimeMinutes) return -1;
          return a.prepTimeMinutes - b.prepTimeMinutes;
        case 'health-desc':
          return (b.nutrition?.healthScore || 0) - (a.nutrition?.healthScore || 0);
        case 'bonus-desc':
          return (priceB.totalSavings || 0) - (priceA.totalSavings || 0);
        default:
          return 0;
      }
    });
  }

  getRecipeById(id) {
    return this.recipes.find(recipe => recipe.id === id);
  }

  async getRecipeDetails(id) {
    const summary = this.getRecipeById(id);
    if (!summary) return null;
    if (summary.ahRecipeOnly) return summary;
    if (!summary.external || summary.ingredients?.length) return summary;

    const recipe = await this.loadRecipeDetails(summary);
    Object.assign(summary, recipe);
    await this.loadAHMatches(summary);
    summary.priceEstimate = this.ahService.calculateRecipePrice(summary, summary.baseServings);
    const stored = await this.writeCache(`priced-recipe:${summary.id}`, summary);
    summary.priceUpdatedAt = stored?.updatedAt || Date.now();
    return summary;
  }

  getAvailableCuisines() {
    return Array.from(new Set(this.recipes.map(recipe => recipe.cuisine).filter(Boolean)));
  }
}
