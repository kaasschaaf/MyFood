/**
 * Recipes Service - Beheert receptendata, filters, zoeken en portieschaling
 */
export class RecipesService {
  constructor(ahService) {
    this.ahService = ahService;
    this.recipes = [];
    this.activeServings = 2; // Standaard 2 personen zoals gewenst!
    this.filters = {
      searchQuery: '',
      cuisine: 'all',
      maxTime: 0,
      highProteinOnly: false,
      bonusOnly: false,
      maxPrice: 0,
      sortBy: 'default' // 'default', 'price-asc', 'protein-desc', 'time-asc', 'health-desc'
    };
  }

  async loadRecipes() {
    try {
      const response = await fetch('./data/recipes.json');
      if (!response.ok) throw new Error('Kon recipes.json niet laden');
      this.recipes = await response.json();
      return this.recipes;
    } catch (e) {
      console.error('Fout bij laden van recepten:', e);
      return [];
    }
  }

  setServings(num) {
    if (num >= 1 && num <= 12) {
      this.activeServings = num;
    }
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

  /**
   * Filtert en sorteert de lijst van recepten volgens de actieve filters
   */
  getFilteredRecipes() {
    return this.recipes.filter(recipe => {
      // 1. Zoekbalk filter (titel, beschrijving, ingrediënten, tags)
      if (this.filters.searchQuery) {
        const q = this.filters.searchQuery.toLowerCase().trim();
        const matchesTitle = recipe.title.toLowerCase().includes(q);
        const matchesDesc = recipe.description?.toLowerCase().includes(q);
        const matchesCuisine = recipe.cuisine?.toLowerCase().includes(q);
        const matchesTags = (recipe.tags || []).some(t => t.toLowerCase().includes(q));
        const matchesIngredients = (recipe.ingredients || []).some(i => i.name.toLowerCase().includes(q));

        if (!matchesTitle && !matchesDesc && !matchesCuisine && !matchesTags && !matchesIngredients) {
          return false;
        }
      }

      // 2. Keukenstijl filter
      if (this.filters.cuisine !== 'all' && recipe.cuisine !== this.filters.cuisine) {
        return false;
      }

      // 3. Maximale bereidingstijd
      if (this.filters.maxTime > 0 && recipe.prepTimeMinutes > this.filters.maxTime) {
        return false;
      }

      // 4. Eiwitrijk filter (> 30g eiwit per persoon)
      if (this.filters.highProteinOnly && (!recipe.nutrition || recipe.nutrition.proteinGrams < 30)) {
        return false;
      }

      // 5. Bonus deals filter
      const priceInfo = this.ahService.calculateRecipePrice(recipe, this.activeServings);
      if (this.filters.bonusOnly && !priceInfo.hasBonus) {
        return false;
      }

      // 6. Maximale prijs per persoon
      if (this.filters.maxPrice > 0 && priceInfo.pricePerPerson > this.filters.maxPrice) {
        return false;
      }

      return true;
    }).sort((a, b) => {
      // Sortering
      const priceA = this.ahService.calculateRecipePrice(a, this.activeServings);
      const priceB = this.ahService.calculateRecipePrice(b, this.activeServings);

      switch (this.filters.sortBy) {
        case 'price-asc':
          return priceA.pricePerPerson - priceB.pricePerPerson;
        case 'protein-desc':
          return (b.nutrition?.proteinGrams || 0) - (a.nutrition?.proteinGrams || 0);
        case 'time-asc':
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
    return this.recipes.find(r => r.id === id);
  }

  /**
   * Haalt alle unieke keukens op uit de dataset
   */
  getAvailableCuisines() {
    const cuisines = new Set(this.recipes.map(r => r.cuisine).filter(Boolean));
    return Array.from(cuisines);
  }
}
