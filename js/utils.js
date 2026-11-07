/**
 * Shared helpers used across the app.
 * Keeping these in one place avoids drift between the HTML escapers and
 * currency formatters that were previously duplicated per module.
 */

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

const EURO_FORMATTERS = {
  'nl-NL': new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }),
  'en-GB': new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' })
};

/**
 * Escapes a value for safe interpolation into HTML text/attribute contexts.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => HTML_ESCAPE_MAP[character]);
}

/**
 * Formats an amount as euro currency for the given locale.
 * Non-finite values render as the zero amount for that locale.
 * @param {number} amount
 * @param {string} [locale]
 * @returns {string}
 */
export function formatEuro(amount, locale = 'nl-NL') {
  const formatter = EURO_FORMATTERS[locale] || EURO_FORMATTERS['nl-NL'];
  if (Number.isFinite(amount)) return formatter.format(amount);
  return locale === 'en-GB' ? '€0.00' : '€ 0,00';
}
