import { AHService, ONLINE_ONLY_SETTING_KEY, PRODUCT_SEARCH_CATEGORIES } from './ah-service.js';

const LIST_KEY = 'myfood_frequent_products';
const SORT_KEY = 'myfood_product_comparison_sort';
const SCORE_CRITERIA_KEY = 'myfood_product_score_criteria';
const NUTRI_SCORES = ['A', 'B', 'C', 'D', 'E'];
const DEFAULT_SCORE_CRITERIA = { price: true, health: true, protein: true };
const REFRESH_CATEGORIES_VALUE = '__refresh_categories__';

function hasProductSearchCategory(category) {
  return Object.prototype.hasOwnProperty.call(PRODUCT_SEARCH_CATEGORIES, category) ||
    /^\d+$/.test(String(category || ''));
}

function getProductSearchCategoryLabel(category, label = '') {
  const directlyKnownCategory = PRODUCT_SEARCH_CATEGORIES[category];
  const matchingAHCategory = Object.values(PRODUCT_SEARCH_CATEGORIES)
    .find(item => item.ahSoort === category);
  return directlyKnownCategory?.label || label || matchingAHCategory?.label || '';
}

function capitalizeFirstLetter(value) {
  const text = String(value || '');
  return text ? text[0].toLocaleUpperCase('nl-NL') + text.slice(1) : '';
}

export function getPricePerKg(product) {
  const description = String(product.unitPriceDescription || '');
  const listedUnitPrice = description.match(/(?:prijs\s+)?per\s+(?:(\d+(?:[.,]\d+)?)\s*)?(kg|g)\s*€?\s*([\d.,]+)/i);
  if (listedUnitPrice) {
    const listedAmount = parseDutchNumber(listedUnitPrice[1] || '1');
    const listedPrice = parseDutchNumber(listedUnitPrice[3]);
    const listedKilograms = listedUnitPrice[2].toLowerCase() === 'kg'
      ? listedAmount
      : listedAmount / 1000;
    if (listedKilograms > 0 && Number.isFinite(listedPrice)) {
      return roundMoney(listedPrice / listedKilograms);
    }
  }

  const unitSize = String(product.unitSize || '');
  const multipack = unitSize.match(/(\d+)\s*[x×]\s*([\d.,]+)\s*(kg|g)\b/i);
  const singlePack = unitSize.match(/([\d.,]+)\s*(kg|g)\b/i);
  const pack = multipack || (singlePack && [singlePack[0], '1', singlePack[1], singlePack[2]]);
  if (!pack) return null;

  const packCount = Number(pack[1]);
  const amount = parseDutchNumber(pack[2]);
  const unit = pack[3].toLowerCase();
  const kilograms = amount * packCount * (unit === 'g' ? 0.001 : 1);
  return kilograms > 0 ? roundMoney(product.price / kilograms) : null;
}

export function sortComparedProducts(products, mode = 'balanced', criteria = DEFAULT_SCORE_CRITERIA) {
  const enriched = products.map(product => ({
    ...product,
    pricePerKg: getPricePerKg(product),
    healthScore: NUTRI_SCORES.includes(product.nutriScore)
      ? (NUTRI_SCORES.length - NUTRI_SCORES.indexOf(product.nutriScore) - 1) * 25
      : null
  }));
  const priced = enriched.filter(product => product.pricePerKg !== null)
    .sort((a, b) => a.pricePerKg - b.pricePerKg);
  const cheapest = priced[0]?.pricePerKg;
  const mostExpensive = priced.at(-1)?.pricePerKg;

  enriched.forEach(product => {
    product.priceScore = product.pricePerKg === null
      ? null
      : mostExpensive === cheapest
        ? 100
        : Math.round(100 * (mostExpensive - product.pricePerKg) / (mostExpensive - cheapest));
    const scores = [
      criteria.price ? product.priceScore : null,
      criteria.health ? product.healthScore : null,
      criteria.protein ? product.proteinScore : null
    ].filter(Number.isFinite);
    product.score = scores.length
      ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
      : null;
  });

  return enriched.sort((a, b) => {
    if (mode === 'price') return compareNullable(a.pricePerKg, b.pricePerKg);
    if (mode === 'health') {
      const healthOrder = NUTRI_SCORES.indexOf(a.nutriScore) - NUTRI_SCORES.indexOf(b.nutriScore);
      return compareMissing(a.healthScore, b.healthScore) || healthOrder || compareNullable(a.pricePerKg, b.pricePerKg);
    }
    return compareMissing(a.score, b.score) ||
      (b.score ?? -1) - (a.score ?? -1) ||
      compareNullable(a.pricePerKg, b.pricePerKg) ||
      (NUTRI_SCORES.indexOf(a.nutriScore) - NUTRI_SCORES.indexOf(b.nutriScore));
  });
}

function compareNullable(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  return a - b;
}

function compareMissing(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  return 0;
}

