/**
 * Builds the short description shown on a recipe card.
 *
 * The dataset has no description field, so one is generated from what is known:
 * cuisine, course and the first few ingredients. Both languages are stored, so
 * a card never needs a runtime translation.
 */

const COURSE_NL = {
  Hoofdgerecht: 'hoofdgerecht',
  Recept: 'recept'
};

/**
 * Lowercases the first letter unless it starts with an abbreviation.
 * @param {string} value
 * @returns {string}
 */
function lowerFirst(value) {
  const text = String(value || '');
  if (!text) return text;
  if (/^[A-Z]{2,}/.test(text)) return text;
  return text[0].toLocaleLowerCase('nl-NL') + text.slice(1);
}

/**
 * Joins names as "a, b and c".
 * @param {string[]} names
 * @param {string} conjunction
 * @returns {string}
 */
function joinNames(names, conjunction) {
  const list = names.filter(Boolean).slice(0, 3);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} ${conjunction} ${list[list.length - 1]}`;
}

/**
 * @param {{ cuisine?: string, mealType?: string, ingredients?: Array<{name?: string, nameEn?: string}> }} recipe
 * @returns {{ description: string, descriptionEn: string }}
 */
export function describeRecipe({ cuisine = '', mealType = '', ingredients = [] } = {}) {
  const namesNl = ingredients.map(ingredient => lowerFirst(ingredient.name)).filter(Boolean);
  const namesEn = ingredients.map(ingredient => lowerFirst(ingredient.nameEn || ingredient.name)).filter(Boolean);
  const courseNl = COURSE_NL[mealType] || lowerFirst(mealType) || 'gerecht';
  const courseEn = mealType === 'Hoofdgerecht' ? 'main course' : lowerFirst(mealType) || 'dish';
  const areaNl = cuisine && cuisine !== 'Internationaal' ? cuisine : '';
  const areaEn = cuisine && cuisine !== 'Internationaal' ? cuisine.replace(/s$/, '') : 'International';

  const listNl = joinNames(namesNl, 'en');
  const listEn = joinNames(namesEn, 'and');
  const leadNl = areaNl ? `${areaNl} ${courseNl}` : `Een ${courseNl}`;
  const leadEn = `${areaEn} ${courseEn}`;

  const description = listNl ? `${leadNl} met ${listNl}.` : `${leadNl}.`;
  const descriptionEn = listEn ? `${leadEn} with ${listEn}.` : `${leadEn}.`;
  return {
    description: description[0].toLocaleUpperCase('nl-NL') + description.slice(1),
    descriptionEn: descriptionEn[0].toLocaleUpperCase('en-GB') + descriptionEn.slice(1)
  };
}
