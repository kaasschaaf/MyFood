import { escapeHtml } from './utils.js';
import { cuisineLabel, getLang, getLocale, t } from './i18n.js';
import { ContentTranslator } from './content-translator.js';

/**
 * UI Components - Rendert receptenkaarten, modalen, balkjes en interactieve elementen
 */
export class UIComponents {
  constructor(ahService, geminiService, recipesService, translator) {
    this.ahService = ahService;
    this.geminiService = geminiService;
    this.recipesService = recipesService;
    this.translator = translator || new ContentTranslator(geminiService);
  }

  escapeHtml(value) {
    return escapeHtml(value);
  }

  formatTimestamp(value) {
    if (!value) return t('recipe.updatedAt', { date: '—' });
    return new Intl.DateTimeFormat(getLocale(), {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  /** Recipe title in the active language. */
  title(recipe) {
    return this.translator.title(recipe);
  }

  /** Recipe description in the active language. */
  description(recipe) {
    return this.translator.description(recipe);
  }

  /** Ingredient name for display only; AH lookups keep the Dutch name. */
  ingredientName(ingredient) {
    return this.translator.ingredientName(ingredient);
  }

  /** Cooking steps in the active language. */
  instructions(recipe) {
    return this.translator.instructions(recipe);
  }

  /**
   * Returns the translated field when English content is available.
   * @param {Object} recipe
   * @param {string} translatedKey
   * @param {string} sourceKey
   * @returns {string}
   */
  translated(recipe, translatedKey, sourceKey) {
    if (getLang() === 'en' && recipe?.[translatedKey]) return recipe[translatedKey];
    return recipe?.[sourceKey] || '';
  }

  cuisine(recipe) {
    return cuisineLabel(this.translated(recipe, 'displayCuisine', 'cuisine'));
  }

  /**
   * Externe bronnen vullen geen bereidingstijd of moeilijkheid in; toon dan
   * geen "— min" of de Engelse tekst "Not listed".
   */
  difficulty(recipe) {
    const value = this.translated(recipe, 'displayDifficulty', 'difficulty');
    if (!value || /^(not listed|onbekend)$/i.test(value)) return t('recipe.notListed');
    return value;
  }

  hasPrepTime(recipe) {
    return Number(recipe?.prepTimeMinutes) > 0;
  }

  isLivePriced(recipe) {
    return Boolean(recipe && !recipe.ahRecipeOnly && (recipe.external || recipe.livePriced));
  }

  icon(name, className = 'h-4 w-4') {
    const paths = {
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      flame: '<path d="M12 3c.5 3.2-2.4 4.5-2.4 7.2 0 1.1.7 2 1.8 2.2-.2-1.6.7-2.6 1.5-3.4.2 2.4 3.1 3 3.1 5.9A4 4 0 0 1 12 19a5 5 0 0 1-5-5c0-4 3.2-6.8 5-11Z"/>',
      dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/>',
      leaf: '<path d="M5 19c8 0 14-4 14-14-8 0-14 4-14 14Z"/><path d="M5 19c2-4 5-7 9-9"/>',
      arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
      arrowUpRight: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
      chevronRight: '<path d="m9 6 6 6-6 6"/>',
      chevronLeft: '<path d="m15 6-6 6 6 6"/>',
      basket: '<path d="M5 9h14l-1 11H6L5 9Z"/><path d="m9 9 3-5 3 5"/><path d="M9.5 13v3M14.5 13v3"/>',
      list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
      sparkles: '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z"/>',
      key: '<circle cx="8" cy="15" r="3"/><path d="m11 12 8-8M17 4l3 3M15 6l2 2"/>',
      close: '<path d="M18 6 6 18M6 6l12 12"/>',
      users: '<circle cx="12" cy="8" r="3"/><path d="M5 20a7 7 0 0 1 14 0"/>',
      star: '<path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3Z"/>'
    };
    return `<svg aria-hidden="true" class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
  }

  /**
   * Bouwt een AH-zoeklink voor een ingrediënt zonder direct product.
   * @param {Object} ingredient
   * @returns {string}
   */
  buildAHSearchUrl(ingredient) {
    // Altijd de Nederlandse naam: AH kent geen Engelse productnamen.
    const query = this.recipesService.getAHSearchQuery(
      ingredient.ahLookupName || ingredient.name
    );
    return `https://www.ah.nl/zoeken?query=${encodeURIComponent(query)}`;
  }

  /**
   * "€ 2,58 per kg" voor een product, plus de oude kiloprijs bij een bonus.
   * @param {Object} product
   * @returns {{current: string, regular: string|null}|null}
   */
  unitPriceLabel(product) {
    const unitPrice = this.ahService.unitPriceFor(product);
    if (!unitPrice) return null;
    const unit = unitPrice.unit === 'stuk' ? t('recipe.options.unitPiece') : unitPrice.unit;
    const format = amount => t('recipe.options.unitPrice', {
      price: this.ahService.formatEuro(Math.round(amount * 100) / 100),
      unit
    });
    const hasDiscount = Boolean(product.isBonus) &&
      Number.isFinite(product.regularPrice) && product.regularPrice > product.price;
    return {
      current: format(unitPrice.amount),
      regular: hasDiscount && unitPrice.regular > unitPrice.amount ? format(unitPrice.regular) : null
    };
  }

  /**
   * Producten die de bezoeker daadwerkelijk in de winkel kan kopen. Alleen
   * online verkrijgbare producten vallen standaard af, ook als ze nog in een
   * oude cache of in een eerder gekozen match zitten.
   * @param {Object} ingredient
   * @returns {Array}
   */
  onlineAvailableOptions(ingredient) {
    const options = ingredient.ahProductOptions || [];
    if (typeof this.ahService.filterProductsByOnlinePreference !== 'function') return options;
    return this.ahService.filterProductsByOnlinePreference(options);
  }

  /**
   * Rendert een klikbare lijst met geschikte AH-producten voor een ingrediënt.
   * Elk product linkt naar de AH-winkelpagina.
   * @param {Object} ingredient
   * @param {Object|null} selectedProduct
   * @returns {string} HTML string
   */
  renderIngredientProducts(ingredient, selectedProduct) {
    const options = this.onlineAvailableOptions(ingredient);
    const isExternal = options.length > 0 ||
      (ingredient.ahProductOptions || []).length > 0 ||
      Boolean(ingredient.productLookupAt || ingredient.selectedAHProduct || ingredient.productLookupError);

    if (options.length > 0) {
      // Toon het geselecteerde product bovenaan, daarna de rest.
      const sorted = [...options].sort((a, b) => {
        const aSelected = a.id === selectedProduct?.id;
        const bSelected = b.id === selectedProduct?.id;
        return Number(bSelected) - Number(aSelected);
      });

      const cheapestOption = options.find(option => option.matchesIngredient !== false);
      const rows = sorted.map(option => {
        const isSelected = option.id === selectedProduct?.id;
        const isCheapest = Boolean(cheapestOption) && option.id === cheapestOption.id;
        const offIngredient = option.matchesIngredient === false;
        const url = option.productUrl || this.buildAHSearchUrl(ingredient);
        const bonusDescription = String(option.bonusDescription || '').trim();
        const bonusLabel = bonusDescription
          ? bonusDescription.charAt(0).toLocaleUpperCase(getLocale()) + bonusDescription.slice(1)
          : t('recipe.options.bonus');
        const regularPrice = Number(option.regularPrice);
        const hasDiscount = Boolean(option.isBonus) &&
          Number.isFinite(regularPrice) && regularPrice > option.price;
        const savings = hasDiscount ? Math.round((regularPrice - option.price) * 100) / 100 : 0;
        const unitPrice = this.unitPriceLabel(option);
        const metaParts = [option.unitSize, option.isOnlineOnly ? t('recipe.options.onlineOnly') : '', option.cachedMatch ? t('recipe.options.cache') : '']
          .filter(Boolean)
          .map(part => this.escapeHtml(part));
        const selectedRing = isSelected
          ? 'border-emerald-400 bg-emerald-50/60 ring-1 ring-inset ring-emerald-500/15 dark:border-emerald-600 dark:bg-emerald-950/25 dark:ring-emerald-500/20'
          : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30 dark:border-white/10 dark:bg-neutral-900/50 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/15';
        return `
          <a href="${this.escapeHtml(url)}"
            target="_blank" rel="noopener noreferrer"
            title="${this.escapeHtml(t('recipe.viewAt', { title: option.title }))}"
            data-product-option="${this.escapeHtml(option.id)}"
            aria-keyshortcuts="Space"
            class="product-option block rounded-xl border px-3 py-2.5 transition ${selectedRing}">
            <span class="flex items-start justify-between gap-2">
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="truncate text-xs font-semibold ${offIngredient ? 'text-slate-500 dark:text-neutral-400' : 'text-slate-800 dark:text-neutral-100'}">${this.escapeHtml(option.title)}</span>
                  ${isSelected ? `<span class="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">${this.escapeHtml(t('recipe.options.chosen'))}</span>` : ''}
                  ${isCheapest ? `<span class="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600 dark:bg-white/10 dark:text-neutral-300">${this.escapeHtml(t('recipe.options.cheapest'))}</span>` : ''}
                  ${offIngredient ? `<span class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">${this.escapeHtml(t('recipe.options.notIngredient'))}</span>` : ''}
                </span>
                <span class="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-slate-400 dark:text-neutral-400">
                  ${unitPrice ? `
                    <span class="inline-flex items-baseline gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600 tabular-nums dark:bg-white/10 dark:text-neutral-300">
                      ${this.escapeHtml(unitPrice.current)}
                      ${unitPrice.regular ? `<span class="font-normal text-slate-400 line-through dark:text-neutral-500">${this.escapeHtml(unitPrice.regular)}</span>` : ''}
                    </span>
                  ` : ''}
                  ${metaParts.length ? `<span>${metaParts.join(' · ')}</span>` : ''}
                </span>
              </span>
              <span class="flex shrink-0 items-start gap-1">
                <span class="text-right">
                  <span class="block text-xs font-bold ${hasDiscount ? 'text-amber-700 dark:text-amber-300' : 'text-slate-800 dark:text-neutral-100'}">${this.ahService.formatEuro(option.price)}</span>
                  ${hasDiscount ? `<span class="block text-[10px] text-slate-400 dark:text-neutral-400 line-through">${this.ahService.formatEuro(regularPrice)}</span>` : ''}
                </span>
                <span class="mt-0.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true">${this.icon('arrowUpRight', 'h-3 w-3')}</span>
              </span>
            </span>
            ${hasDiscount ? `
              <span class="mt-2 flex items-center justify-between gap-2 border-t border-amber-200/70 pt-1.5 dark:border-amber-900/40">
                <span class="inline-flex min-w-0 items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  ${this.icon('flame', 'h-3 w-3 shrink-0')}
                  <span class="truncate">${this.escapeHtml(bonusLabel)}</span>
                </span>
                <span class="shrink-0 text-[10px] font-bold text-amber-700 dark:text-amber-300">−${this.ahService.formatEuro(savings)}</span>
              </span>
            ` : ''}
          </a>
        `;
      }).join('');

      return `<div class="space-y-1.5">${rows}</div>`;
    }

    if (isExternal) {
      const errorBlock = ingredient.productLookupError
        ? `<span class="block mt-1 text-[10px] text-rose-600 dark:text-rose-400">${this.escapeHtml(t('recipe.ahSearchFailed', { message: ingredient.productLookupError }))}</span>`
        : '';
      return `
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] text-slate-400 dark:text-neutral-400">${this.escapeHtml(t('recipe.ahUnavailable'))}</span>
          <a href="${this.escapeHtml(this.buildAHSearchUrl(ingredient))}"
            target="_blank" rel="noopener noreferrer"
            class="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-emerald-700 hover:underline dark:text-emerald-400">
            ${this.escapeHtml(t('recipe.searchAtAH'))} ${this.icon('arrowUpRight', 'h-3 w-3')}
          </a>
        </div>
        ${errorBlock}
      `;
    }

    // Eigen (ingebouwd) recept met vaste AH-productnaam.
    return `
      <div class="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-neutral-400">
        <span class="truncate">${this.escapeHtml(ingredient.ahName || t('recipe.ahArticle'))}</span>
        <a href="${this.escapeHtml(this.buildAHSearchUrl(ingredient))}"
          target="_blank" rel="noopener noreferrer"
          class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-emerald-700 transition hover:border-emerald-300 dark:border-white/10 dark:bg-neutral-900 dark:text-emerald-400 dark:hover:border-emerald-700">
          ${this.escapeHtml(t('recipe.shopAtAH'))} ${this.icon('arrowUpRight', 'h-3 w-3')}
        </a>
      </div>
    `;
  }

  /**
   * Allerhande-sitemapregels bevatten alleen een titel en een link. Ze krijgen
   * daarom een compacte kaart zonder nepfoto, zodat ze niet als recept met
   * ontbrekende gegevens lezen.
   * @param {Object} recipe
   * @returns {string} HTML string
   */
  renderAllerhandeLinkCard(recipe) {
    return `
      <a
        href="${this.escapeHtml(recipe.sourceUrl)}"
        target="_blank"
        rel="noopener noreferrer"
        class="recipe-card group flex flex-col justify-between gap-4 rounded-2xl border border-dashed border-slate-300/80 bg-white/70 p-5 transition-colors hover:border-emerald-300 hover:bg-white dark:border-white/15 dark:bg-white/5 dark:hover:border-emerald-500/30 dark:hover:bg-neutral-900/70"
      >
        <div>
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="inline-flex items-center rounded-md bg-orange-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-orange-800 ring-1 ring-inset ring-orange-200/70 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900/50">
              ${this.escapeHtml(t('catalog.card.allerhandeBadge'))}
            </span>
            <span class="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500 dark:bg-white/10 dark:text-neutral-400">
              ${this.escapeHtml(t('catalog.card.external'))}
            </span>
          </div>
          <h3 class="font-display mt-3 line-clamp-2 text-base font-semibold leading-snug tracking-tight text-slate-900 transition-colors group-hover:text-emerald-700 dark:text-white dark:group-hover:text-emerald-400">
            ${this.escapeHtml(this.title(recipe))}
          </h3>
          <p class="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-slate-500 dark:text-neutral-400">
            ${this.escapeHtml(this.description(recipe))}
          </p>
        </div>
        <div class="flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-white/10">
          <span class="text-[11px] font-medium text-slate-400 dark:text-neutral-500">
            ${this.escapeHtml(t('catalog.card.noIngredients'))}
          </span>
          <span class="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            ${this.escapeHtml(t('catalog.card.allerhande'))}
            ${this.icon('arrowUpRight', 'h-3.5 w-3.5')}
          </span>
        </div>
      </a>
    `;
  }

  /**
   * Rendert de receptenkaart in het hoofdraster
   * @param {Object} recipe 
   * @param {number} servings 
   * @returns {string} HTML string
   */
  renderRecipeCard(recipe, servings = 2) {
    if (recipe.ahRecipeOnly) return this.renderAllerhandeLinkCard(recipe);

    const priceInfo = this.ahService.calculateRecipePrice(recipe, servings);
    const nutrition = recipe.nutrition;
    
    // Proteïne percentage op schaal van 0 tot 50 gram (bij 50g = 100%)
    const proteinPercent = Math.min(100, Math.round(((nutrition?.proteinGrams || 0) / 50) * 100));
    const isHighProtein = (nutrition?.proteinGrams || 0) >= 30;

    // Gezondheid percentage (0-100)
    const healthPercent = Math.min(100, Math.max(0, nutrition?.healthScore || 75));

    return `
      <article class="recipe-card group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_40px_-28px_rgba(15,23,42,0.32)] transition-all duration-300 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_2px_4px_rgba(15,23,42,0.05),0_24px_48px_-24px_rgba(15,23,42,0.32)] dark:border-white/10 dark:bg-neutral-900/70 dark:hover:border-emerald-500/30 dark:hover:shadow-none" data-recipe-id="${this.escapeHtml(recipe.id)}">
        <!-- Foto & Badges -->
        <div class="relative aspect-[16/10] overflow-hidden bg-slate-100 dark:bg-neutral-800">
          <img 
            src="${this.escapeHtml(recipe.image)}"
            alt="${this.escapeHtml(this.title(recipe))}"
            loading="lazy"
            class="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
            onerror="this.src='https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=800&q=80'"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/10 to-slate-950/25"></div>
          
          <!-- Badges bovenin -->
          <div class="absolute left-3 top-3 flex max-w-[calc(100%_-_5.5rem)] flex-wrap items-center gap-1.5">
            ${this.hasPrepTime(recipe) ? `
              <span class="inline-flex items-center gap-1 rounded-md bg-white/95 px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm backdrop-blur dark:bg-neutral-950/80 dark:text-neutral-200">
                ${this.icon('clock', 'h-3.5 w-3.5')} ${this.escapeHtml(t('recipe.minutes', { count: recipe.prepTimeMinutes }))}
              </span>
            ` : ''}
            <span class="inline-flex items-center rounded-md bg-slate-950/45 px-2 py-1 text-[11px] font-semibold text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm">
              ${this.escapeHtml(this.cuisine(recipe))}
            </span>
            ${recipe.sourceName ? `
              <span class="inline-flex items-center rounded-md bg-white/15 px-2 py-1 text-[11px] font-semibold text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm">
                ${this.escapeHtml(recipe.sourceName)}
              </span>
            ` : ''}
          </div>

          <!-- Bonus Badge -->
          ${priceInfo.hasAnyPriceData && priceInfo.hasBonus ? `
            <div class="absolute right-3 top-3">
              <span class="inline-flex items-center gap-1 rounded-md bg-amber-400 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-950 shadow-sm">
                ${this.icon('flame', 'h-3.5 w-3.5')} ${this.escapeHtml(t('catalog.card.bonus'))}
              </span>
            </div>
          ` : ''}

          <!-- Prijs Overlay onderaan de foto -->
          ${priceInfo.hasAnyPriceData ? `
            <div class="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2 text-white">
              <div>
                <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">${this.escapeHtml(t('catalog.card.priceEstimate'))}</p>
                <p class="mt-0.5 flex items-baseline gap-1.5">
                  <span class="text-xl font-bold tracking-tight">${this.ahService.formatEuro(priceInfo.totalPrice)}</span>
                  <span class="text-[11px] font-medium text-white/75">${!priceInfo.hasPriceData ? this.escapeHtml(t('catalog.card.partial')) : ''}${this.escapeHtml(t('catalog.card.perPerson', { price: this.ahService.formatEuro(priceInfo.pricePerPerson) }))}</span>
                </p>
              </div>
              ${!priceInfo.hasPriceData ? `
                <span class="rounded-md bg-white/15 px-2 py-1 text-[10px] font-semibold text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm">
                  ${this.escapeHtml(t('catalog.card.match', { matched: priceInfo.matchedIngredientCount, total: priceInfo.ingredientCount }))}
                </span>
              ` : ''}
              ${priceInfo.hasPriceData && priceInfo.totalSavings > 0 ? `
                <span class="rounded-md bg-amber-400 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-amber-950 shadow-sm">
                  ${this.escapeHtml(t('catalog.card.saving', { amount: this.ahService.formatEuro(priceInfo.totalSavings) }))}
                </span>
              ` : ''}
            </div>
          ` : `
            <div class="absolute inset-x-3 bottom-3 text-xs font-semibold text-white drop-shadow">
              ${recipe.ahRecipeOnly
                ? this.escapeHtml(t('catalog.card.noPriceAllerhande'))
                : this.isLivePriced(recipe) && !recipe.ingredients?.length
                  ? this.escapeHtml(t('catalog.card.pricing'))
                  : this.escapeHtml(t('catalog.card.noPrice'))}
            </div>
          `}
        </div>

        <!-- Kaart Inhoud -->
        <div class="flex flex-1 flex-col p-4 sm:p-5">
          <div class="flex-1">
            <h3 class="font-display line-clamp-1 text-lg font-semibold leading-snug tracking-tight text-slate-900 transition-colors group-hover:text-emerald-700 dark:text-white dark:group-hover:text-emerald-400">
              ${this.escapeHtml(this.title(recipe))}
            </h3>
            <p class="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-slate-500 dark:text-neutral-400">
              ${this.escapeHtml(this.description(recipe))}
            </p>
          </div>

          <!-- Visuele Indicatoren: Proteïne & Gezondheid -->
          ${nutrition ? `
            <dl class="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 dark:border-white/10">
              <div>
                <dt class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-400">
                  ${this.icon('dumbbell', 'h-3.5 w-3.5')} Eiwit
                </dt>
                <dd class="mt-1 flex items-baseline gap-1">
                  <span class="text-sm font-bold text-slate-800 dark:text-neutral-100">${this.escapeHtml(nutrition.proteinGrams)} g</span>
                  <span class="text-[10px] text-slate-400 dark:text-neutral-400">${this.escapeHtml(t('catalog.card.perPortion'))}</span>
                  ${isHighProtein ? '<span class="ml-auto rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-950 dark:text-blue-300">Hoog</span>' : ''}
                </dd>
                <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                  <div
                    class="h-full rounded-full transition-all duration-700 ${isHighProtein ? 'bg-gradient-to-r from-blue-500 to-indigo-600' : 'bg-blue-400'}"
                    style="width: ${proteinPercent}%"
                    title="${this.escapeHtml(nutrition.proteinGrams)} gram eiwit per portie"
                  ></div>
                </div>
              </div>

              <div>
                <dt class="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-400">
                  ${this.icon('leaf', 'h-3.5 w-3.5')} Gezondheid
                </dt>
                <dd class="mt-1 flex items-baseline gap-1">
                  <span class="text-sm font-bold ${healthPercent >= 90 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-neutral-100'}">${healthPercent}</span>
                  <span class="text-[10px] text-slate-400 dark:text-neutral-400">/ 100</span>
                </dd>
                <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                  <div
                    class="h-full rounded-full transition-all duration-700 ${healthPercent >= 90 ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-gradient-to-r from-lime-400 to-emerald-500'}"
                    style="width: ${healthPercent}%"
                    title="Gezondheidsscore: ${healthPercent}/100"
                  ></div>
                </div>
              </div>
            </dl>
          ` : ''}

          <!-- Actieknop -->
          <div class="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-white/10">
            <span class="text-[11px] font-medium text-slate-400 dark:text-neutral-500">
              ${recipe.ingredients?.length
                ? this.escapeHtml(t('catalog.card.ingredientsCount', { count: recipe.ingredients.length }))
                : this.escapeHtml(t('catalog.card.ingredientsFor', { count: servings }))}
            </span>
            ${recipe.ahRecipeOnly ? `
              <a
                class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-800 dark:border-white/10 dark:bg-white/5 dark:text-neutral-200 dark:hover:border-emerald-500/30 dark:hover:text-emerald-300"
                href="${this.escapeHtml(recipe.sourceUrl)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                ${this.escapeHtml(t('catalog.card.allerhande'))}
                ${this.icon('arrowUpRight', 'h-3.5 w-3.5')}
              </a>
            ` : `
              <button
                type="button"
                class="open-recipe-btn inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-800"
                data-recipe-id="${this.escapeHtml(recipe.id)}"
              >
                ${this.escapeHtml(t('catalog.card.details'))}
                ${this.icon('arrowRight', 'h-3.5 w-3.5')}
              </button>
            `}
          </div>
        </div>

      </article>
    `;
  }

  /**
   * Rendert de volledige pagina met AH-productopties voor één ingrediënt.
   * @param {Object} recipe
   * @param {number} index
   * @param {number} servings
   * @returns {string} HTML string
   */
  renderIngredientPage(recipe, index, servings = 2) {
    const ingredient = (recipe.ingredients || [])[index];
    if (!ingredient) return '';

    const scale = servings / (recipe.baseServings || 2);
    const scaledAmount = Number.isFinite(ingredient.amount)
      ? Math.round((ingredient.amount * scale) * 10) / 10
      : null;
    const product = ingredient.selectedAHProduct;
    const live = this.isLivePriced(recipe);
    const quantityCost = live && product
      ? this.ahService.calculateQuantityCost(ingredient, product, scale)
      : null;
    const isBonus = live ? Boolean(product?.isBonus) : Boolean(ingredient.isBonus);
    const bonusDesc = live
      ? product?.bonusDescription || t('recipe.options.bonus')
      : ingredient.bonusText || t('recipe.options.bonus');
    const visibleOptions = this.onlineAvailableOptions(ingredient);
    const optionCount = visibleOptions.length;
    const bonusCount = visibleOptions.filter(option => option.isBonus).length;
    const selectedRegularPrice = Number(product?.regularPrice);
    const selectedSavings = isBonus && Number.isFinite(selectedRegularPrice) && selectedRegularPrice > (product?.price || 0)
      ? Math.round((selectedRegularPrice - product.price) * 100) / 100
      : 0;
    const amountLabel = [
      scaledAmount === null ? '' : scaledAmount,
      ingredient.unit || '',
      ingredient.name || ''
    ].filter(part => String(part).length).join(' ');
    const selectedUnitPrice = product ? this.unitPriceLabel(product) : null;

    return `
      <div class="mx-auto max-w-4xl space-y-6 p-5 sm:p-7">
        <!-- Terug & Sluitknop -->
        <div class="flex items-center justify-between gap-3">
          <button
            type="button"
            data-ingredient-back
            class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-emerald-200 hover:text-emerald-800 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300 dark:hover:border-emerald-500/30 dark:hover:text-emerald-300"
          >
            ${this.icon('chevronLeft', 'h-3.5 w-3.5')} ${this.escapeHtml(t('recipe.options.back'))}
          </button>
          <button
            type="button"
            data-close-modal
            class="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 dark:text-neutral-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            aria-label="${this.escapeHtml(t('recipe.close'))}"
          >
            ${this.icon('close', 'h-5 w-5')}
          </button>
        </div>

        <!-- Kop -->
        <div>
          <p class="eyebrow">${this.escapeHtml(t('recipe.options.eyebrow'))}</p>
          <h2 class="font-display mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            ${this.escapeHtml(amountLabel)}
          </h2>
          <p class="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-neutral-400">
            ${isBonus
              ? `<span class="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-1 font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">${this.icon('flame', 'h-3 w-3')} ${this.escapeHtml(bonusDesc)}${selectedSavings > 0 ? ` · −${this.ahService.formatEuro(selectedSavings)}` : ''}</span>`
              : ''}
            <span>${optionCount > 0
              ? this.escapeHtml(t(optionCount === 1 ? 'recipe.options.availableOne' : 'recipe.options.availableMany', { count: optionCount }))
              : this.escapeHtml(t('recipe.options.none'))}</span>
            ${bonusCount > 0 ? `<span aria-hidden="true">·</span><span class="font-semibold text-amber-700 dark:text-amber-300">${this.escapeHtml(t('recipe.options.withBonus', { count: bonusCount }))}</span>` : ''}
            ${quantityCost ? `<span aria-hidden="true">·</span><span class="tabular-nums">${this.escapeHtml(t('recipe.options.used', { amount: this.ahService.formatEuro(quantityCost.current) }))}</span>` : ''}
            ${selectedUnitPrice ? `
              <span aria-hidden="true">·</span>
              <span class="inline-flex items-baseline gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600 tabular-nums dark:bg-white/10 dark:text-neutral-300">
                ${this.escapeHtml(selectedUnitPrice.current)}
                ${selectedUnitPrice.regular ? `<span class="font-normal text-slate-400 line-through dark:text-neutral-500">${this.escapeHtml(selectedUnitPrice.regular)}</span>` : ''}
              </span>
            ` : ''}
          </p>
        </div>

        <!-- Opties -->
        <section class="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-neutral-900/40 sm:p-4">
          <p class="flex items-center justify-between gap-2 px-1 pb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-400">
            <span>${this.escapeHtml(t('recipe.options.choose'))}</span>
            <span class="inline-flex items-center gap-1 normal-case tracking-normal text-amber-700 dark:text-amber-300">
              ${this.icon('flame', 'h-3 w-3')} ${this.escapeHtml(t('recipe.options.bonusShown'))}
            </span>
          </p>
          ${this.onlineAvailableOptions(ingredient).some(option => option.matchesIngredient !== false) ? '' : `
            <p class="mb-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              ${this.escapeHtml(t('recipe.options.noMatch'))}
            </p>
          `}
          <p class="mb-2 px-1 text-[11px] leading-relaxed text-slate-400 dark:text-neutral-400">
            ${this.escapeHtml(t('recipe.options.holdHint'))}
          </p>
          <p data-selection-status role="status" aria-live="polite" class="mb-2 hidden rounded-lg bg-emerald-50 px-2.5 py-2 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"></p>
          ${this.renderIngredientProducts(ingredient, product)}
        </section>
      </div>
    `;
  }

  /**
   * Rendert het modale dialoogvenster als twee volledige pagina's die
   * horizontaal in elkaar schuiven: het recept en de AH-opties van een ingrediënt.
   * @param {Object} recipe
   * @param {number} servings
   * @param {{ ingredientIndex?: number|null }} uiState
   * @returns {string} HTML string
   */
  renderRecipeModal(recipe, servings = 2, uiState = {}) {
    const activeIngredientIndex = Number.isInteger(uiState.ingredientIndex) ? uiState.ingredientIndex : null;
    const showsIngredientOptions = activeIngredientIndex !== null;
    return `
      <div id="recipe-viewport" class="recipe-viewport" data-active-panel="${showsIngredientOptions ? 'ingredient' : 'recipe'}">
        <div data-panel="recipe" class="recipe-panel"${showsIngredientOptions ? ' aria-hidden="true" inert' : ''}>
          ${this.renderRecipePage(recipe, servings)}
        </div>
        <div data-panel="ingredient" class="recipe-panel"${showsIngredientOptions ? '' : ' aria-hidden="true" inert'}>
          ${showsIngredientOptions ? this.renderIngredientPage(recipe, activeIngredientIndex, servings) : ''}
        </div>
      </div>
    `;
  }

  /**
   * Rendert de volledige receptpagina.
   * @param {Object} recipe
   * @param {number} servings
   * @returns {string} HTML string
   */
  renderRecipePage(recipe, servings = 2) {
    const scale = servings / (recipe.baseServings || 2);
    const priceInfo = this.ahService.calculateRecipePrice(recipe, servings);
    const nutrition = recipe.nutrition;

    return `
      <div class="mx-auto max-w-4xl space-y-6 p-5 sm:p-7">
        <!-- Header & Sluitknop -->
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="mb-2 flex flex-wrap items-center gap-2">
              <span class="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-800/60">
                ${this.escapeHtml(this.cuisine(recipe))}
              </span>
              ${this.hasPrepTime(recipe) ? `
                <span class="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-white/5 dark:text-neutral-300">
                  ${this.icon('clock', 'h-3.5 w-3.5')} ${this.escapeHtml(t('recipe.minutes', { count: recipe.prepTimeMinutes }))}
                </span>
              ` : ''}
              <span class="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-white/5 dark:text-neutral-300">
                ${this.icon('star', 'h-3.5 w-3.5')} ${this.escapeHtml(this.difficulty(recipe))}
              </span>
              ${priceInfo.hasPriceData && priceInfo.hasBonus ? `
                <span class="inline-flex items-center gap-1 rounded-md bg-amber-400 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-950 shadow-sm">
                  ${this.icon('flame', 'h-3.5 w-3.5')} ${this.escapeHtml(t('catalog.card.bonus'))}
                </span>
              ` : ''}
            </div>
            <h2 class="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              ${this.escapeHtml(this.title(recipe))}
            </h2>
            <p class="text-sm text-slate-600 dark:text-neutral-300 mt-1">
              ${this.escapeHtml(this.description(recipe))}
            </p>
            ${recipe.sourceUrl ? `
              <a href="${this.escapeHtml(recipe.sourceUrl)}" target="_blank" rel="noopener noreferrer"
                class="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:underline dark:text-emerald-400">
                ${this.escapeHtml(t('recipe.originalOn', { source: recipe.sourceName || '' }))}
                ${this.icon('arrowUpRight', 'h-3.5 w-3.5')}
              </a>
            ` : ''}
          </div>
          <button 
            type="button" 
            id="close-modal-btn" 
            class="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 dark:text-neutral-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            aria-label="${this.escapeHtml(t('recipe.close'))}"
          >
            ${this.icon('close', 'h-5 w-5')}
          </button>
        </div>

        <!-- Portie Schakelaar & AH Prijs Banner -->
        <div class="flex flex-col items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-gradient-to-r from-slate-50 to-emerald-50/50 p-4 dark:border-white/10 dark:from-neutral-800 dark:to-neutral-800/80 sm:flex-row">
          <!-- Portie selector -->
          <div class="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-start">
            <span class="text-sm font-semibold text-slate-700 dark:text-neutral-200">
              ${this.escapeHtml(t('recipe.persons'))}
            </span>
            <div class="inline-flex items-center overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm dark:border-white/15 dark:bg-neutral-900">
              <button 
                type="button" 
                id="modal-portion-minus" 
                class="px-3.5 py-1.5 font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-neutral-800"
                ${servings <= 1 ? 'disabled' : ''}
                aria-label="${this.escapeHtml(t('portions.less'))}"
              >
                −
              </button>
              <span id="modal-portion-count" class="min-w-[3rem] px-4 py-1.5 text-center text-sm font-bold text-emerald-700 dark:text-emerald-400">
                ${this.escapeHtml(t('recipe.personsShort', { count: servings }))}
              </span>
              <button 
                type="button" 
                id="modal-portion-plus" 
                class="px-3.5 py-1.5 font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-neutral-800"
                ${servings >= 8 ? 'disabled' : ''}
                aria-label="${this.escapeHtml(t('portions.more'))}"
              >
                +
              </button>
            </div>
          </div>

          <!-- AH Prijs Samenvatting -->
          ${priceInfo.hasAnyPriceData ? `
          <div class="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
            <div class="text-right">
              <div class="text-[11px] font-medium text-slate-500 dark:text-neutral-400">
                ${priceInfo.hasPriceData
                  ? this.escapeHtml(t('recipe.priceEstimate', { count: servings }))
                  : this.escapeHtml(t('recipe.partialPrice', {
                    matched: priceInfo.matchedIngredientCount,
                    total: priceInfo.ingredientCount,
                    priced: priceInfo.pricedIngredientCount
                  }))}
              </div>
              <div class="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                ${this.ahService.formatEuro(priceInfo.totalPrice)}
                <span class="text-xs font-medium text-slate-500 dark:text-neutral-400">${this.escapeHtml(t('catalog.card.perPerson', { price: this.ahService.formatEuro(priceInfo.pricePerPerson) }))}</span>
              </div>
            </div>
            ${priceInfo.hasPriceData && priceInfo.totalSavings > 0 ? `
              <div class="rounded-xl border border-amber-300 bg-amber-100 px-3 py-1.5 text-right dark:border-amber-700 dark:bg-amber-950/70">
                <div class="text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">${this.escapeHtml(t('recipe.bonusSaving'))}</div>
                <div class="text-sm font-extrabold text-amber-700 dark:text-amber-400">−${this.ahService.formatEuro(priceInfo.totalSavings)}</div>
              </div>
            ` : ''}
          </div>
          ` : `
          <p class="w-full text-sm text-slate-500 dark:text-neutral-400 sm:w-auto">
            ${this.escapeHtml(t('recipe.noPrice'))}
          </p>
          `}
        </div>
        ${this.isLivePriced(recipe) && recipe.priceUpdatedAt ? `
          <p class="text-xs text-slate-500 dark:text-neutral-400 -mt-4">
            ${recipe.ingredients?.some(ingredient => ingredient.productLookupStale)
              ? this.escapeHtml(t('recipe.stalePrices'))
              : this.escapeHtml(t('recipe.updatedAt', { date: this.formatTimestamp(recipe.priceUpdatedAt) }))}
          </p>
        ` : ''}

        <!-- Voedingswaarden dashboard -->
        ${nutrition ? `
        <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div class="surface-inset p-3 text-center">
            <span class="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-400">${this.escapeHtml(t('recipe.calories'))}</span>
            <span class="mt-1 block text-lg font-bold text-slate-800 dark:text-neutral-100">${this.escapeHtml(nutrition.calories)} <span class="text-xs font-normal text-slate-400 dark:text-neutral-400">kcal</span></span>
          </div>
          <div class="rounded-[0.875rem] border border-blue-100/80 bg-blue-50/50 p-3 text-center dark:border-blue-900/40 dark:bg-blue-950/30">
            <span class="block text-[10px] font-bold uppercase tracking-[0.12em] text-blue-600 dark:text-blue-400">${this.escapeHtml(t('recipe.protein'))}</span>
            <span class="mt-1 block text-lg font-bold text-blue-700 dark:text-blue-300">${this.escapeHtml(nutrition.proteinGrams)} g</span>
          </div>
          <div class="surface-inset p-3 text-center">
            <span class="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-400">${this.escapeHtml(t('recipe.carbs'))}</span>
            <span class="mt-1 block text-lg font-bold text-slate-800 dark:text-neutral-100">${this.escapeHtml(nutrition.carbsGrams)} g</span>
          </div>
          <div class="surface-inset p-3 text-center">
            <span class="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-400">${this.escapeHtml(t('recipe.fat'))}</span>
            <span class="mt-1 block text-lg font-bold text-slate-800 dark:text-neutral-100">${this.escapeHtml(nutrition.fatGrams)} g</span>
          </div>
        </div>
        ` : ''}

        <!-- Twee Kolommen: Ingrediënten & Bereiding -->
        <div class="grid grid-cols-1 gap-6 md:grid-cols-12">
          <!-- Ingrediëntenlijst (5 kolommen op desktop) -->
          <div class="space-y-3 md:col-span-5">
            <h3 class="flex items-center justify-between text-sm font-bold text-slate-800 dark:text-neutral-100">
              <span class="inline-flex items-center gap-2">${this.icon('basket', 'h-4 w-4 text-emerald-700 dark:text-emerald-400')} ${this.escapeHtml(t('recipe.ingredients'))}</span>
              <span class="text-[11px] font-normal text-slate-400 dark:text-neutral-400">${this.escapeHtml(t('recipe.ingredientsHint'))}</span>
            </h3>
            <ul class="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:divide-white/10 dark:border-white/10 dark:bg-neutral-800/60">
              ${(recipe.ingredients || []).map((ing, index) => {
                const scaledAmount = Number.isFinite(ing.amount)
                  ? Math.round((ing.amount * scale) * 10) / 10
                  : null;
                const product = ing.selectedAHProduct;
                const live = this.isLivePriced(recipe);
                const quantityCost = live && product
                  ? this.ahService.calculateQuantityCost(ing, product, scale)
                  : null;
                const isBonus = live ? Boolean(product?.isBonus) : Boolean(ing.isBonus);
                const price = live ? product?.price : ing.standardPrice;
                const bonusDesc = live
                  ? product?.bonusDescription || t('recipe.options.bonus')
                  : ing.bonusText || t('recipe.options.bonus');
                const optionCount = this.onlineAvailableOptions(ing).length;
                const rowSavings = isBonus && quantityCost && Number.isFinite(quantityCost.regular) &&
                  quantityCost.regular > quantityCost.current
                  ? Math.round((quantityCost.regular - quantityCost.current) * 100) / 100
                  : 0;

                return `
                  <li>
                    <button
                      type="button"
                      data-ingredient-open="${index}"
                      aria-label="Bekijk AH-producten voor ${this.escapeHtml(ing.name || 'dit ingrediënt')}"
                      class="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50 focus-visible:bg-slate-50 dark:hover:bg-white/5 dark:focus-visible:bg-white/5"
                    >
                      <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400 dark:bg-white/10 dark:text-neutral-500">
                        ${this.icon('basket', 'h-4 w-4')}
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-semibold text-slate-800 dark:text-neutral-100">
                          ${scaledAmount === null ? '' : `<span class="tabular-nums">${this.escapeHtml(scaledAmount)}</span> `}${this.escapeHtml(ing.unit)} ${this.escapeHtml(this.ingredientName(ing))}
                        </span>
                        <span class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 dark:text-neutral-400">
                          ${isBonus
                            ? `<span class="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">${this.icon('flame', 'h-3 w-3')} ${this.escapeHtml(bonusDesc)}${rowSavings > 0 ? ` · −${this.ahService.formatEuro(rowSavings)}` : ''}</span>`
                            : ''}
                          <span>${optionCount > 0
                            ? this.escapeHtml(t(optionCount === 1 ? 'recipe.options.optionsOne' : 'recipe.options.optionsMany', { count: optionCount }))
                            : this.escapeHtml(t('recipe.options.viewProduct'))}</span>
                        </span>
                      </span>
                      <span class="flex shrink-0 items-center gap-1.5">
                        ${live && quantityCost ? `
                          <span class="text-right">
                            <span class="block text-xs font-bold tabular-nums ${isBonus ? 'text-amber-700 dark:text-amber-300' : 'text-slate-700 dark:text-neutral-300'}">
                              ${this.ahService.formatEuro(quantityCost.current)}
                            </span>
                            ${rowSavings > 0 ? `<span class="block text-[10px] tabular-nums text-slate-400 dark:text-neutral-400 line-through">${this.ahService.formatEuro(quantityCost.regular)}</span>` : ''}
                          </span>
                        ` : !live && Number.isFinite(price) && price > 0 ? `
                          <span class="text-xs font-bold tabular-nums text-slate-700 dark:text-neutral-300">
                            ${this.ahService.formatEuro(price * scale)}
                          </span>
                        ` : ''}
                        ${this.icon('chevronRight', 'h-4 w-4 text-slate-400')}
                      </span>
                    </button>
                  </li>
                `;
              }).join('')}
            </ul>
          </div>

          <!-- Bereidingswijze (7 kolommen op desktop) -->
          <div class="space-y-3 md:col-span-7">
            <h3 class="flex items-center justify-between text-sm font-bold text-slate-800 dark:text-neutral-100">
              <span class="inline-flex items-center gap-2">${this.icon('list', 'h-4 w-4 text-emerald-700 dark:text-emerald-400')} ${this.escapeHtml(t('recipe.instructions'))}</span>
              <span class="text-[11px] font-normal text-slate-400 dark:text-neutral-400">${this.escapeHtml(t('recipe.instructionsHint'))}</span>
            </h3>
            <ol class="space-y-2.5">
              ${this.instructions(recipe).map((step, idx) => `
                <li class="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-white p-3.5 text-sm leading-relaxed text-slate-700 shadow-sm dark:border-white/10 dark:bg-neutral-800/60 dark:text-neutral-300">
                  <span class="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-800/60">
                    ${idx + 1}
                  </span>
                  <span class="flex-1">${this.escapeHtml(step)}</span>
                </li>
              `).join('')}
            </ol>
          </div>
        </div>

        <!-- Gemini AI Kookhulp Sectie -->
        <div class="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-purple-50/50 p-4 shadow-sm dark:border-indigo-900/50 dark:from-neutral-800/90 dark:via-neutral-800 dark:to-indigo-950/40 sm:p-5">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <span class="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white shadow-sm">
                ${this.icon('sparkles', 'h-4 w-4')}
              </span>
              <div>
                <h4 class="text-sm font-bold text-slate-900 dark:text-white sm:text-base">
                  ${this.escapeHtml(t('ai.title'))}
                </h4>
                <p class="text-xs text-slate-500 dark:text-neutral-400">
                  ${this.escapeHtml(t('ai.subtitle'))}
                </p>
              </div>
            </div>
            ${!this.geminiService.hasApiKey() ? `
              <button 
                type="button" 
                class="open-settings-btn inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300"
              >
                ${this.icon('key', 'h-3.5 w-3.5')} ${this.escapeHtml(t('ai.keyButton'))}
              </button>
            ` : ''}
          </div>

          <!-- Snelkeuze vragen knoppen -->
          <div class="mb-3 flex flex-wrap gap-1.5">
            <button type="button" class="gemini-quick-btn rounded-lg border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-indigo-900/50" data-prompt="Hoe kan ik dit gerecht nóg eiwitrijker maken zonder veel extra calorieën?">
              ${this.escapeHtml(t('ai.quick.protein'))}
            </button>
            <button type="button" class="gemini-quick-btn rounded-lg border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-indigo-900/50" data-prompt="Wat kan ik vervangen als ik bepaalde ingrediënten niet lust of in huis heb?">
              ${this.escapeHtml(t('ai.quick.replace'))}
            </button>
            <button type="button" class="gemini-quick-btn rounded-lg border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-indigo-900/50" data-prompt="Welke wijn, bier of alcoholvrije drank past perfect bij de smaken van dit gerecht?">
              ${this.escapeHtml(t('ai.quick.wine'))}
            </button>
            <button type="button" class="gemini-quick-btn rounded-lg border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-indigo-900/50" data-prompt="Hoe kan ik dit recept het makkelijkst omtoveren tot een 100% vegetarische of plantaardige variant?">
              ${this.escapeHtml(t('ai.quick.veg'))}
            </button>
          </div>

          <!-- Chat antwoord venster -->
          <div id="gemini-response-area" class="mb-3 hidden max-h-60 overflow-y-auto whitespace-pre-line rounded-xl border border-indigo-100 bg-white p-3.5 text-sm leading-relaxed text-slate-800 shadow-inner dark:border-indigo-950 dark:bg-neutral-900 dark:text-neutral-200"></div>

          <!-- Chat invoer veld -->
          <form id="gemini-ask-form" class="flex gap-2">
            <label for="gemini-question-input" class="sr-only">${this.escapeHtml(t('ai.label'))}</label>
            <input 
              type="text" 
              id="gemini-question-input" 
              placeholder="${this.escapeHtml(this.geminiService.hasApiKey() ? t('ai.placeholder') : t('ai.placeholderDisabled'))}"
              class="flex-1 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2 text-sm text-slate-800 transition placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
              ${!this.geminiService.hasApiKey() ? 'disabled' : ''}
            />
            <button 
              type="submit" 
              id="gemini-submit-btn" 
              class="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              ${!this.geminiService.hasApiKey() ? 'disabled' : ''}
            >
              <span>${this.escapeHtml(t('ai.ask'))}</span>
              <span id="gemini-spinner" class="hidden h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true"></span>
            </button>
          </form>
        </div>
      </div>
    `;
  }
}
