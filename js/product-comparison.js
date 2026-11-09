import { AHService, ONLINE_ONLY_SETTING_KEY, PRODUCT_SEARCH_CATEGORIES } from './ah-service.js';
import { escapeHtml, formatEuro } from './utils.js';
import { getLocale, initLanguage, t } from './i18n.js';
import { searchStaticProducts } from './static-products.js';

const LIST_KEY = 'myfood_frequent_products';
const SORT_KEY = 'myfood_product_comparison_sort';
const SCORE_CRITERIA_KEY = 'myfood_product_score_criteria';
const NUTRI_SCORES = ['A', 'B', 'C', 'D', 'E'];
const DEFAULT_SCORE_CRITERIA = { price: true, health: true, protein: true };
const PREVIEW_DEBOUNCE_MS = 800;
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
  return text ? text[0].toLocaleUpperCase(getLocale()) + text.slice(1) : '';
}

function normalizeProductQuery(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/**
 * Extracts the pack count, amount and unit from a product size string.
 * Handles multipacks ("2 x 250 g") and single packs ("1,5 kg").
 * @param {string} unitSize
 * @returns {{ packCount: number, amount: number, unit: 'kg'|'g' }}
 */
function parsePackSize(unitSize) {
  const multipack = unitSize.match(/(\d+)\s*[x×]\s*([\d.,]+)\s*(kg|g)\b/i);
  if (multipack) {
    return {
      packCount: Number(multipack[1]),
      amount: parseDutchNumber(multipack[2]),
      unit: multipack[3].toLowerCase()
    };
  }
  const singlePack = unitSize.match(/([\d.,]+)\s*(kg|g)\b/i);
  if (singlePack) {
    return {
      packCount: 1,
      amount: parseDutchNumber(singlePack[1]),
      unit: singlePack[2].toLowerCase()
    };
  }
  return { packCount: 1, amount: NaN, unit: 'kg' };
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
  const { packCount, amount, unit } = parsePackSize(unitSize);
  if (!Number.isFinite(amount) || amount <= 0) return null;
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
      return compareNullableDesc(a.healthScore, b.healthScore) ||
        compareNutriScore(a, b) ||
        compareNullable(a.pricePerKg, b.pricePerKg);
    }
    // Balanced: products with a score first, then highest score, then cheapest per kg,
    // then best Nutri-Score as a final tie-breaker.
    return compareNullableDesc(a.score, b.score) ||
      compareNullable(a.pricePerKg, b.pricePerKg) ||
      compareNutriScore(a, b);
  });
}

/**
 * Ascending comparator that puts missing (null/undefined) values last.
 */
function compareNullable(a, b) {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
  return a - b;
}

/**
 * Descending comparator that puts missing (null/undefined) values last.
 */
function compareNullableDesc(a, b) {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
  return b - a;
}

/**
 * Orders by Nutri-Score (A best) with unknown scores last.
 */
