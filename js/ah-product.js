/**
 * AH product normalisation, shared by the app and the data pipeline.
 *
 * The AH mobile API returns a wide object per product; everything Kost shows
 * (price, pack size, bonus label, image, online-only flag) comes from this one
 * mapping, so a product baked into data/prices.json looks exactly like one
 * fetched live on the Mijn producten page.
 */

/**
 * Whether a product can only be ordered online (not sold in a store).
 * @param {Object} product raw AH product
 * @returns {boolean}
 */
export function isOnlineOnlyProduct(product) {
  if (!product) return false;
  if (product.isOnlineOnly === true ||
      product.onlineOnly === true ||
      product.onlineExclusive === true ||
      product.isVirtualBundle === true ||
      /ONLINE_ONLY|ONLINE_EXCLUSIVE/i.test(String(product.orderAvailabilityStatus || '')) ||
      (product.availableOnline === true &&
        (product.availableInStore === false || product.isAvailableInStore === false))) {
    return true;
  }
  const availabilityDescription = [
    product.title,
    product.description,
    product.descriptionFull,
    product.descriptionHighlights,
    product.orderAvailabilityDescription,
    product.mainCategory,
    product.subCategory,
    ...(Array.isArray(product.extraDescriptions) ? product.extraDescriptions : []),
    ...(Array.isArray(product.stickers)
      ? product.stickers.flatMap(sticker => [sticker?.description, sticker?.label, sticker?.title])
      : []),
    ...(Array.isArray(product.propertyIcons)
      ? product.propertyIcons.flatMap(icon => [icon?.description, icon?.label, icon?.title])
      : [])
  ].filter(value => typeof value === 'string').join(' ');
  if (/alleen\s+online|uitsluitend\s+online|online[-\s]only|online[-\s]exclusief|alleen\s+via\s+(?:de\s+)?webshop/i.test(availabilityDescription)) {
    return true;
  }

  const category = `${product.mainCategory || ''} ${product.subCategory || ''}`;
  const digitalProduct = /beltegoed|sim[-\s]?kaarten|digitale?\s+(?:code|opwaardering|voucher)|e[-\s]?gift/i
    .test(`${category} ${product.description || product.descriptionFull || ''}`);
  return digitalProduct && /\bonline\b|digitale?\s+(?:code|opwaardering|voucher)|e[-\s]?gift/i
    .test(`${product.title || ''} ${product.description || product.descriptionFull || ''}`);
}

/**
 * Maps a raw AH product onto the app's product shape.
 * @param {Object} product
 * @returns {Object|null} null when the product is unusable (no id or no price)
 */
export function normalizeProduct(product) {
  const currentPrice = Number(product?.currentPrice);
  const regularPrice = Number(product?.priceBeforeBonus);
  const price = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : regularPrice;
  if (!product || !Number.isFinite(price) || price <= 0 ||
      (product.webshopId === undefined && product.hqId === undefined)) return null;
  const bonusDescription = product.discountLabels?.map(label => label.defaultDescription).filter(Boolean).join(', ')
    || product.bonusPeriodDescription || '';
  return {
    id: String(product.webshopId ?? product.hqId ?? ''),
    title: product.title || 'AH-product',
    price,
    regularPrice: Number.isFinite(regularPrice) && regularPrice > 0 ? regularPrice : price,
    unitSize: product.salesUnitSize || '',
    unitPriceDescription: product.unitPriceDescription || '',
    isBonus: Boolean(product.isBonus),
    bonusDescription,
    nutriScore: String(product.nutriscore || '').toUpperCase(),
    imageUrl: product.images?.find(image => image.url)?.url || '',
    priceIsRegularFallback: !(Number.isFinite(currentPrice) && currentPrice > 0),
    availableOnline: Boolean(product.availableOnline),
    isVirtualBundle: product.isVirtualBundle === true,
    isOnlineOnly: isOnlineOnlyProduct(product),
    isOrderable: product.isOrderable !== false,
    mainCategory: product.mainCategory || '',
    subCategory: product.subCategory || '',
    productUrl: product.webshopId
      ? `https://www.ah.nl/producten/product/wi${encodeURIComponent(product.webshopId)}`
      : `https://www.ah.nl/zoeken?query=${encodeURIComponent(product.title || '')}`
  };
}
