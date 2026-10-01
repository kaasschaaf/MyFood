/**
 * AH Service - Beheert Albert Heijn prijzen, bonusberekeningen en valutaformattering
 */
export class AHService {
  constructor() {
    this.bonusData = null;
  }

  async init() {
    try {
      const response = await fetch('./data/ah-bonus.json');
      if (response.ok) {
        this.bonusData = await response.json();
      }
    } catch (e) {
      console.warn('Kon lokaal ah-bonus.json niet laden, gebruikt receptprijzen:', e);
    }
  }

  /**
   * Berekent de totale prijs en bonusbesparing voor een recept geschaald naar het aantal personen
   * @param {Object} recipe 
   * @param {number} servings 
   * @returns {Object} { totalPrice, pricePerPerson, totalStandardPrice, totalSavings, hasBonus, bonusCount }
   */
  calculateRecipePrice(recipe, servings = 2) {
    const scale = servings / (recipe.baseServings || 2);
    let totalPrice = 0;
    let totalStandardPrice = 0;
    let bonusCount = 0;

    if (!recipe.ingredients || !Array.isArray(recipe.ingredients)) {
      return { totalPrice: 0, pricePerPerson: 0, totalStandardPrice: 0, totalSavings: 0, hasBonus: false, bonusCount: 0 };
    }

    recipe.ingredients.forEach(ing => {
      // Check of er een actuele override is in bonusData
      let isBonus = ing.isBonus;
      let standardPrice = ing.standardPrice || 0;
      let actualPrice = isBonus && ing.bonusPrice ? ing.bonusPrice : standardPrice;

      if (this.bonusData && this.bonusData.discounts && ing.ahProductId) {
        const discount = this.bonusData.discounts[ing.ahProductId];
        if (discount) {
          isBonus = discount.isBonus;
          standardPrice = discount.originalPrice || standardPrice;
          actualPrice = isBonus && discount.bonusPrice ? discount.bonusPrice : standardPrice;
        }
      }

      if (isBonus) {
        bonusCount++;
      }

      // We schalen de ingrediënten proportioneel naar het aantal porties
      totalPrice += actualPrice * scale;
      totalStandardPrice += standardPrice * scale;
    });

    const totalSavings = Math.max(0, totalStandardPrice - totalPrice);
    const pricePerPerson = servings > 0 ? totalPrice / servings : 0;

    return {
      totalPrice,
      pricePerPerson,
      totalStandardPrice,
      totalSavings,
      hasBonus: bonusCount > 0,
      bonusCount
    };
  }

  /**
   * Formatteert een bedrag als Nederlands euroformaat (€ 4,25)
   * @param {number} amount 
   * @returns {string}
   */
  formatEuro(amount) {
    if (isNaN(amount) || amount === null) return '€ 0,00';
    return new Intl.NumberFormat('nl-NL', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount);
  }
}