function compareNutriScore(a, b) {
  const rankA = NUTRI_SCORES.indexOf(a.nutriScore);
  const rankB = NUTRI_SCORES.indexOf(b.nutriScore);
  if (rankA === -1 || rankB === -1) return rankA === rankB ? 0 : rankA === -1 ? 1 : -1;
  return rankA - rankB;
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
    // Static data is loaded once; known queries never touch Albert Heijn.
    this.staticData = { products: null, prices: null, ready: false };
    this.staticDataPromise = null;
  }

  /**
   * Loads data/products.json and data/prices.json once.
   * @returns {Promise<{ products: Object|null, prices: Object|null }>}
   */
  loadStaticData() {
    if (this.staticData.ready) return Promise.resolve(this.staticData);
    if (this.staticDataPromise) return this.staticDataPromise;
    const read = async path => {
      try {
        const response = await fetch(path);
        if (!response.ok) return null;
        return await response.json();
      } catch {
        return null;
      }
    };
    this.staticDataPromise = Promise.all([read('./data/products.json'), read('./data/prices.json')])
      .then(([products, prices]) => {
        this.staticData = { products, prices, ready: true };
        this.staticDataPromise = null;
        return this.staticData;
      });
    return this.staticDataPromise;
  }

  /**
   * Tries to answer a query from the static database.
   * @param {Object} item
   * @param {boolean} forceRefresh
   * @returns {Promise<Object|null>} null when the live search should run
   */
  async staticResultFor(item, forceRefresh) {
    if (forceRefresh) return null;
    const { products, prices } = await this.loadStaticData();
    if (!products?.keys) return null;
    const result = searchStaticProducts(products, prices, item.query, {
      categoryLabel: item.categoryLabel || ''
    });
    if (!result.matched) return null;
    return result;
  }

  init() {
    this.initLanguage();
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
    const draftKey = this.getItemKey({
      query: normalizeProductQuery(draft.query),
      category: draft.category
    });
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
        result.query !== normalizeProductQuery(this.editingDraft.query) ||
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
    const query = normalizeProductQuery(draft?.query);
    if (!draft || !query) {
      this.setStatus(t('products.needQuery'));
      return;
    }
    const draftKey = this.getItemKey(draft);
    const result = this.results.get(draftKey);
    if (result?.status !== 'loaded' ||
        result.query !== query ||
        result.category !== (draft.category || '')) {
      this.setStatus(t('products.waitResults'));
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
      this.setStatus(t('products.gone'));
      return;
    }

    const savedItem = {
      query,
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
    this.setStatus(t('products.saved'));
  }

  bindEvents() {
    this.document.getElementById('detail-score-criteria')?.addEventListener('change', event => {
      const checkbox = event.target.closest('[data-score-criterion]');
      if (!checkbox || !this.editingDraft) return;
      const criterion = checkbox.dataset.scoreCriterion;
      const nextCriteria = { ...this.getItemCriteria(this.editingDraft), [criterion]: checkbox.checked };
      if (!Object.values(nextCriteria).some(Boolean)) {
        checkbox.checked = true;
        this.setStatus(t('products.chooseCriterion'));
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
      if (this.editingDraft) this.editingDraft.query = queryInput.value;
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

  initLanguage() {
    initLanguage({ onChange: () => this.onLanguageChanged() });
  }

  /**
   * Re-renders labels and status text after a language switch.
   */
  onLanguageChanged() {
    this.render();
    this.renderPreview();
    this.setStatus('');
  }

  initTheme() {
    const themeButton = this.document.getElementById('theme-toggle');
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const applyTheme = () => {
      const dark = this.storage.getItem('myfood_theme') === 'dark' ||
        (!this.storage.getItem('myfood_theme') && prefersDark);
      this.document.documentElement.classList.toggle('dark', dark);
      if (themeButton) {
        themeButton.setAttribute('aria-label', dark ? t('nav.themeToLight') : t('nav.themeToDark'));
        themeButton.setAttribute('title', dark ? t('nav.themeToLight') : t('nav.themeToDark'));
      }
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
      this.setStatus(t('products.needCategoryQuery'));
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
    const query = this.document.getElementById('product-query')?.value || '';
    const normalizedQuery = normalizeProductQuery(query);
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
    if (normalizedQuery.length < 2) {
      this.results.delete(this.getItemKey(this.editingDraft));
      this.setStatus(t('products.previewHint'));
      this.render();
      this.renderPreview();
      return;
    }

    this.preview.status = 'loading';
    this.setStatus(t('products.updating'));
    this.render();
    this.renderPreview();
    this.previewTimer = setTimeout(() => {
      if (requestId !== this.previewRequestId) return;
      this.preview = { query: normalizedQuery, category, categoryLabel, status: 'loading', products: [], error: '' };
      this.loadProducts({ ...this.editingDraft, query: normalizedQuery });
    }, PREVIEW_DEBOUNCE_MS);
  }

  renderPreview() {
    const preview = this.document.getElementById('product-preview');
    const saveButton = this.document.getElementById('save-edit-product');
    if (!preview || !saveButton) return;
    const draft = this.editingDraft;
    const result = draft ? this.results.get(this.getItemKey(draft)) : null;
    const { query, categoryLabel, status, error } = this.preview;
    if (!draft || !query || query.length < 2) {
      preview.innerHTML = `<p class="text-sm text-slate-500 dark:text-neutral-400">${this.escape(t('products.previewHintInline'))}</p>`;
    } else if (status === 'loading' || result?.status === 'loading') {
      preview.innerHTML = this.renderLoadingMessage(t('products.updating'));
    } else if (status === 'error') {
      preview.innerHTML = `<p class="text-sm text-rose-600 dark:text-rose-400">${this.escape(t('products.previewFailed', { message: error }))}</p>`;
    } else if (result?.status === 'error') {
      preview.innerHTML = `<p class="text-sm text-rose-600 dark:text-rose-400">${this.escape(t('products.fetchFailed', { message: result.message }))}</p>`;
    } else if (result?.status === 'empty') {
      preview.innerHTML = `<p class="text-sm text-slate-500 dark:text-neutral-400">${this.escape(t('products.noneInCategory', { category: categoryLabel ? t('products.productsInCategory', { category: categoryLabel }) : '', query }))}</p>`;
    } else if (result?.status === 'loaded' && result.query === query &&
        result.category === (draft.category || '')) {
      preview.innerHTML = `<p class="text-sm text-emerald-700 dark:text-emerald-300">${this.escape(t('products.productsLoaded', { count: result.products.length, category: categoryLabel ? t('products.productsInCategory', { category: categoryLabel }) : '' }))}</p>`;
    } else {
      preview.innerHTML = this.renderLoadingMessage(t('products.updatingResults'));
    }
    saveButton.disabled = !draft?.query?.trim() || result?.status !== 'loaded' ||
      result.query !== normalizeProductQuery(draft.query) || result.category !== (draft.category || '') ||
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
      this.setStatus(t('products.saveFailed'));
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
      // Static first: an ingredient Kost already knows needs no request.
      const staticResult = await this.staticResultFor(item, forceRefresh);
      const result = staticResult || await this.ahService.searchProducts(item.query, {
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
        // A static answer is complete: there is no next page to fetch.
        pageInfo: staticResult ? { nextPage: null, totalElements: products.length } : result.pageInfo,
        updatedAt: staticResult ? Date.parse(result.updatedAt || '') || null : result.updatedAt,
        stale: false,
        source: staticResult ? 'static' : 'live'
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
        this.setStatus(result.stale ? t('products.staleNotice') : '');
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
      product.nutritionStatic !== true &&
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
    return formatEuro(amount);
  }

  renderLoadingMessage(message, spacing = '') {
    return `<p role="status" class="flex items-center gap-2 text-sm text-slate-500 dark:text-neutral-400 ${spacing}">
      <svg aria-hidden="true" class="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <span>${this.escape(message)}</span>
    </p>`;
  }

  escape(value) {
    return escapeHtml(value);
  }

  renderProduct(product) {
    const bonus = product.isBonus && product.price < product.regularPrice;
    const healthClass = {
      A: 'bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-800/60',
      B: 'bg-lime-50 text-lime-700 ring-lime-200/70 dark:bg-lime-950/50 dark:text-lime-300 dark:ring-lime-800/60',
      C: 'bg-amber-50 text-amber-700 ring-amber-200/70 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-800/60',
      D: 'bg-orange-50 text-orange-700 ring-orange-200/70 dark:bg-orange-950/50 dark:text-orange-300 dark:ring-orange-800/60',
      E: 'bg-rose-50 text-rose-700 ring-rose-200/70 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-800/60'
    }[product.nutriScore] || 'bg-slate-100 text-slate-500 ring-slate-200/70 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700';
    const image = product.imageUrl
      ? `<img src="${this.escape(product.imageUrl)}" alt="" loading="lazy" class="h-full w-full object-contain">`
      : '<svg aria-hidden="true" class="h-5 w-5 text-slate-400 dark:text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l1 12H5L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>';
    const proteinInfo = this.nutritionLoading.has(product.id)
      ? t('products.proteinLoading')
      : product.nutritionLoadError
        ? t('products.proteinUnavailable')
        : product.proteinGrams !== undefined && product.proteinGrams !== null
          ? t('products.proteinInfo', { grams: product.proteinGrams, score: product.proteinScore === null ? t('products.proteinNoScore') : t('products.proteinScore', { score: product.proteinScore }) })
          : product.nutritionStatic
            ? t('products.proteinNoDataStatic')
            : t('products.proteinNoData');

    return `<article class="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 rounded-xl border px-3 py-2.5 transition sm:grid-cols-[2.75rem_minmax(0,1fr)_5.75rem_6.75rem_3.25rem] sm:gap-3 ${bonus ? 'border-amber-300/80 bg-amber-50/40 dark:border-amber-800/70 dark:bg-amber-950/20' : 'border-slate-200/80 bg-white hover:border-emerald-200 hover:bg-emerald-50/20 dark:border-white/10 dark:bg-neutral-900/40 dark:hover:border-emerald-500/30 dark:hover:bg-neutral-900'}">
      <span class="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-100 bg-white p-1 dark:border-white/10 dark:bg-neutral-800">
        ${image}
      </span>
      <div class="min-w-0">
        <a href="${this.escape(product.productUrl)}" target="_blank" rel="noopener noreferrer" class="block truncate text-sm font-semibold text-slate-800 transition hover:text-emerald-700 dark:text-neutral-100 dark:hover:text-emerald-400 sm:whitespace-normal">${this.escape(product.title)}</a>
        <p class="mt-0.5 truncate text-[11px] text-slate-500 dark:text-neutral-400">${this.escape(product.unitSize || t('products.packUnknown'))} <span class="text-slate-300 dark:text-neutral-600">·</span> <span class="font-medium text-blue-700 dark:text-blue-300" title="${this.escape(t('products.proteinHelp'))}">${this.escape(proteinInfo)}</span></p>
        ${product.isOnlineOnly || (product.bonusDescription && bonus) ? `
          <div class="mt-1 flex flex-wrap items-center gap-1">
            ${product.isOnlineOnly ? `<span class="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">${this.escape(t('products.onlineOnly'))}</span>` : ''}
            ${product.bonusDescription && bonus ? `<span class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">${this.escape(product.bonusDescription)}</span>` : ''}
          </div>
        ` : ''}
      </div>
      <div class="col-span-2 flex min-w-0 items-center justify-between gap-2 sm:contents">
        <span class="inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2 text-[11px] font-extrabold ring-1 ring-inset sm:col-start-3 sm:justify-self-end ${healthClass}" title="${this.escape(product.nutriScore ? t('products.nutriTitle', { score: product.nutriScore }) : t('products.noNutriTitle'))}">
          <span class="hidden sm:inline">Nutri-Score&nbsp;</span>${product.nutriScore ? this.escape(product.nutriScore) : `<span class="sm:hidden">—</span><span class="hidden sm:inline">${this.escape(t('products.noNutri'))}</span>`}
        </span>
        <div class="flex min-w-0 items-baseline gap-x-2 sm:col-start-4 sm:block sm:min-w-24 sm:justify-self-end sm:text-right">
          <div class="flex shrink-0 items-baseline gap-1.5 sm:justify-end">
            <p class="text-sm font-bold ${bonus ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-white'}">${this.formatEuro(product.price)}</p>
            ${bonus ? `<p class="text-[11px] text-slate-500 dark:text-neutral-400 line-through">${this.formatEuro(product.regularPrice)}</p>` : ''}
          </div>
          <p class="text-[11px] font-medium text-slate-500 dark:text-neutral-400 sm:text-right">${product.pricePerKg === null ? this.escape(t('products.noPricePerKg')) : this.escape(t('products.perKg', { price: this.formatEuro(product.pricePerKg) }))}</p>
        </div>
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-800/60 sm:col-start-5 sm:h-9 sm:w-9 sm:justify-self-end sm:text-sm" title="${this.escape(t('products.scoreTitle'))}">${product.score === null ? '—' : product.score}</span>
      </div>
    </article>`;
  }

  renderOverviewItem(item) {
    const key = this.getItemKey(item);
    const result = this.results.get(key);
    const categoryLabel = getProductSearchCategoryLabel(item.category, item.categoryLabel);
    let summary = t('products.loading');
    let bestProduct = null;
    if (result?.status === 'error') {
      summary = t('products.loadFailed');
    } else if (result?.status === 'empty') {
      summary = t('products.noneFound');
    } else if (result?.status === 'loaded') {
      bestProduct = sortComparedProducts(
        result.products,
        this.sortMode,
        this.getItemCriteria(item)
      )[0];
      summary = t(result.products.length === 1 ? 'products.optionsOne' : 'products.optionsMany', { count: result.products.length });
    }

    return `<article class="flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white p-2 shadow-sm transition hover:border-emerald-200 hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_32px_-24px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-neutral-900/50 dark:hover:border-emerald-500/30 sm:p-3">
      <button type="button" data-open-group="${this.escape(key)}" class="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl p-2 text-left transition hover:bg-slate-50 dark:hover:bg-white/5">
        <span class="min-w-0 flex-1">
          <span class="font-display block truncate text-base font-semibold text-slate-900 dark:text-white">${this.escape(capitalizeFirstLetter(item.query || t('products.new')))}</span>
          <span class="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-neutral-400">
            ${categoryLabel ? `<span class="rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-800/60">${this.escape(capitalizeFirstLetter(categoryLabel))}</span>` : ''}
            <span class="rounded-md bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600 dark:bg-white/10 dark:text-neutral-300">${this.escape(capitalizeFirstLetter(summary))}</span>
            ${bestProduct ? `<span class="min-w-0 truncate font-medium text-slate-500 dark:text-neutral-400">${this.escape(capitalizeFirstLetter(bestProduct.title))} · ${this.formatEuro(bestProduct.price)}</span>` : ''}
          </span>
        </span>
        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-slate-200/80 text-slate-400 dark:text-neutral-400 dark:border-white/10" aria-hidden="true">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>
        </span>
      </button>
      ${item.isDraft ? '' : `<button type="button" data-action="remove" data-group-key="${this.escape(key)}" aria-label="${this.escape(t('products.removeAria', { name: item.query }))}" class="rounded-lg p-2 text-slate-400 dark:text-neutral-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"><svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg></button>`}
    </article>`;
  }

  renderGroup(item) {
    const key = this.getItemKey(item);
    const result = this.results.get(key);
    let body;
    if (!result || result.status === 'loading') {
      body = this.renderLoadingMessage(t('products.liveLoading'), 'py-6');
    } else if (result.status === 'error') {
      body = `<div class="rounded-xl border border-rose-200/70 bg-rose-50/60 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300">${this.escape(t('products.groupFailed', { message: result.message }))}</div>`;
    } else if (result.status === 'empty') {
      const filteredOnlineOnly = this.ahService.getIgnoreOnlineOnlyProducts();
      body = `<div class="flex flex-col items-center rounded-xl border border-dashed border-slate-300 px-5 py-10 text-center dark:border-white/15">
        <span class="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-400 dark:bg-white/10 dark:text-neutral-500">
          <svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        </span>
        <p class="mt-3 max-w-sm text-sm text-slate-500 dark:text-neutral-400">
          ${this.escape(t('products.emptyGroup'))}
          ${filteredOnlineOnly ? this.escape(t('products.emptyGroupFiltered')) : ''}
        </p>
      </div>`;
    } else {
      const products = sortComparedProducts(result.products, this.sortMode, this.getItemCriteria(item));
      const categoryLabel = getProductSearchCategoryLabel(item.category, item.categoryLabel);
      const updatedAt = result.updatedAt
        ? new Intl.DateTimeFormat(getLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(result.updatedAt)
        : '';
      const pageStatus = result.pageInfo?.totalElements
        ? t('products.resultCount', {
          shown: result.products.length,
          category: categoryLabel ? t('products.categoryPrefix', { category: categoryLabel }) : '',
          total: result.pageInfo.totalElements
        })
        : '';
      const productTableHeader = `<div class="mt-3 hidden grid-cols-[2.75rem_minmax(0,1fr)_5.75rem_6.75rem_3.25rem] items-center gap-3 px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-neutral-400 sm:grid"><span class="col-span-2 text-left">${this.escape(t('products.columnProduct'))}</span><span class="col-start-3 text-right">${this.escape(t('products.columnNutri'))}</span><span class="col-start-4 text-right">${this.escape(t('products.columnPrice'))}</span><span class="col-start-5 text-right">${this.escape(t('products.columnScore'))}</div>`;
      const staleNotice = result.stale
        ? `<span class="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300"><span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span> ${this.escape(t('products.stale'))}</span>`
        : updatedAt
          ? `<span class="inline-flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full ${result.source === 'static' ? 'bg-indigo-500' : 'bg-emerald-500'}"></span> ${this.escape(result.source === 'static' ? t('products.staticUpdatedAt', { date: updatedAt }) : t('products.updatedAt', { date: updatedAt }))}</span>`
          : '';
      const liveNotice = result.source === 'live'
        ? `<p class="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">${this.escape(t('products.liveNotice'))}</p>`
        : '';
      const moreButton = result.pageInfo?.nextPage !== null && result.pageInfo?.nextPage !== undefined
        ? `<div class="pt-4 text-center">
            ${result.pageError ? `<p class="mb-2 text-sm text-rose-600 dark:text-rose-400">${this.escape(t('products.loadMoreFailed', { message: result.pageError }))}</p>` : ''}
            <button type="button" data-action="load-more" data-group-key="${this.escape(key)}" ${this.loadingMore.has(key) ? 'disabled' : ''}
              class="inline-flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-emerald-200 hover:text-emerald-800 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-neutral-200 dark:hover:border-emerald-500/30 dark:hover:text-emerald-300">
              ${this.loadingMore.has(key) ? this.escape(t('products.loadingMore')) : this.escape(t('products.loadMore'))}
            </button>
          </div>`
        : '';
      body = `<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] font-medium text-slate-500 dark:text-neutral-400"><span>${pageStatus}</span><span class="ml-auto text-right">${staleNotice}</span></div>${liveNotice}${productTableHeader}<div class="mt-1 space-y-2">${products.map(product => this.renderProduct(product)).join('')}</div>${moreButton}`;
    }

    return `<section class="surface-card p-4 sm:p-5">
      ${body}
    </section>`;
  }

  render() {
    this.renderPreview();
    const groups = this.document.getElementById('product-groups');
    if (!groups) return;
    groups.innerHTML = this.items.length
      ? this.items.map(item => this.renderOverviewItem(item)).join('')
      : `<div class="surface-card flex flex-col items-center justify-center px-6 py-16 text-center">
          <span class="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400 dark:bg-white/10 dark:text-neutral-500">
            <svg aria-hidden="true" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 8h12l1 12H5L6 8Z"/>
              <path d="M9 8V6a3 3 0 0 1 6 0v2"/>
            </svg>
          </span>
          <h2 class="font-display mt-4 text-lg font-semibold text-slate-900 dark:text-white">${this.escape(t('products.emptyTitle'))}</h2>
          <p class="mt-1 max-w-sm text-sm text-slate-500 dark:text-neutral-400">${this.escape(t('products.emptyBody'))}</p>
        </div>`;
    const detail = this.document.getElementById('product-detail');
    const selectedItem = this.editingDraft ||
      this.items.find(item => this.getItemKey(item) === this.selectedItemKey);
    const selectedTitle = this.document.getElementById('selected-product-title');
    const refreshButton = this.document.getElementById('refresh-selected-product');
    if (selectedTitle) {
      selectedTitle.textContent = capitalizeFirstLetter(selectedItem?.query || t('products.new'));
    }
    if (refreshButton) {
      refreshButton.dataset.groupKey = selectedItem ? this.getItemKey(selectedItem) : '';
      refreshButton.disabled = !selectedItem;
    }
    if (detail) {
      detail.innerHTML = selectedItem
        ? this.renderGroup(selectedItem)
        : `<div class="surface-card px-6 py-12 text-center text-sm text-slate-500 dark:text-neutral-400">${this.escape(t('products.select'))}</div>`;
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
