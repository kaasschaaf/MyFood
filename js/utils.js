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

const EURO_FORMATTER = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR'
});

/**
 * Escapes a value for safe interpolation into HTML text/attribute contexts.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => HTML_ESCAPE_MAP[character]);
}

/**
 * Formats an amount as Dutch euro currency. Non-finite values render as € 0,00.
 * @param {number} amount
 * @returns {string}
 */
export function formatEuro(amount) {
  return Number.isFinite(amount) ? EURO_FORMATTER.format(amount) : '€ 0,00';
}
