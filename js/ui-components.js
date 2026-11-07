import { escapeHtml } from './utils.js';

/**
 * UI Components - Rendert receptenkaarten, modalen, balkjes en interactieve elementen
 */
export class UIComponents {
  constructor(ahService, geminiService, recipesService) {
    this.ahService = ahService;
    this.geminiService = geminiService;
    this.recipesService = recipesService;
  }

  escapeHtml(value) {
    return escapeHtml(value);
  }

  formatTimestamp(value) {
    if (!value) return 'nog niet opgehaald';
    return new Intl.DateTimeFormat('nl-NL', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
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
    const query = this.recipesService.getAHSearchQuery(ingredient.name);
    return `https://www.ah.nl/zoeken?query=${encodeURIComponent(query)}`;
  }

  /**
   * Rendert een klikbare lijst met geschikte AH-producten voor een ingrediënt.
   * Elk product linkt naar de AH-winkelpagina.
   * @param {Object} ingredient
   * @param {Object|null} selectedProduct
   * @returns {string} HTML string
   */
  renderIngredientProducts(ingredient, selectedProduct) {
    const options = ingredient.ahProductOptions || [];
    const isExternal = options.length > 0 ||
      Boolean(ingredient.productLookupAt || ingredient.selectedAHProduct || ingredient.productLookupError);

    if (options.length > 0) {
      // Toon het geselecteerde product bovenaan, daarna de rest.
      const sorted = [...options].sort((a, b) => {
        const aSelected = a.id === selectedProduct?.id;
        const bSelected = b.id === selectedProduct?.id;
        return Number(bSelected) - Number(aSelected);
      });

      const rows = sorted.map(option => {
        const isSelected = option.id === selectedProduct?.id;
        const url = option.productUrl || this.buildAHSearchUrl(ingredient);
        const bonusDescription = String(option.bonusDescription || '').trim();
        const bonusLabel = bonusDescription
          ? bonusDescription.charAt(0).toLocaleUpperCase('nl-NL') + bonusDescription.slice(1)
          : 'Bonus';
        const regularPrice = Number(option.regularPrice);
        const hasDiscount = Boolean(option.isBonus) &&
          Number.isFinite(regularPrice) && regularPrice > option.price;
        const savings = hasDiscount ? Math.round((regularPrice - option.price) * 100) / 100 : 0;
        const metaParts = [option.unitSize, option.isOnlineOnly ? 'alleen online' : '', option.cachedMatch ? 'cache' : '']
          .filter(Boolean)
          .map(part => this.escapeHtml(part));
        const selectedRing = isSelected
          ? 'border-emerald-400 bg-emerald-50/60 ring-1 ring-inset ring-emerald-500/15 dark:border-emerald-600 dark:bg-emerald-950/25 dark:ring-emerald-500/20'
          : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30 dark:border-white/10 dark:bg-neutral-900/50 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/15';
        return `
          <a href="${this.escapeHtml(url)}"
            target="_blank" rel="noopener noreferrer"
            title="${this.escapeHtml(option.title)} bekijken bij Albert Heijn"
            class="block rounded-xl border px-3 py-2.5 transition ${selectedRing}">
            <span class="flex items-start justify-between gap-2">
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="truncate text-xs font-semibold text-slate-800 dark:text-neutral-100">${this.escapeHtml(option.title)}</span>
                  ${isSelected ? '<span class="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">Gekozen</span>' : ''}
                </span>
                <span class="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] text-slate-400 dark:text-neutral-400">
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
        ? `<span class="block mt-1 text-[10px] text-rose-600 dark:text-rose-400">AH zoeken mislukt: ${this.escapeHtml(ingredient.productLookupError)}</span>`
        : '';
      return `
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] text-slate-400 dark:text-neutral-400">AH-zoekresultaten niet beschikbaar</span>
          <a href="${this.escapeHtml(this.buildAHSearchUrl(ingredient))}"
            target="_blank" rel="noopener noreferrer"
            class="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-emerald-700 hover:underline dark:text-emerald-400">
            Zoek bij AH ${this.icon('arrowUpRight', 'h-3 w-3')}
          </a>
        </div>
        ${errorBlock}
      `;
    }

    // Eigen (ingebouwd) recept met vaste AH-productnaam.
    return `
      <div class="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-neutral-400">
        <span class="truncate">${this.escapeHtml(ingredient.ahName || 'AH artikel')}</span>
        <a href="${this.escapeHtml(this.buildAHSearchUrl(ingredient))}"
          target="_blank" rel="noopener noreferrer"
          class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-emerald-700 transition hover:border-emerald-300 dark:border-white/10 dark:bg-neutral-900 dark:text-emerald-400 dark:hover:border-emerald-700">
          Shop bij AH ${this.icon('arrowUpRight', 'h-3 w-3')}
        </a>
      </div>
    `;
  }

  /**
   * Rendert de receptenkaart in het hoofdraster
   * @param {Object} recipe 
   * @param {number} servings 
   * @returns {string} HTML string
   */
  renderRecipeCard(recipe, servings = 2) {
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
            alt="${this.escapeHtml(recipe.title)}"
            loading="lazy"
            class="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
            onerror="this.src='https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=800&q=80'"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/10 to-slate-950/25"></div>
          
          <!-- Badges bovenin -->
          <div class="absolute left-3 top-3 flex max-w-[calc(100%_-_5.5rem)] flex-wrap items-center gap-1.5">
            <span class="inline-flex items-center gap-1 rounded-md bg-white/95 px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm backdrop-blur dark:bg-neutral-950/80 dark:text-neutral-200">
              ${this.icon('clock', 'h-3.5 w-3.5')} ${this.escapeHtml(recipe.prepTimeMinutes || '—')} min
            </span>
            <span class="inline-flex items-center rounded-md bg-slate-950/45 px-2 py-1 text-[11px] font-semibold text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm">
              ${this.escapeHtml(recipe.cuisine)}
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
                ${this.icon('flame', 'h-3.5 w-3.5')} AH Bonus
              </span>
            </div>
          ` : ''}

          <!-- Prijs Overlay onderaan de foto -->
          ${priceInfo.hasAnyPriceData ? `
            <div class="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2 text-white">
              <div>
                <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">Prijsindicatie</p>
                <p class="mt-0.5 flex items-baseline gap-1.5">
                  <span class="text-xl font-bold tracking-tight">${this.ahService.formatEuro(priceInfo.totalPrice)}</span>
                  <span class="text-[11px] font-medium text-white/75">${!priceInfo.hasPriceData ? 'gedeeltelijk · ' : ''}${this.ahService.formatEuro(priceInfo.pricePerPerson)} p.p.</span>
                </p>
              </div>
              ${!priceInfo.hasPriceData ? `
                <span class="rounded-md bg-white/15 px-2 py-1 text-[10px] font-semibold text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm">
                  Match ${priceInfo.matchedIngredientCount}/${priceInfo.ingredientCount}
                </span>
              ` : ''}
              ${priceInfo.hasPriceData && priceInfo.totalSavings > 0 ? `
                <span class="rounded-md bg-amber-400 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-amber-950 shadow-sm">
                  −${this.ahService.formatEuro(priceInfo.totalSavings)} voordeel
                </span>
              ` : ''}
            </div>
          ` : `
            <div class="absolute inset-x-3 bottom-3 text-xs font-semibold text-white drop-shadow">
              ${recipe.ahRecipeOnly
                ? 'Open bij Allerhande voor ingrediënten en prijzen'
                : this.isLivePriced(recipe) && !recipe.ingredients?.length
                  ? 'AH-prijzen worden berekend'
                  : 'AH-prijs niet beschikbaar'}
            </div>
          `}
        </div>

        <!-- Kaart Inhoud -->
        <div class="flex flex-1 flex-col p-4 sm:p-5">
          <div class="flex-1">
            <h3 class="font-display line-clamp-1 text-lg font-semibold leading-snug tracking-tight text-slate-900 transition-colors group-hover:text-emerald-700 dark:text-white dark:group-hover:text-emerald-400">
              ${this.escapeHtml(recipe.title)}
            </h3>
            <p class="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-slate-500 dark:text-neutral-400">
              ${this.escapeHtml(recipe.description)}
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
                  <span class="text-[10px] text-slate-400 dark:text-neutral-400">/ p.p.</span>
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
              Berekend voor ${servings} personen
            </span>
            ${recipe.ahRecipeOnly ? `
              <a
                class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-800 dark:border-white/10 dark:bg-white/5 dark:text-neutral-200 dark:hover:border-emerald-500/30 dark:hover:text-emerald-300"
                href="${this.escapeHtml(recipe.sourceUrl)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                Bekijk op Allerhande
                ${this.icon('arrowUpRight', 'h-3.5 w-3.5')}
              </a>
            ` : `
              <button
                type="button"
                class="open-recipe-btn inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-800"
                data-recipe-id="${this.escapeHtml(recipe.id)}"
              >
                Kookhulp &amp; details
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
      ? product?.bonusDescription || 'Bonus'
      : ingredient.bonusText || 'Bonus';
    const optionCount = (ingredient.ahProductOptions || []).length;
    const bonusCount = (ingredient.ahProductOptions || []).filter(option => option.isBonus).length;
    const selectedRegularPrice = Number(product?.regularPrice);
    const selectedSavings = isBonus && Number.isFinite(selectedRegularPrice) && selectedRegularPrice > (product?.price || 0)
      ? Math.round((selectedRegularPrice - product.price) * 100) / 100
      : 0;
    const amountLabel = [
      scaledAmount === null ? '' : scaledAmount,
      ingredient.unit || '',
      ingredient.name || ''
    ].filter(part => String(part).length).join(' ');

    return `
      <div class="mx-auto max-w-4xl space-y-6 p-5 sm:p-7">
        <!-- Terug & Sluitknop -->
        <div class="flex items-center justify-between gap-3">
          <button
            type="button"
            data-ingredient-back
            class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-emerald-200 hover:text-emerald-800 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300 dark:hover:border-emerald-500/30 dark:hover:text-emerald-300"
          >
            ${this.icon('chevronLeft', 'h-3.5 w-3.5')} Terug naar recept
          </button>
          <button
            type="button"
            data-close-modal
            class="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 dark:text-neutral-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            aria-label="Sluiten"
          >
            ${this.icon('close', 'h-5 w-5')}
          </button>
        </div>

        <!-- Kop -->
        <div>
          <p class="eyebrow">Ingrediënt uit dit recept</p>
          <h2 class="font-display mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            ${this.escapeHtml(amountLabel)}
          </h2>
          <p class="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-neutral-400">
            ${isBonus
              ? `<span class="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-1 font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">${this.icon('flame', 'h-3 w-3')} ${this.escapeHtml(bonusDesc)}${selectedSavings > 0 ? ` · −${this.ahService.formatEuro(selectedSavings)}` : ''}</span>`
              : ''}
            <span>${optionCount > 0
              ? `${optionCount} AH-${optionCount === 1 ? 'optie' : 'opties'} beschikbaar`
              : 'Bekijk beschikbare AH-producten'}</span>
            ${bonusCount > 0 ? `<span aria-hidden="true">·</span><span class="font-semibold text-amber-700 dark:text-amber-300">${bonusCount} met bonus</span>` : ''}
            ${quantityCost ? `<span aria-hidden="true">·</span><span class="tabular-nums">${this.ahService.formatEuro(quantityCost.current)} gebruikt</span>` : ''}
          </p>
        </div>

        <!-- Opties -->
        <section class="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-neutral-900/40 sm:p-4">
          <p class="flex items-center justify-between gap-2 px-1 pb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-400">
            <span>Kies een product en open het bij AH</span>
            <span class="inline-flex items-center gap-1 normal-case tracking-normal text-amber-700 dark:text-amber-300">
              ${this.icon('flame', 'h-3 w-3')} bonus getoond
            </span>
          </p>
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
                ${this.escapeHtml(recipe.cuisine)}
              </span>
              <span class="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-white/5 dark:text-neutral-300">
                ${this.icon('clock', 'h-3.5 w-3.5')} ${this.escapeHtml(recipe.prepTimeMinutes || '—')} minuten
              </span>
              <span class="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-white/5 dark:text-neutral-300">
                ${this.icon('star', 'h-3.5 w-3.5')} ${this.escapeHtml(recipe.difficulty)}
              </span>
              ${priceInfo.hasPriceData && priceInfo.hasBonus ? `
                <span class="inline-flex items-center gap-1 rounded-md bg-amber-400 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-950 shadow-sm">
                  ${this.icon('flame', 'h-3.5 w-3.5')} Bonus deal
                </span>
              ` : ''}
            </div>
            <h2 class="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              ${this.escapeHtml(recipe.title)}
            </h2>
            <p class="text-sm text-slate-600 dark:text-neutral-300 mt-1">
              ${this.escapeHtml(recipe.description)}
            </p>
            ${recipe.sourceUrl ? `
              <a href="${this.escapeHtml(recipe.sourceUrl)}" target="_blank" rel="noopener noreferrer"
                class="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:underline dark:text-emerald-400">
                Bekijk het originele recept op ${this.escapeHtml(recipe.sourceName || 'de bron')}
                ${this.icon('arrowUpRight', 'h-3.5 w-3.5')}
              </a>
            ` : ''}
          </div>
          <button 
            type="button" 
            id="close-modal-btn" 
            class="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 dark:text-neutral-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            aria-label="Sluiten"
          >
            ${this.icon('close', 'h-5 w-5')}
          </button>
        </div>

        <!-- Portie Schakelaar & AH Prijs Banner -->
        <div class="flex flex-col items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-gradient-to-r from-slate-50 to-emerald-50/50 p-4 dark:border-white/10 dark:from-neutral-800 dark:to-neutral-800/80 sm:flex-row">
          <!-- Portie selector -->
          <div class="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-start">
            <span class="text-sm font-semibold text-slate-700 dark:text-neutral-200">
              Aantal personen
            </span>
            <div class="inline-flex items-center overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm dark:border-white/15 dark:bg-neutral-900">
              <button 
                type="button" 
                id="modal-portion-minus" 
                class="px-3.5 py-1.5 font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-neutral-800"
                ${servings <= 1 ? 'disabled' : ''}
                aria-label="1 persoon minder"
              >
                −
              </button>
              <span id="modal-portion-count" class="min-w-[3rem] px-4 py-1.5 text-center text-sm font-bold text-emerald-700 dark:text-emerald-400">
                ${servings} pers.
              </span>
              <button 
                type="button" 
                id="modal-portion-plus" 
                class="px-3.5 py-1.5 font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-neutral-800"
                ${servings >= 8 ? 'disabled' : ''}
                aria-label="1 persoon meer"
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
                  ? `AH-prijsindicatie (${servings} pers.)`
                  : `Gedeeltelijke prijs · ${priceInfo.matchedIngredientCount}/${priceInfo.ingredientCount} matches, ${priceInfo.pricedIngredientCount} berekend`}
              </div>
              <div class="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                ${this.ahService.formatEuro(priceInfo.totalPrice)}
                <span class="text-xs font-medium text-slate-500 dark:text-neutral-400">(${this.ahService.formatEuro(priceInfo.pricePerPerson)} p.p.)</span>
              </div>
            </div>
            ${priceInfo.hasPriceData && priceInfo.totalSavings > 0 ? `
              <div class="rounded-xl border border-amber-300 bg-amber-100 px-3 py-1.5 text-right dark:border-amber-700 dark:bg-amber-950/70">
                <div class="text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">Bonusvoordeel</div>
                <div class="text-sm font-extrabold text-amber-700 dark:text-amber-400">−${this.ahService.formatEuro(priceInfo.totalSavings)}</div>
              </div>
            ` : ''}
          </div>
          ` : `
          <p class="w-full text-sm text-slate-500 dark:text-neutral-400 sm:w-auto">
            AH-prijzen zijn niet beschikbaar voor dit externe recept.
          </p>
          `}
        </div>
        ${this.isLivePriced(recipe) && recipe.priceUpdatedAt ? `
          <p class="text-xs text-slate-500 dark:text-neutral-400 -mt-4">
            ${recipe.ingredients?.some(ingredient => ingredient.productLookupStale)
              ? 'AH was niet bereikbaar; deels getoonde productgegevens komen uit de cache.'
              : 'Laatst bijgewerkt: ' + this.formatTimestamp(recipe.priceUpdatedAt)}
          </p>
        ` : ''}

        <!-- Voedingswaarden dashboard -->
        ${nutrition ? `
        <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div class="surface-inset p-3 text-center">
            <span class="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-400">Calorieën p.p.</span>
            <span class="mt-1 block text-lg font-bold text-slate-800 dark:text-neutral-100">${this.escapeHtml(nutrition.calories)} <span class="text-xs font-normal text-slate-400 dark:text-neutral-400">kcal</span></span>
          </div>
          <div class="rounded-[0.875rem] border border-blue-100/80 bg-blue-50/50 p-3 text-center dark:border-blue-900/40 dark:bg-blue-950/30">
            <span class="block text-[10px] font-bold uppercase tracking-[0.12em] text-blue-600 dark:text-blue-400">Eiwit p.p.</span>
            <span class="mt-1 block text-lg font-bold text-blue-700 dark:text-blue-300">${this.escapeHtml(nutrition.proteinGrams)} g</span>
          </div>
          <div class="surface-inset p-3 text-center">
            <span class="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-400">Koolhydraten p.p.</span>
            <span class="mt-1 block text-lg font-bold text-slate-800 dark:text-neutral-100">${this.escapeHtml(nutrition.carbsGrams)} g</span>
          </div>
          <div class="surface-inset p-3 text-center">
            <span class="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-400">Vetten p.p.</span>
            <span class="mt-1 block text-lg font-bold text-slate-800 dark:text-neutral-100">${this.escapeHtml(nutrition.fatGrams)} g</span>
          </div>
        </div>
        ` : ''}

        <!-- Twee Kolommen: Ingrediënten & Bereiding -->
        <div class="grid grid-cols-1 gap-6 md:grid-cols-12">
          <!-- Ingrediëntenlijst (5 kolommen op desktop) -->
          <div class="space-y-3 md:col-span-5">
            <h3 class="flex items-center justify-between text-sm font-bold text-slate-800 dark:text-neutral-100">
              <span class="inline-flex items-center gap-2">${this.icon('basket', 'h-4 w-4 text-emerald-700 dark:text-emerald-400')} Ingrediënten</span>
              <span class="text-[11px] font-normal text-slate-400 dark:text-neutral-400">Klik voor AH-opties</span>
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
                  ? product?.bonusDescription || 'Bonus'
                  : ing.bonusText || 'Bonus';
                const optionCount = (ing.ahProductOptions || []).length;
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
                          ${scaledAmount === null ? '' : `<span class="tabular-nums">${this.escapeHtml(scaledAmount)}</span> `}${this.escapeHtml(ing.unit)} ${this.escapeHtml(ing.name)}
                        </span>
                        <span class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 dark:text-neutral-400">
                          ${isBonus
                            ? `<span class="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">${this.icon('flame', 'h-3 w-3')} ${this.escapeHtml(bonusDesc)}${rowSavings > 0 ? ` · −${this.ahService.formatEuro(rowSavings)}` : ''}</span>`
                            : ''}
                          <span>${optionCount > 0
                            ? `${optionCount} AH-${optionCount === 1 ? 'optie' : 'opties'}`
                            : 'Bekijk AH-product'}</span>
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
              <span class="inline-flex items-center gap-2">${this.icon('list', 'h-4 w-4 text-emerald-700 dark:text-emerald-400')} Bereidingswijze</span>
              <span class="text-[11px] font-normal text-slate-400 dark:text-neutral-400">Stap voor stap koken</span>
            </h3>
            <ol class="space-y-2.5">
              ${(recipe.instructions || []).map((step, idx) => `
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
                  Vraag Gemini Kookassistent
                </h4>
                <p class="text-xs text-slate-500 dark:text-neutral-400">
                  Stel een vraag over ingrediënten vervangen, bereiding of tips
                </p>
              </div>
            </div>
            ${!this.geminiService.hasApiKey() ? `
              <button 
                type="button" 
                class="open-settings-btn inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300"
              >
                ${this.icon('key', 'h-3.5 w-3.5')} API-sleutel
              </button>
            ` : ''}
          </div>

          <!-- Snelkeuze vragen knoppen -->
          <div class="mb-3 flex flex-wrap gap-1.5">
            <button type="button" class="gemini-quick-btn rounded-lg border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-indigo-900/50" data-prompt="Hoe kan ik dit gerecht nóg eiwitrijker maken zonder veel extra calorieën?">
              Eiwitrijker maken
            </button>
            <button type="button" class="gemini-quick-btn rounded-lg border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-indigo-900/50" data-prompt="Wat kan ik vervangen als ik bepaalde ingrediënten niet lust of in huis heb?">
              Ingrediënten vervangen
            </button>
            <button type="button" class="gemini-quick-btn rounded-lg border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-indigo-900/50" data-prompt="Welke wijn, bier of alcoholvrije drank past perfect bij de smaken van dit gerecht?">
              Wijn- &amp; drankparing
            </button>
            <button type="button" class="gemini-quick-btn rounded-lg border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-indigo-900/50" data-prompt="Hoe kan ik dit recept het makkelijkst omtoveren tot een 100% vegetarische of plantaardige variant?">
              Vegetarische variant
            </button>
          </div>

          <!-- Chat antwoord venster -->
          <div id="gemini-response-area" class="mb-3 hidden max-h-60 overflow-y-auto whitespace-pre-line rounded-xl border border-indigo-100 bg-white p-3.5 text-sm leading-relaxed text-slate-800 shadow-inner dark:border-indigo-950 dark:bg-neutral-900 dark:text-neutral-200"></div>

          <!-- Chat invoer veld -->
          <form id="gemini-ask-form" class="flex gap-2">
            <label for="gemini-question-input" class="sr-only">Stel een vraag aan Gemini</label>
            <input 
              type="text" 
              id="gemini-question-input" 
              placeholder="${this.geminiService.hasApiKey() ? 'Stel een vraag over dit gerecht aan Gemini…' : 'Vul eerst je Gemini API-key in om vragen te stellen…'}"
              class="flex-1 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2 text-sm text-slate-800 transition placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
              ${!this.geminiService.hasApiKey() ? 'disabled' : ''}
            />
            <button 
              type="submit" 
              id="gemini-submit-btn" 
              class="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              ${!this.geminiService.hasApiKey() ? 'disabled' : ''}
            >
              <span>Vraag</span>
              <span id="gemini-spinner" class="hidden h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true"></span>
            </button>
          </form>
        </div>
      </div>
    `;
  }
}