function parseDutchNumber(value) {
  let normalized = String(value).replace(/[^\d.,-]/g, '');
  const commaIndex = normalized.lastIndexOf(',');
  const dotIndex = normalized.lastIndexOf('.');
  if (commaIndex >= 0 && dotIndex >= 0) {
    const decimalSeparator = commaIndex > dotIndex ? ',' : '.';
    const groupingSeparator = decimalSeparator === ',' ? /\./g : /,/g;
    normalized = normalized.replace(groupingSeparator, '');
    if (decimalSeparator === ',') normalized = normalized.replace(',', '.');
  } else if (commaIndex >= 0) {
    const decimalDigits = normalized.length - commaIndex - 1;
    normalized = decimalDigits === 3
      ? normalized.replace(',', '')
      : normalized.replace(',', '.');
  } else if (dotIndex >= 0 && normalized.length - dotIndex - 1 === 3) {
    normalized = normalized.replace('.', '');
  }
  return Number(normalized);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export class ProductComparisonApp {
  constructor({ ahService = new AHService(), storage = localStorage, documentRef = document } = {}) {
    this.ahService = ahService;
    this.storage = storage;
    this.document = documentRef;
    this.sortMode = this.storage.getItem(SORT_KEY) || 'balanced';
    this.scoreCriteria = this.readScoreCriteria();
    this.items = this.readItems();
    this.results = new Map();
    this.loading = new Set();
    this.loadingMore = new Set();
    this.searchRequestIds = new Map();
    this.nutritionLoading = new Set();
    this.selectedItemKey = null;
    this.activePanel = 'overview';
    this.editingDraft = null;
    this.editingOriginalKey = null;
    this.draftSequence = 0;
    this.preview = { query: '', category: '', categoryLabel: '', status: 'idle', products: [], error: '' };
    this.previewTimer = null;
    this.previewRequestId = 0;
    this.categoryRefreshRequestId = 0;
  }

  init() {
    this.bindEvents();
    this.initTheme();
    const onlineOnlySetting = this.document.getElementById('ignore-online-only-products');
    if (onlineOnlySetting) {
      onlineOnlySetting.checked = this.ahService.getIgnoreOnlineOnlyProducts();
      onlineOnlySetting.addEventListener('change', () => {
        try {
          this.ahService.setIgnoreOnlineOnlyProducts(onlineOnlySetting.checked);
        } catch (error) {
          onlineOnlySetting.checked = this.ahService.getIgnoreOnlineOnlyProducts();
          this.setStatus(error.message);
        }
      });
    }
    const refreshOnlineOnlyResults = event => {
      if (onlineOnlySetting && typeof event.detail?.enabled === 'boolean') {
        onlineOnlySetting.checked = event.detail.enabled;
      }
      this.items.forEach(item => this.loadProducts(item));
      if (this.editingDraft && !this.items.includes(this.editingDraft)) {
        this.loadProducts(this.editingDraft);
      }
    };
    window.addEventListener('myfood:online-only-setting-changed', refreshOnlineOnlyResults);
    window.addEventListener('storage', event => {
      if (event.key !== ONLINE_ONLY_SETTING_KEY) return;
      if (onlineOnlySetting) onlineOnlySetting.checked = this.ahService.getIgnoreOnlineOnlyProducts();
      refreshOnlineOnlyResults(event);
    });
    const sort = this.document.getElementById('sort-products');
    if (sort) sort.value = this.sortMode;
    this.render();
    this.renderPreview();
    this.setPanel('overview');
    this.items.forEach(item => this.loadProducts(item));
  }

  readItems() {
    try {
      const items = JSON.parse(this.storage.getItem(LIST_KEY) || '[]');
      return Array.isArray(items)
        ? items
          .filter(item => typeof item.query === 'string' && item.query.trim())
          .map(item => ({
            query: item.query,
            criteria: this.normalizeCriteria(item.criteria),
            ...(hasProductSearchCategory(item.category)
              ? {
                category: item.category,
                categoryLabel: getProductSearchCategoryLabel(
                  item.category,
                  typeof item.categoryLabel === 'string' ? item.categoryLabel : ''
                )
              }
              : {})
          }))
          .slice(0, 30)
        : [];
    } catch (error) {
      console.warn('Opgeslagen productlijst kon niet worden gelezen.', error);
      return [];
    }
  }

  readScoreCriteria() {
    try {
      const saved = JSON.parse(this.storage.getItem(SCORE_CRITERIA_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return { ...DEFAULT_SCORE_CRITERIA };
      const criteria = Object.fromEntries(
        Object.keys(DEFAULT_SCORE_CRITERIA).map(key => [key, saved[key] === true])
      );
      return Object.values(criteria).some(Boolean) ? criteria : { ...DEFAULT_SCORE_CRITERIA };
    } catch (error) {
      console.warn('Opgeslagen scorecriteria konden niet worden gelezen; standaardcriteria worden gebruikt.', error);
      return { ...DEFAULT_SCORE_CRITERIA };
    }
  }

  normalizeCriteria(criteria) {
    if (!criteria || typeof criteria !== 'object') return { ...this.scoreCriteria };
    const normalized = Object.fromEntries(
      Object.keys(DEFAULT_SCORE_CRITERIA).map(key => [key, criteria[key] === true])
    );
    return Object.values(normalized).some(Boolean) ? normalized : { ...this.scoreCriteria };
  }

  getItemCriteria(item) {
    return this.normalizeCriteria(item.criteria);
  }

  isDuplicateDraft(draft) {
    const draftKey = this.getItemKey({ query: draft.query, category: draft.category });
    return this.items.some(item =>
      item !== draft &&
      item.query &&
      this.getItemKey(item) !== this.editingOriginalKey &&
      this.getItemKey(item) === draftKey
    );
  }

  setPanel(panel) {
    const track = this.document.getElementById('workspace-track');
    if (!track) return;
    this.activePanel = panel;
    track.dataset.activePanel = panel;
    const panels = {
      overview: this.document.getElementById('overview-panel'),
      detail: this.document.getElementById('detail-panel')
    };
    Object.entries(panels).forEach(([name, element]) => {
      if (!element) return;
      const hidden = name !== panel;
      element.setAttribute('aria-hidden', String(hidden));
      element.inert = hidden;
    });
  }

  beginEdit(item, isNew = false) {
    const draftId = `draft-${Date.now()}-${++this.draftSequence}`;
    this.editingOriginalKey = isNew ? null : this.getItemKey(item);
    this.editingDraft = {
      ...item,
      criteria: { ...this.getItemCriteria(item) },
      draftId,
      isDraft: true
    };
    if (isNew) {
      this.items.push(this.editingDraft);
    }
    this.selectedItemKey = this.getItemKey(this.editingDraft);
    const queryInput = this.document.getElementById('product-query');
    const categoryInput = this.document.getElementById('product-category');
    if (queryInput) queryInput.value = this.editingDraft.query;
    if (categoryInput) {
      categoryInput.querySelectorAll('option[data-ah-category="true"]').forEach(option => option.remove());
      const category = this.editingDraft.category || '';
      if (category && ![...categoryInput.options].some(option => option.value === category)) {
        const option = new Option(this.editingDraft.categoryLabel || category, category);
        option.dataset.ahCategory = 'true';
        categoryInput.insertBefore(option, categoryInput.querySelector(`option[value="${REFRESH_CATEGORIES_VALUE}"]`));
      }
      categoryInput.value = category;
    }
    this.render();
    this.setEditMode(true);
    this.renderPreview();
    queryInput?.focus();
    if (this.editingDraft.query.length >= 2) {
      this.preview = { query: this.editingDraft.query, category: this.editingDraft.category || '', categoryLabel: this.editingDraft.categoryLabel || '', status: 'loading', products: [], error: '' };
      this.renderPreview();
      this.loadProducts(this.editingDraft);
    } else {
      this.setStatus('');
    }
  }

  setEditMode(enabled) {
    const form = this.document.getElementById('add-product-form');
    const editButton = this.document.getElementById('edit-selected-product');
    const saveButton = this.document.getElementById('save-edit-product');
    const cancelButton = this.document.getElementById('cancel-edit-product');
    const categoryInput = this.document.getElementById('product-category');
    const scoreCriteriaSettings = this.document.getElementById('score-criteria-settings');
    form?.classList.toggle('hidden', !enabled);
    scoreCriteriaSettings?.classList.toggle('hidden', !enabled);
    if (editButton) editButton.classList.toggle('hidden', enabled);
    if (saveButton) {
      saveButton.classList.toggle('hidden', !enabled);
      const result = this.editingDraft && this.results.get(this.getItemKey(this.editingDraft));
      saveButton.disabled = !enabled || !this.editingDraft?.query?.trim() ||
        this.isDuplicateDraft(this.editingDraft) ||
        result?.status !== 'loaded' ||
        result.query !== this.editingDraft.query ||
        result.category !== (this.editingDraft.category || '');
    }
    if (cancelButton) cancelButton.classList.toggle('hidden', !enabled);
    this.document.querySelectorAll('[data-score-criterion]').forEach(checkbox => {
      checkbox.disabled = !enabled;
    });
    if (categoryInput) categoryInput.value = this.editingDraft?.category || '';
  }

  cancelEdit() {
    if (!this.editingDraft) return;
    const draftKey = this.getItemKey(this.editingDraft);
    const wasNew = this.editingOriginalKey === null;
    this.items = this.items.filter(item => this.getItemKey(item) !== draftKey);
    this.results.delete(draftKey);
    this.selectedItemKey = wasNew ? null : this.editingOriginalKey;
    this.editingDraft = null;
    this.editingOriginalKey = null;
    this.setEditMode(false);
    this.saveItems();
    this.render();
    if (wasNew) this.setPanel('overview');
  }

  saveEdit() {
    const draft = this.editingDraft;
    if (!draft || !draft.query?.trim()) {
      this.setStatus('Vul een product of productsoort in voordat je opslaat.');
      return;
    }
    const draftKey = this.getItemKey(draft);
    const result = this.results.get(draftKey);
    if (result?.status !== 'loaded' ||
        result.query !== draft.query ||
        result.category !== (draft.category || '')) {
      this.setStatus('Wacht tot de AH-resultaten voor deze zoekopdracht zijn bijgewerkt.');
      return;
    }

    if (this.isDuplicateDraft(draft)) {
      this.setStatus(`"${draft.query}" staat al in je lijst in deze categorie.`);
      return;
    }

    const isNew = this.editingOriginalKey === null;
    const original = isNew
      ? draft
      : this.items.find(item => this.getItemKey(item) === this.editingOriginalKey);
    if (!original) {
      this.setStatus('Dit product staat niet meer in je lijst. Open het overzicht opnieuw.');
      return;
    }

    const savedItem = {
      query: draft.query,
      criteria: { ...draft.criteria },
      ...(draft.category ? { category: draft.category, categoryLabel: draft.categoryLabel || '' } : {})
    };
    Object.assign(original, savedItem);
    delete original.draftId;
    delete original.isDraft;
    if (!isNew) this.results.delete(this.editingOriginalKey);
    this.results.delete(draftKey);
    const savedKey = this.getItemKey(original);
    this.results.set(savedKey, {
      ...result,
      query: savedItem.query,
      category: savedItem.category || '',
      products: sortComparedProducts(result.products, this.sortMode, savedItem.criteria)
    });
    this.selectedItemKey = savedKey;
    this.editingDraft = null;
    this.editingOriginalKey = null;
    this.setEditMode(false);
    this.saveItems();
    this.render();
    this.setStatus('Productinstellingen opgeslagen.');
  }

  bindEvents() {
    this.document.getElementById('detail-score-criteria')?.addEventListener('change', event => {
      const checkbox = event.target.closest('[data-score-criterion]');
      if (!checkbox || !this.editingDraft) return;
      const criterion = checkbox.dataset.scoreCriterion;
      const nextCriteria = { ...this.getItemCriteria(this.editingDraft), [criterion]: checkbox.checked };
      if (!Object.values(nextCriteria).some(Boolean)) {
        checkbox.checked = true;
        this.setStatus('Kies minimaal één criterium voor de productscore.');
        return;
      }
      this.editingDraft.criteria = nextCriteria;
      const result = this.results.get(this.getItemKey(this.editingDraft));
      if (result?.status === 'loaded') {
        result.products = sortComparedProducts(result.products, this.sortMode, nextCriteria);
      }
      this.render();
    });

    this.document.getElementById('open-add-panel')?.addEventListener('click', () => {
      if (this.items.length >= 30) {
        this.setStatus('Je lijst kan maximaal 30 productgroepen bevatten.');
        return;
      }
      this.beginEdit({
        query: '',
        category: '',
        categoryLabel: '',
        criteria: { ...this.scoreCriteria }
      }, true);
      this.setPanel('detail');
    });
    this.document.querySelectorAll('[data-back-overview]').forEach(button => {
      button.addEventListener('click', () => {
        if (this.editingDraft) this.cancelEdit();
        this.setPanel('overview');
      });
    });
    this.document.getElementById('edit-selected-product')?.addEventListener('click', () => {
      const item = this.items.find(candidate => this.getItemKey(candidate) === this.selectedItemKey);
      if (item) this.beginEdit(item);
    });
    this.document.getElementById('save-edit-product')?.addEventListener('click', () => this.saveEdit());
    this.document.getElementById('cancel-edit-product')?.addEventListener('click', () => this.cancelEdit());

    const queryInput = this.document.getElementById('product-query');
    const categoryInput = this.document.getElementById('product-category');
    queryInput?.addEventListener('input', () => {
      this.categoryRefreshRequestId += 1;
      if (this.editingDraft) this.editingDraft.query = queryInput.value.trim().replace(/\s+/g, ' ');
      const selectedCategory = categoryInput?.selectedOptions[0];
      const selectedDynamicCategory = selectedCategory?.dataset.ahCategory === 'true'
        ? selectedCategory.cloneNode(true)
        : null;
      categoryInput?.querySelectorAll('option[data-ah-category="true"]').forEach(option => option.remove());
      if (selectedDynamicCategory && categoryInput) {
        const refreshOption = categoryInput.querySelector(`option[value="${REFRESH_CATEGORIES_VALUE}"]`);
        categoryInput.insertBefore(selectedDynamicCategory, refreshOption);
        categoryInput.value = selectedDynamicCategory.value;
      }
      this.schedulePreview();
    });
    categoryInput?.addEventListener('change', () => {
      if (categoryInput.value === REFRESH_CATEGORIES_VALUE) {
        categoryInput.value = '';
        this.refreshSearchCategories();
        return;
      }
      if (this.editingDraft) {
        const selected = categoryInput.selectedOptions[0];
        this.editingDraft.category = categoryInput.value;
        this.editingDraft.categoryLabel = selected?.dataset.ahCategory === 'true'
          ? selected.textContent
          : getProductSearchCategoryLabel(categoryInput.value);
      }
      this.schedulePreview();
    });

    this.document.getElementById('add-product-form')?.addEventListener('submit', event => {
      event.preventDefault();
      if (this.editingDraft) this.schedulePreview();
    });

    this.document.getElementById('sort-products')?.addEventListener('change', event => {
      this.sortMode = event.target.value;
      this.storage.setItem(SORT_KEY, this.sortMode);
      this.render();
    });

    this.document.getElementById('workspace-track')?.addEventListener('click', event => {
      const target = event.target.closest('[data-action], [data-open-group]');
      if (!target) return;
      const groupKey = target.dataset.groupKey || target.dataset.openGroup;
      const item = this.editingDraft && this.getItemKey(this.editingDraft) === groupKey
        ? this.editingDraft
        : this.items.find(candidate => this.getItemKey(candidate) === groupKey);
      if (!item) return;
      const key = this.getItemKey(item);
      if (target.dataset.openGroup) {
        this.selectedItemKey = key;
        this.render();
        this.setPanel('detail');
        this.loadVisibleNutrition(item);
      }
      if (target.dataset.action === 'remove') {
        if (item.isDraft) this.cancelEdit();
        else this.removeItem(item);
      }
      if (target.dataset.action === 'refresh') this.loadProducts(item, true);
      if (target.dataset.action === 'load-more') this.loadMoreProducts(item);
    });
  }

  initTheme() {
    const themeButton = this.document.getElementById('theme-toggle');
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const applyTheme = () => {
      const dark = this.storage.getItem('myfood_theme') === 'dark' ||
        (!this.storage.getItem('myfood_theme') && prefersDark);
      this.document.documentElement.classList.toggle('dark', dark);
      if (themeButton) themeButton.textContent = dark ? '☀️' : '🌙';
    };
    applyTheme();
    themeButton?.addEventListener('click', () => {
      const dark = !this.document.documentElement.classList.contains('dark');
      this.storage.setItem('myfood_theme', dark ? 'dark' : 'light');
      applyTheme();
    });
  }

  getItemKey(item) {
    if (item.draftId) return item.draftId;
    return JSON.stringify([
      item.category || '',
      item.query.toLocaleLowerCase('nl-NL')
    ]);
  }

  async refreshSearchCategories() {
    const query = this.document.getElementById('product-query')?.value.trim().replace(/\s+/g, ' ') || '';
    if (query.length < 2) {
      this.setStatus('Vul eerst minimaal 2 tekens in om AH-categorieën op te halen.');
      this.schedulePreview();
      return;
    }

    const requestId = ++this.categoryRefreshRequestId;
    const categorySelect = this.document.getElementById('product-category');
    const refreshOption = categorySelect?.querySelector(`option[value="${REFRESH_CATEGORIES_VALUE}"]`);
    this.previewRequestId += 1;
    clearTimeout(this.previewTimer);
    this.preview = { query, category: '', categoryLabel: '', status: 'idle', products: [], error: '' };
    this.renderPreview();
    if (categorySelect) categorySelect.disabled = true;
    this.preview = { query, category: '', categoryLabel: '', status: 'loading', products: [], error: '' };
    this.renderPreview();
    this.setStatus('AH-categorieën laden…');

    try {
      const categories = await this.ahService.fetchSearchCategories(query);
      if (requestId !== this.categoryRefreshRequestId) return;
      if (categorySelect && refreshOption) {
        categorySelect.querySelectorAll('option[data-ah-category="true"]').forEach(option => option.remove());
        categories.forEach(category => {
          const option = new Option(category.label, category.id);
          option.dataset.ahCategory = 'true';
          categorySelect.insertBefore(option, refreshOption);
        });
        categorySelect.value = '';
      }
      if (this.editingDraft) {
        this.editingDraft.category = '';
        this.editingDraft.categoryLabel = '';
      }
      this.setStatus(categories.length
        ? `${categories.length} AH-categorieën geladen voor “${query}”.`
        : `AH heeft geen categorieën gevonden voor “${query}”.`);
      this.schedulePreview();
    } catch (error) {
      if (requestId !== this.categoryRefreshRequestId) return;
      console.error(`AH-categorieën ophalen voor "${query}" is mislukt.`, error);
      this.setStatus(`AH-categorieën ophalen mislukt: ${error.message}`);
      this.schedulePreview();
    } finally {
      if (categorySelect) categorySelect.disabled = false;
    }
  }

  schedulePreview() {
    const query = this.document.getElementById('product-query')?.value.trim().replace(/\s+/g, ' ') || '';
    const category = this.document.getElementById('product-category')?.value || '';
    const selectedCategory = this.document.getElementById('product-category')?.selectedOptions[0];
    const categoryLabel = category
      ? getProductSearchCategoryLabel(category, selectedCategory?.textContent || '')
      : '';
    const requestId = ++this.previewRequestId;
    clearTimeout(this.previewTimer);
    if (!this.editingDraft) return;
    this.editingDraft.query = query;
    this.editingDraft.category = category;
    this.editingDraft.categoryLabel = categoryLabel;
    this.preview = { query, category, categoryLabel, status: 'idle', products: [], error: '' };
    if (query.length < 2) {
      this.results.delete(this.getItemKey(this.editingDraft));
      this.setStatus('Vul minimaal 2 tekens in om AH-producten te zoeken.');
      this.render();
      this.renderPreview();
      return;
    }

    this.preview.status = 'loading';
    this.setStatus('AH-producten worden bijgewerkt…');
    this.render();
    this.renderPreview();
    this.previewTimer = setTimeout(() => {
      if (requestId !== this.previewRequestId) return;
      this.loadProducts(this.editingDraft);
    }, 350);
  }

  renderPreview() {
    const preview = this.document.getElementById('product-preview');
    const saveButton = this.document.getElementById('save-edit-product');
    if (!preview || !saveButton) return;
    const draft = this.editingDraft;
    const result = draft ? this.results.get(this.getItemKey(draft)) : null;
    const { query, categoryLabel, status, error } = this.preview;
    if (!draft || !query || query.length < 2) {
      preview.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">Vul minimaal 2 tekens in om direct de bijbehorende AH-producten te bekijken.</p>';
    } else if (status === 'loading' || result?.status === 'loading') {
      preview.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">AH-producten worden bijgewerkt…</p>';
    } else if (status === 'error') {
      preview.innerHTML = `<p class="text-sm text-rose-600 dark:text-rose-400">Voorbeeld ophalen mislukt: ${this.escape(error)}</p>`;
    } else if (result?.status === 'error') {
      preview.innerHTML = `<p class="text-sm text-rose-600 dark:text-rose-400">AH-producten ophalen mislukt: ${this.escape(result.message)}</p>`;
    } else if (result?.status === 'empty') {
      preview.innerHTML = `<p class="text-sm text-slate-500 dark:text-slate-400">Geen AH-producten gevonden${categoryLabel ? ` in ${this.escape(categoryLabel)}` : ''} voor “${this.escape(query)}”.</p>`;
    } else if (result?.status === 'loaded' && result.query === query &&
        result.category === (draft.category || '')) {
      preview.innerHTML = `<p class="text-sm text-sky-700 dark:text-sky-300">${result.products.length} AH-opties geladen${categoryLabel ? ` in ${this.escape(categoryLabel)}` : ''}. De resultaten hieronder worden direct bijgewerkt.</p>`;
    } else {
      preview.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">AH-resultaten bijwerken…</p>';
    }
    saveButton.disabled = !draft?.query?.trim() || result?.status !== 'loaded' ||
      result.query !== draft.query || result.category !== (draft.category || '') ||
      this.isDuplicateDraft(draft);
  }

  removeItem(item) {
    const key = this.getItemKey(item);
    this.items = this.items.filter(existing => this.getItemKey(existing) !== key);
    this.results.delete(key);
    if (this.selectedItemKey === key) {
      this.selectedItemKey = null;
      this.setPanel('overview');
    }
    this.saveItems();
    this.render();
  }

  saveItems() {
    try {
      this.storage.setItem(LIST_KEY, JSON.stringify(
        this.items.filter(item => !item.isDraft && item.query?.trim())
      ));
    } catch (error) {
      console.error('Productlijst kon niet worden opgeslagen.', error);
      this.setStatus('Opslaan van je lijst is mislukt. Controleer de opslagruimte van je browser.');
    }
  }

  async loadProducts(item, forceRefresh = false) {
    const key = this.getItemKey(item);
    const requestId = (this.searchRequestIds.get(key) || 0) + 1;
    this.searchRequestIds.set(key, requestId);
    this.loading.add(key);
    this.results.set(key, { status: 'loading', products: [] });
    if (this.editingDraft && this.getItemKey(this.editingDraft) === key) {
      this.preview = {
        query: item.query,
        category: item.category || '',
        categoryLabel: item.categoryLabel || '',
        status: 'loading',
        products: [],
        error: ''
      };
    }
    this.render();
    try {
      const query = item.query;
      const category = item.category || '';
      const categoryLabel = item.categoryLabel || '';
      const result = await this.ahService.searchProducts(item.query, {
        forceRefresh,
        category,
        categoryLabel
      });
      if (this.searchRequestIds.get(key) !== requestId) return;
      const products = sortComparedProducts(result.products, this.sortMode, this.getItemCriteria(item));
      this.results.set(key, {
        status: products.length ? 'loaded' : 'empty',
        products,
        query,
        category,
        pageInfo: result.pageInfo,
        updatedAt: result.updatedAt,
        stale: result.stale
      });
      if (this.editingDraft && this.getItemKey(this.editingDraft) === key) {
        this.preview = {
          query,
          category,
          categoryLabel,
          status: result.products.length ? 'loaded' : 'empty',
          products: [],
          error: ''
        };
        this.setStatus(result.stale ? 'AH was niet bereikbaar; resultaten worden bijgewerkt vanaf opgeslagen gegevens.' : '');
      }
    } catch (error) {
      if (this.searchRequestIds.get(key) !== requestId) return;
      console.error(`AH-producten ophalen voor "${item.query}" is mislukt.`, error);
      this.results.set(key, { status: 'error', products: [], message: error.message, query: item.query, category: item.category || '' });
      if (this.editingDraft && this.getItemKey(this.editingDraft) === key) {
        this.preview = {
          query: item.query,
          category: item.category || '',
          categoryLabel: item.categoryLabel || '',
          status: 'error',
          products: [],
          error: error.message
        };
      }
    } finally {
      if (this.searchRequestIds.get(key) === requestId) {
        this.loading.delete(key);
        this.render();
        this.loadVisibleNutrition(item);
      }
    }
  }

  async loadMoreProducts(item) {
    const key = this.getItemKey(item);
    const current = this.results.get(key);
    if (this.loadingMore.has(key) || current?.pageInfo?.nextPage === null ||
        current?.pageInfo?.nextPage === undefined) return;
    this.loadingMore.add(key);
    this.render();
    try {
      const result = await this.ahService.searchProducts(item.query, {
        page: current.pageInfo.nextPage,
        category: item.category || '',
        categoryLabel: item.categoryLabel || ''
      });
      const productsById = new Map(current.products.map(product => [product.id, product]));
      result.products.forEach(product => productsById.set(product.id, product));
      this.results.set(key, {
        ...current,
        products: sortComparedProducts([...productsById.values()], this.sortMode, this.getItemCriteria(item)),
        pageInfo: result.pageInfo,
        updatedAt: result.updatedAt,
        stale: current.stale || result.stale,
        pageError: null
      });
    } catch (error) {
      console.error(`Meer AH-resultaten ophalen voor "${item.query}" is mislukt.`, error);
      this.results.set(key, { ...current, pageError: error.message });
    } finally {
      this.loadingMore.delete(key);
      this.render();
      this.loadVisibleNutrition(item);
    }
  }

  async loadVisibleNutrition(item) {
    const key = this.getItemKey(item);
    const result = this.results.get(key);
    if (!result || result.status !== 'loaded') return;
    const pendingProducts = result.products.filter(product =>
      product.proteinGrams === undefined &&
      !product.nutritionLoadError &&
      !this.nutritionLoading.has(product.id)
    );
    if (!pendingProducts.length) return;

    pendingProducts.forEach(product => this.nutritionLoading.add(product.id));
    this.render();
    await Promise.all(pendingProducts.map(async product => {
      try {
        const nutrition = await this.ahService.getProductNutrition(product.id);
        Object.assign(product, nutrition);
      } catch (error) {
        console.error(`AH-eiwitgegevens ophalen voor "${product.title}" is mislukt.`, error);
        product.nutritionLoadError = error.message;
      } finally {
        this.nutritionLoading.delete(product.id);
      }
    }));
    this.render();
  }

  setStatus(message) {
    const status = this.document.getElementById('page-status');
    if (status) status.textContent = message;
  }

  formatEuro(amount) {
    return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(amount);
  }

  escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  renderProduct(product) {
    const bonus = product.isBonus && product.price < product.regularPrice;
    const healthClass = {
      A: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
      B: 'bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300',
      C: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300',
      D: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
      E: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
    }[product.nutriScore] || 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300';
    const image = product.imageUrl
      ? `<img src="${this.escape(product.imageUrl)}" alt="" loading="lazy" class="w-10 h-10 object-contain rounded-lg bg-white">`
      : '<span class="w-10 h-10 grid place-items-center rounded-lg bg-slate-100 dark:bg-slate-700 text-xl">🛍️</span>';
    const proteinInfo = this.nutritionLoading.has(product.id)
      ? 'Eiwitgegevens laden…'
      : product.nutritionLoadError
        ? 'Eiwitgegevens niet beschikbaar'
        : product.proteinGrams !== undefined && product.proteinGrams !== null
          ? `Eiwit ${product.proteinGrams} g / 100 g · ${product.proteinScore === null ? 'score n.b.' : `score ${product.proteinScore}`}`
          : 'Eiwitscore niet beschikbaar';

    return `<article class="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 px-2.5 py-2 rounded-xl border sm:grid sm:grid-cols-[2.5rem_minmax(0,1fr)_6.25rem_6rem_3rem] sm:gap-2 ${bonus ? 'border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-700'}">
      ${image}
      <div class="min-w-0 sm:flex-1">
        <a href="${this.escape(product.productUrl)}" target="_blank" rel="noopener noreferrer" class="block truncate font-bold text-sm hover:text-sky-700 dark:hover:text-sky-300 sm:whitespace-normal">${this.escape(product.title)} ↗</a>
        <p class="text-xs text-slate-500 dark:text-slate-400">${this.escape(product.unitSize || 'Verpakking niet vermeld')} · <span class="font-semibold text-blue-700 dark:text-blue-300" title="Eiwitscore is het aandeel van de calorieën dat uit eiwit komt, berekend met AH-voedingswaarden per 100 g.">${this.escape(proteinInfo)}</span></p>
        ${product.isOnlineOnly ? '<p class="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">Alleen online verkrijgbaar</p>' : ''}
        ${product.bonusDescription && bonus ? `<p class="text-[11px] font-semibold text-amber-700 dark:text-amber-300">🔥 ${this.escape(product.bonusDescription)}</p>` : ''}
      </div>
      <div class="col-span-2 flex min-w-0 items-center justify-between gap-2 sm:contents">
        <span class="shrink-0 rounded-lg px-2 py-1 text-[11px] font-extrabold sm:col-start-3 sm:justify-self-end sm:text-xs ${healthClass}" title="${product.nutriScore ? `Nutri-Score ${this.escape(product.nutriScore)}` : 'Geen Nutri-Score beschikbaar'}">
          <span class="hidden sm:inline">Nutri-Score </span>${product.nutriScore ? this.escape(product.nutriScore) : '<span class="sm:hidden">—</span><span class="hidden sm:inline">Geen score</span>'}
        </span>
        <div class="flex min-w-0 items-baseline gap-x-2 sm:col-start-4 sm:block sm:min-w-24 sm:justify-self-end sm:text-right">
          <div class="flex shrink-0 items-baseline gap-1.5 sm:justify-end">
            <p class="text-sm font-extrabold ${bonus ? 'text-amber-700 dark:text-amber-300' : ''}">${this.formatEuro(product.price)}${bonus ? ' 🔥' : ''}</p>
            ${bonus ? `<p class="text-[11px] line-through text-slate-500">${this.formatEuro(product.regularPrice)}</p>` : ''}
          </div>
          <p class="text-xs font-semibold text-slate-600 dark:text-slate-300 sm:text-right">${product.pricePerKg === null ? '€/kg n.b.' : `${this.formatEuro(product.pricePerKg)} / kg`}</p>
        </div>
        <p class="w-7 shrink-0 text-right text-base font-bold text-sky-700 dark:text-sky-300 sm:col-start-5 sm:w-12 sm:text-lg" title="Productscore op basis van de geselecteerde criteria">${product.score === null ? '—' : product.score}</p>
      </div>
    </article>`;
  }

  renderOverviewItem(item) {
    const key = this.getItemKey(item);
    const result = this.results.get(key);
    const categoryLabel = getProductSearchCategoryLabel(item.category, item.categoryLabel);
    let summary = 'AH-producten laden…';
    let bestProduct = null;
    if (result?.status === 'error') {
      summary = 'Producten konden niet worden opgehaald.';
    } else if (result?.status === 'empty') {
      summary = 'Geen vergelijkbare producten met prijs gevonden.';
    } else if (result?.status === 'loaded') {
      bestProduct = sortComparedProducts(
        result.products,
        this.sortMode,
        this.getItemCriteria(item)
      )[0];
      summary = `${result.products.length} ${result.products.length === 1 ? 'optie' : 'opties'}`;
    }

    return `<article class="flex items-center gap-2 p-2 sm:p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 shadow-sm">
      <button type="button" data-open-group="${this.escape(key)}" class="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl p-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500">
        <span class="min-w-0 flex-1">
          <span class="block truncate text-base font-bold">${this.escape(capitalizeFirstLetter(item.query || 'Nieuw product'))}</span>
          <span class="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            ${categoryLabel ? `<span class="rounded-md bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200 px-1.5 py-0.5 font-medium">${this.escape(capitalizeFirstLetter(categoryLabel))}</span>` : ''}
            <span class="rounded-md bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 font-semibold">${this.escape(capitalizeFirstLetter(summary))}</span>
            ${bestProduct ? `<span class="min-w-0 truncate font-medium text-slate-600 dark:text-slate-300">${this.escape(capitalizeFirstLetter(bestProduct.title))} · ${this.formatEuro(bestProduct.price)}</span>` : ''}
          </span>
        </span>
        <span class="shrink-0 text-lg text-slate-400" aria-hidden="true">›</span>
      </button>
      ${item.isDraft ? '' : `<button type="button" data-action="remove" data-group-key="${this.escape(key)}" aria-label="Verwijder ${this.escape(item.query)} uit mijn lijst" class="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"><svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg></button>`}
    </article>`;
  }

  renderGroup(item) {
    const key = this.getItemKey(item);
    const result = this.results.get(key);
    let body;
    if (!result || result.status === 'loading') {
      body = '<p class="text-sm text-slate-500 dark:text-slate-400 py-4">Live AH-producten laden…</p>';
    } else if (result.status === 'error') {
      body = `<p class="text-sm text-rose-600 dark:text-rose-400 py-4">Producten ophalen mislukt: ${this.escape(result.message)}</p>`;
    } else if (result.status === 'empty') {
      const filteredOnlineOnly = this.ahService.getIgnoreOnlineOnlyProducts();
      body = `<p class="text-sm text-slate-500 dark:text-slate-400 py-4">
        Geen producten met een bekende prijs gevonden. Probeer een andere zoekterm.
        ${filteredOnlineOnly ? 'Pas de online-only instelling in bewerkmodus aan om deze producten te tonen.' : ''}
      </p>`;
    } else {
      const products = sortComparedProducts(result.products, this.sortMode, this.getItemCriteria(item));
      const categoryLabel = getProductSearchCategoryLabel(item.category, item.categoryLabel);
      const updatedAt = result.updatedAt
        ? new Intl.DateTimeFormat('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(result.updatedAt)
        : '';
      const pageStatus = result.pageInfo?.totalElements
        ? `${result.products.length} ${categoryLabel ? `${this.escape(categoryLabel)}-` : ''}opties · ${result.pageInfo.totalElements} AH-resultaten`
        : '';
      const productTableHeader = '<div class="hidden sm:grid grid-cols-[2.5rem_minmax(0,1fr)_6.25rem_6rem_3rem] items-center gap-2 px-2.5 text-[11px] uppercase tracking-wide font-bold text-slate-400"><span class="col-span-2 text-left">AH-product · verpakking</span><span class="col-start-3 text-right">Nutri-Score</span><span class="col-start-4 text-right">Prijs/kg</span><span class="col-start-5 text-right">Score</span></div>';
      const staleNotice = result.stale
        ? '<span class="text-amber-700 dark:text-amber-300">AH niet bereikbaar; opgeslagen resultaten</span>'
        : updatedAt
          ? `<span>${updatedAt} bijgewerkt</span>`
          : '';
      const moreButton = result.pageInfo?.nextPage !== null && result.pageInfo?.nextPage !== undefined
        ? `<div class="pt-3 text-center">
            ${result.pageError ? `<p class="mb-2 text-sm text-rose-600 dark:text-rose-400">Meer resultaten ophalen mislukt: ${this.escape(result.pageError)}</p>` : ''}
            <button type="button" data-action="load-more" data-group-key="${this.escape(key)}" ${this.loadingMore.has(key) ? 'disabled' : ''}
              class="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50">
              ${this.loadingMore.has(key) ? 'Meer resultaten laden…' : 'Meer AH-resultaten laden'}
            </button>
          </div>`
        : '';
      body = `<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 text-xs text-slate-500 dark:text-slate-400"><span>${pageStatus}</span><span class="ml-auto text-right">${staleNotice}</span></div>${productTableHeader}<div class="space-y-2">${products.map(product => this.renderProduct(product)).join('')}</div>${moreButton}`;
    }

    return `<section class="bg-white dark:bg-slate-800/60 p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
      ${body}
    </section>`;
  }

  render() {
    this.renderPreview();
    const groups = this.document.getElementById('product-groups');
    if (!groups) return;
    groups.innerHTML = this.items.length
      ? this.items.map(item => this.renderOverviewItem(item)).join('')
      : `<div class="text-center py-16 bg-white dark:bg-slate-800/60 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
          <span class="text-4xl">🛒</span>
          <h2 class="mt-3 font-bold text-lg">Je lijst is nog leeg</h2>
          <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Voeg een product toe dat je vaak koopt.</p>
        </div>`;
    const detail = this.document.getElementById('product-detail');
    const selectedItem = this.editingDraft ||
      this.items.find(item => this.getItemKey(item) === this.selectedItemKey);
    const selectedTitle = this.document.getElementById('selected-product-title');
    const refreshButton = this.document.getElementById('refresh-selected-product');
    if (selectedTitle) {
      selectedTitle.textContent = capitalizeFirstLetter(selectedItem?.query || 'Nieuw product');
    }
    if (refreshButton) {
      refreshButton.dataset.groupKey = selectedItem ? this.getItemKey(selectedItem) : '';
      refreshButton.disabled = !selectedItem;
    }
    if (detail) {
      detail.innerHTML = selectedItem
        ? this.renderGroup(selectedItem)
        : '<p class="text-sm text-slate-500 dark:text-slate-400">Selecteer een product uit je lijst.</p>';
    }
    const queryInput = this.document.getElementById('product-query');
    const categoryInput = this.document.getElementById('product-category');
    if (this.editingDraft) {
      if (queryInput && queryInput.value !== this.editingDraft.query) queryInput.value = this.editingDraft.query;
      if (categoryInput && categoryInput.value !== (this.editingDraft.category || '')) {
        categoryInput.value = this.editingDraft.category || '';
      }
    }
    const criteria = this.getItemCriteria(selectedItem || { criteria: this.scoreCriteria });
    this.document.querySelectorAll('[data-score-criterion]').forEach(checkbox => {
      checkbox.checked = criteria[checkbox.dataset.scoreCriterion] === true;
    });
    const sort = this.document.getElementById('sort-products');
    if (sort) sort.value = this.sortMode;
    this.setEditMode(Boolean(this.editingDraft));
    this.renderPreview();
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => new ProductComparisonApp().init());
}
