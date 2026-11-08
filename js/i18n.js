/**
 * Lightweight internationalisation for the Kost interface.
 *
 * The interface is fully translated through a static dictionary. Recipe
 * content itself comes from Allerhande/TheMealDB and is translated on demand
 * by content-translator.js (Gemini, cached).
 */

const STORAGE_KEY = 'myfood_language';
const DEFAULT_LANGUAGE = 'nl';
const SUPPORTED = ['nl', 'en'];

const listeners = new Set();

const DICTIONARY = {
  nl: {
    'page.title': 'Kost - Recepten, AH Bonus Prijzen & AI Kookhulp',
    'page.productsTitle': 'Mijn producten vergelijken - Kost',
    'page.recipesRegion': 'Recepten',
    'page.productsRegion': 'Mijn producten',
    'page.detailRegion': 'Productdetails',
    'app.productsSubtitle': 'Productvergelijker',
    'nav.label': 'Onderdelen van Kost',
    'nav.recipes': 'Recepten',
    'nav.products': 'Producten',
    'nav.settings': 'Gemini AI-instellingen',
    'nav.settingsShort': 'Gemini AI',
    'nav.theme': 'Wissel thema',
    'nav.themeToLight': 'Schakel naar licht thema',
    'nav.themeToDark': 'Schakel naar donker thema',
    'nav.language': 'Wissel taal',
    'nav.languageTo': 'Schakel naar Engels',
    'portions.label': 'Porties',
    'portions.for': 'Porties berekend voor',
    'portions.less': '1 persoon minder',
    'portions.more': '1 persoon meer',
    'portions.people': '{count} pers.',

    'catalog.eyebrow': 'Recepten',
    'catalog.title': 'Wat kook je vandaag?',
    'catalog.subtitle': 'Kies een gerecht en bekijk direct wat de ingrediënten bij Albert Heijn kosten.',
    'catalog.loading': 'Recepten laden…',
    'catalog.results': '{count} recepten gevonden',
    'catalog.resultsWithLinks': '{count} recepten · {links} Allerhande-links',
    'catalog.searchLabel': 'Zoek recepten',
    'catalog.searchPlaceholder': 'Zoek op gerecht, keuken of trefwoord…',
    'catalog.sortLabel': 'Sorteer recepten',
    'catalog.sort.default': 'Sortering: Aanbevolen',
    'catalog.sort.priceAsc': 'Goedkoopst per persoon',
    'catalog.sort.bonusDesc': 'Meeste bonusvoordeel',
    'catalog.sort.proteinDesc': 'Meeste proteïne (g)',
    'catalog.sort.healthDesc': 'Hoogste gezondheidsscore',
    'catalog.sort.timeAsc': 'Kortste bereidingstijd',
    'catalog.filtersLabel': 'Filter op keukenstijl',
    'catalog.quickFilters': 'Snelfilters',
    'catalog.allCuisines': 'Alle stijlen',
    'catalog.bonusOnly': 'AH Bonus deals',
    'catalog.highProtein': 'Eiwitrijk (>30 g)',
    'catalog.quick': 'Snel (<25 min)',
    'catalog.emptyTitle': 'Geen recepten gevonden',
    'catalog.emptyBody': 'Probeer een ander trefwoord of wis je actieve filters.',
    'catalog.loadMore': 'Laad meer recepten',
    'catalog.card.ingredientsFor': 'Berekend voor {count} personen',
    'catalog.card.allerhande': 'Bekijk op Allerhande',
    'catalog.card.allerhandeBadge': 'Allerhande',
    'catalog.card.external': 'Externe link',
    'catalog.card.noIngredients': 'Ingrediënten op Allerhande',
    'catalog.card.ingredientsCount': '{count} ingrediënten',
    'catalog.card.details': 'Kookhulp & details',
    'catalog.card.priceEstimate': 'Prijsindicatie',
    'catalog.card.partial': 'gedeeltelijk · ',
    'catalog.card.perPerson': '{price} p.p.',
    'catalog.card.match': 'Match {matched}/{total}',
    'catalog.card.saving': '−{amount} voordeel',
    'catalog.card.bonus': 'AH Bonus',
    'catalog.card.font': 'Eiwit',
    'catalog.card.health': 'Gezondheid',
    'catalog.card.high': 'Hoog',
    'catalog.card.perPortion': '/ p.p.',
    'catalog.card.noPriceAllerhande': 'Open bij Allerhande voor ingrediënten en prijzen',
    'catalog.card.pricing': 'AH-prijzen worden berekend',
    'catalog.card.noPrice': 'AH-prijs niet beschikbaar',
    'catalog.status.checking': 'Live AH-prijzen ophalen voor {count} recepten op deze pagina…',
    'catalog.status.details': 'Receptgegevens opgehaald: {done}/{total}',
    'catalog.status.progress': 'AH-prijzen gecontroleerd: {done}/{total}',
    'catalog.status.done': 'AH-prijzen gecontroleerd voor {total} recepten',
    'catalog.status.withErrors': ' · {count} met zoekfouten',
    'catalog.status.failed': 'AH-prijzen bijwerken is mislukt: {message}',
    'catalog.status.none': 'Geen recepten om AH-prijzen voor op te halen.',

    'recipe.loading': 'Receptdetails en AH-producten laden…',
    'recipe.loadFailed': 'Receptdetails konden niet worden geladen: {message}',
    'recipe.close': 'Sluiten',
    'recipe.minutes': '{count} minuten',
    'recipe.notListed': 'Niet vermeld',
    'recipe.persons': 'Aantal personen',
    'recipe.personsShort': '{count} pers.',
    'recipe.priceEstimate': 'AH-prijsindicatie ({count} pers.)',
    'recipe.partialPrice': 'Gedeeltelijke prijs · {matched}/{total} matches, {priced} berekend',
    'recipe.bonusSaving': 'Bonusvoordeel',
    'recipe.noPrice': 'AH-prijzen zijn niet beschikbaar voor dit externe recept.',
    'recipe.updatedAt': 'Laatst bijgewerkt: {date}',
    'recipe.stalePrices': 'AH was niet bereikbaar; deels getoonde productgegevens komen uit de cache.',
    'recipe.calories': 'Calorieën p.p.',
    'recipe.protein': 'Eiwit p.p.',
    'recipe.carbs': 'Koolhydraten p.p.',
    'recipe.fat': 'Vetten p.p.',
    'recipe.ingredients': 'Ingrediënten',
    'recipe.ingredientsHint': 'Klik voor AH-opties',
    'recipe.instructions': 'Bereidingswijze',
    'recipe.instructionsHint': 'Stap voor stap koken',
    'recipe.originalOn': 'Bekijk het originele recept op {source}',
    'recipe.options.eyebrow': 'Ingrediënt uit dit recept',
    'recipe.options.back': 'Terug naar recept',
    'recipe.options.availableOne': '{count} AH-optie beschikbaar',
    'recipe.options.availableMany': '{count} AH-opties beschikbaar',
    'recipe.options.none': 'Bekijk beschikbare AH-producten',
    'recipe.options.withBonus': '{count} met bonus',
    'recipe.options.used': '{amount} gebruikt',
    'recipe.options.choose': 'Kies een product en open het bij AH',
    'recipe.options.bonusShown': 'bonus getoond',
    'recipe.options.chosen': 'Gekozen',
    'recipe.options.cheapest': 'Goedkoopst',
    'recipe.options.notIngredient': 'Ander product',
    'recipe.options.noMatch': 'Geen passend product gevonden; kies hieronder zelf.',
    'recipe.options.ariaOpen': 'Bekijk AH-producten voor {name}',
    'recipe.options.optionsOne': '{count} AH-optie',
    'recipe.options.optionsMany': '{count} AH-opties',
    'recipe.options.viewProduct': 'Bekijk AH-product',
    'recipe.options.onlineOnly': 'alleen online',
    'recipe.options.cache': 'cache',
    'recipe.options.bonus': 'Bonus',
    'recipe.ahSearchFailed': 'AH zoeken mislukt: {message}',
    'recipe.ahUnavailable': 'AH-zoekresultaten niet beschikbaar',
    'recipe.searchAtAH': 'Zoek bij AH',
    'recipe.shopAtAH': 'Shop bij AH',
    'recipe.ahArticle': 'AH artikel',
    'recipe.viewAt': '{title} bekijken bij Albert Heijn',
    'recipe.bonusTitle': '{label} · −{amount}',
    'recipe.translating': 'Recept vertalen…',
    'recipe.translateNeedsKey': 'Receptteksten blijven Nederlands tot je een Gemini API-sleutel instelt.',

    'ai.title': 'Vraag Gemini Kookassistent',
    'ai.subtitle': 'Stel een vraag over ingrediënten vervangen, bereiding of tips',
    'ai.keyButton': 'API-sleutel',
    'ai.quick.protein': 'Eiwitrijker maken',
    'ai.quick.replace': 'Ingrediënten vervangen',
    'ai.quick.wine': 'Wijn- & drankparing',
    'ai.quick.veg': 'Vegetarische variant',
    'ai.placeholder': 'Stel een vraag over dit gerecht aan Gemini…',
    'ai.placeholderDisabled': 'Vul eerst je Gemini API-key in om vragen te stellen…',
    'ai.ask': 'Vraag',
    'ai.thinking': 'Chef Gemini denkt na over: “{question}”…',
    'ai.answer': 'Antwoord van Chef Gemini:',
    'ai.label': 'Stel een vraag aan Gemini',

    'settings.title': 'Instellingen',
    'settings.subtitle': 'AI-kookhulp en productvoorkeuren',
    'settings.intro': 'Om vragen over recepten te stellen aan Chef Gemini heb je een gratis Google Gemini API key nodig. Deze wordt uitsluitend lokaal in je eigen browser (<code class="rounded bg-slate-100 px-1 py-0.5 text-[11px] dark:bg-neutral-800">localStorage</code>) bewaard en nooit gedeeld.',
    'settings.ignoreOnline': 'Negeer producten die alleen online verkrijgbaar zijn',
    'settings.ignoreOnlineHelp': 'Geldt overal voor receptmatches en productvergelijkingen.',
    'settings.apiKey': 'Google Gemini API-sleutel',
    'settings.noKeyTitle': 'Nog geen sleutel?',
    'settings.noKeyBody': 'Maak er in één minuut gratis eentje aan via',
    'settings.save': 'Opslaan & activeren',

    'footer.tagline': 'Jouw persoonlijke kookassistent.',
    'footer.note': 'AH-productgegevens worden anoniem opgehaald en lokaal gecachet. Recepten: Allerhande en TheMealDB. AI: Google Gemini.',

    'products.eyebrow': 'Productvergelijker',
    'products.title': 'Mijn vaste producten',
    'products.subtitle': 'Vergelijk AH-opties op actuele prijs, bonus, Nutri-Score en eiwit.',
    'products.add': 'Product toevoegen',
    'products.emptyTitle': 'Je lijst is nog leeg',
    'products.emptyBody': 'Voeg een product toe dat je vaak koopt om AH-opties te vergelijken.',
    'products.select': 'Selecteer een product uit je lijst.',
    'products.new': 'Nieuw product',
    'products.overview': 'Overzicht',
    'products.refresh': 'Vernieuwen',
    'products.edit': 'Aanpassen',
    'products.cancel': 'Annuleren',
    'products.save': 'Opslaan',
    'products.queryLabel': 'Product of productsoort',
    'products.queryPlaceholder': 'Bijvoorbeeld: magere kwark, kipfilet, olijfolie',
    'products.categoryLabel': 'Zoekcategorie',
    'products.allCategories': 'Alle categorieën',
    'products.categoryBreadToppings': 'Broodbeleg',
    'products.refreshCategories': 'Vernieuwen',
    'products.previewHint': 'Vul minimaal 2 tekens in om AH-producten te zoeken.',
    'products.previewHintInline': 'Vul minimaal 2 tekens in om direct de bijbehorende AH-producten te bekijken.',
    'products.criteriaLegend': 'Wat is belangrijk voor dit product? (gelijke weging)',
    'products.criteriaPrice': 'Prijs per kilo',
    'products.criteriaHealth': 'Nutri-Score',
    'products.criteriaProtein': 'Eiwit per kcal',
    'products.criteriaHelp': 'Pas de instellingen aan in bewerkmodus. Opslaan bewaart alle wijzigingen; ontbrekende gegevens tellen niet mee.',
    'products.sortBy': 'Sorteer op',
    'products.sortBalanced': 'Beste score',
    'products.sortPrice': 'Laagste prijs per kg',
    'products.sortHealth': 'Beste Nutri-Score',
    'products.removeAria': 'Verwijder {name} uit mijn lijst',
    'products.optionsOne': '{count} optie',
    'products.optionsMany': '{count} opties',
    'products.loadFailed': 'Producten konden niet worden opgehaald.',
    'products.noneFound': 'Geen vergelijkbare producten met prijs gevonden.',
    'products.loading': 'AH-producten laden…',
    'products.productsLoaded': '{count} AH-opties geladen{category}.',
    'products.productsInCategory': ' in {category}',
    'products.previewFailed': 'Voorbeeld ophalen mislukt: {message}',
    'products.fetchFailed': 'AH-producten ophalen mislukt: {message}',
    'products.noneInCategory': 'Geen AH-producten gevonden{category} voor “{query}”.',
    'products.footer': 'AH-aanbiedingen kunnen wijzigen en kunnen afhankelijk zijn van winkel, account of actievoorwaarden.',
    'products.columnProduct': 'AH-product · verpakking',
    'products.columnNutri': 'Nutri-Score',
    'products.columnPrice': 'Prijs/kg',
    'products.columnScore': 'Score',
    'products.updating': 'AH-producten worden bijgewerkt…',
    'products.updatingResults': 'AH-resultaten bijwerken…',
    'products.noPricePerKg': '€/kg n.b.',
    'products.perKg': '{price} / kg',
    'products.noNutri': 'Geen score',
    'products.proteinLoading': 'Eiwitgegevens laden…',
    'products.proteinUnavailable': 'Eiwitgegevens niet beschikbaar',
    'products.proteinInfo': 'Eiwit {grams} g / 100 g · {score}',
    'products.proteinScore': 'score {score}',
    'products.proteinNoScore': 'score n.b.',
    'products.proteinNoData': 'Eiwitscore niet beschikbaar',
    'products.onlineOnly': 'Alleen online',
    'products.packUnknown': 'Verpakking niet vermeld',
    'products.scoreTitle': 'Productscore op basis van de geselecteerde criteria',
    'products.nutriTitle': 'Nutri-Score {score}',
    'products.noNutriTitle': 'Geen Nutri-Score beschikbaar',
    'products.proteinHelp': 'Eiwitscore is het aandeel van de calorieën dat uit eiwit komt, berekend met AH-voedingswaarden per 100 g.',
    'products.updatedAt': '{date} bijgewerkt',
    'products.stale': 'AH niet bereikbaar; opgeslagen resultaten',
    'products.resultCount': '{shown} {category}opties · {total} AH-resultaten',
    'products.categoryPrefix': '{category}-',
    'products.loadMore': 'Meer AH-resultaten laden',
    'products.loadingMore': 'Meer resultaten laden…',
    'products.loadMoreFailed': 'Meer resultaten ophalen mislukt: {message}',
    'products.liveLoading': 'Live AH-producten laden…',
    'products.groupFailed': 'Producten ophalen mislukt: {message}',
    'products.emptyGroup': 'Geen producten met een bekende prijs gevonden. Probeer een andere zoekterm.',
    'products.emptyGroupFiltered': 'Pas de online-only instelling in bewerkmodus aan om deze producten te tonen.',
    'products.saved': 'Productinstellingen opgeslagen.',
    'products.duplicate': '“{query}” staat al in je lijst in deze categorie.',
    'products.needQuery': 'Vul een product of productsoort in voordat je opslaat.',
    'products.waitResults': 'Wacht tot de AH-resultaten voor deze zoekopdracht zijn bijgewerkt.',
    'products.gone': 'Dit product staat niet meer in je lijst. Open het overzicht opnieuw.',
    'products.chooseCriterion': 'Kies minimaal één criterium voor de productscore.',
    'products.needCategoryQuery': 'Vul eerst minimaal 2 tekens in om AH-categorieën op te halen.',
    'products.saveFailed': 'Opslaan van je lijst is mislukt. Controleer de opslagruimte van je browser.',
    'products.staleNotice': 'AH was niet bereikbaar; resultaten worden bijgewerkt vanaf opgeslagen gegevens.',
    'products.matchSaved': 'Productkeuze opgeslagen.',
    'products.matchSaveFailed': 'Productkeuze opslaan mislukt: {message}',
    'products.settingsFailed': 'Productinstelling opslaan of toepassen is mislukt: {message}',
    'products.onlineSettingFailed': 'AH-matches voor de online-only instelling konden niet worden bijgewerkt.'
  },

  en: {
    'page.title': 'Kost - Recipes, AH Bonus Prices & AI Cooking Help',
    'page.productsTitle': 'Compare my products - Kost',
    'page.recipesRegion': 'Recipes',
    'page.productsRegion': 'My products',
    'page.detailRegion': 'Product details',
    'app.productsSubtitle': 'Product comparison',
    'nav.label': 'Sections of Kost',
    'nav.recipes': 'Recipes',
    'nav.products': 'Products',
    'nav.settings': 'Gemini AI settings',
    'nav.settingsShort': 'Gemini AI',
    'nav.theme': 'Toggle theme',
    'nav.themeToLight': 'Switch to light theme',
    'nav.themeToDark': 'Switch to dark theme',
    'nav.language': 'Toggle language',
    'nav.languageTo': 'Switch to Dutch',
    'portions.label': 'Portions',
    'portions.for': 'Portions calculated for',
    'portions.less': 'One person fewer',
    'portions.more': 'One person more',
    'portions.people': '{count} people',

    'catalog.eyebrow': 'Recipes',
    'catalog.title': 'What are you cooking today?',
    'catalog.subtitle': 'Pick a dish and see instantly what its ingredients cost at Albert Heijn.',
    'catalog.loading': 'Loading recipes…',
    'catalog.results': '{count} recipes found',
    'catalog.resultsWithLinks': '{count} recipes · {links} Allerhande links',
    'catalog.searchLabel': 'Search recipes',
    'catalog.searchPlaceholder': 'Search by dish, cuisine or keyword…',
    'catalog.sortLabel': 'Sort recipes',
    'catalog.sort.default': 'Sort: Recommended',
    'catalog.sort.priceAsc': 'Cheapest per person',
    'catalog.sort.bonusDesc': 'Biggest bonus savings',
    'catalog.sort.proteinDesc': 'Most protein (g)',
    'catalog.sort.healthDesc': 'Highest health score',
    'catalog.sort.timeAsc': 'Shortest cooking time',
    'catalog.filtersLabel': 'Filter by cuisine',
    'catalog.quickFilters': 'Quick filters',
    'catalog.allCuisines': 'All cuisines',
    'catalog.bonusOnly': 'AH Bonus deals',
    'catalog.highProtein': 'High protein (>30 g)',
    'catalog.quick': 'Quick (<25 min)',
    'catalog.emptyTitle': 'No recipes found',
    'catalog.emptyBody': 'Try a different keyword or clear your active filters.',
    'catalog.loadMore': 'Load more recipes',
    'catalog.card.ingredientsFor': 'Calculated for {count} people',
    'catalog.card.allerhande': 'View on Allerhande',
    'catalog.card.allerhandeBadge': 'Allerhande',
    'catalog.card.external': 'External link',
    'catalog.card.noIngredients': 'Ingredients on Allerhande',
    'catalog.card.ingredientsCount': '{count} ingredients',
    'catalog.card.details': 'Cooking help & details',
    'catalog.card.priceEstimate': 'Price estimate',
    'catalog.card.partial': 'partial · ',
    'catalog.card.perPerson': '{price} p.p.',
    'catalog.card.match': 'Match {matched}/{total}',
    'catalog.card.saving': '−{amount} saving',
    'catalog.card.bonus': 'AH Bonus',
    'catalog.card.font': 'Protein',
    'catalog.card.health': 'Health',
    'catalog.card.high': 'High',
    'catalog.card.perPortion': '/ serving',
    'catalog.card.noPriceAllerhande': 'Open on Allerhande for ingredients and prices',
    'catalog.card.pricing': 'AH prices are being calculated',
    'catalog.card.noPrice': 'AH price unavailable',
    'catalog.status.checking': 'Fetching live AH prices for {count} recipes on this page…',
    'catalog.status.details': 'Fetching recipe details: {done}/{total}',
    'catalog.status.progress': 'AH prices checked: {done}/{total}',
    'catalog.status.done': 'AH prices checked for {total} recipes',
    'catalog.status.withErrors': ' · {count} with lookup errors',
    'catalog.status.failed': 'Updating AH prices failed: {message}',
    'catalog.status.none': 'No recipes to fetch AH prices for.',

    'recipe.loading': 'Loading recipe details and AH products…',
    'recipe.loadFailed': 'Recipe details could not be loaded: {message}',
    'recipe.close': 'Close',
    'recipe.minutes': '{count} minutes',
    'recipe.notListed': 'Not listed',
    'recipe.persons': 'Number of people',
    'recipe.personsShort': '{count} people',
    'recipe.priceEstimate': 'AH price estimate ({count} people)',
    'recipe.partialPrice': 'Partial price · {matched}/{total} matches, {priced} calculated',
    'recipe.bonusSaving': 'Bonus saving',
    'recipe.noPrice': 'AH prices are not available for this external recipe.',
    'recipe.updatedAt': 'Last updated: {date}',
    'recipe.stalePrices': 'AH was unreachable; some product data comes from the cache.',
    'recipe.calories': 'Calories p.p.',
    'recipe.protein': 'Protein p.p.',
    'recipe.carbs': 'Carbs p.p.',
    'recipe.fat': 'Fat p.p.',
    'recipe.ingredients': 'Ingredients',
    'recipe.ingredientsHint': 'Click for AH options',
    'recipe.instructions': 'Method',
    'recipe.instructionsHint': 'Step by step',
    'recipe.originalOn': 'View the original recipe on {source}',
    'recipe.options.eyebrow': 'Ingredient from this recipe',
    'recipe.options.back': 'Back to recipe',
    'recipe.options.availableOne': '{count} AH option available',
    'recipe.options.availableMany': '{count} AH options available',
    'recipe.options.none': 'Browse available AH products',
    'recipe.options.withBonus': '{count} with bonus',
    'recipe.options.used': '{amount} used',
    'recipe.options.choose': 'Pick a product and open it at AH',
    'recipe.options.bonusShown': 'bonus shown',
    'recipe.options.chosen': 'Selected',
    'recipe.options.cheapest': 'Cheapest',
    'recipe.options.notIngredient': 'Different product',
    'recipe.options.noMatch': 'No suitable product found; pick one below.',
    'recipe.options.ariaOpen': 'View AH products for {name}',
    'recipe.options.optionsOne': '{count} AH option',
    'recipe.options.optionsMany': '{count} AH options',
    'recipe.options.viewProduct': 'View AH product',
    'recipe.options.onlineOnly': 'online only',
    'recipe.options.cache': 'cache',
    'recipe.options.bonus': 'Bonus',
    'recipe.ahSearchFailed': 'AH search failed: {message}',
    'recipe.ahUnavailable': 'AH search results unavailable',
    'recipe.searchAtAH': 'Search at AH',
    'recipe.shopAtAH': 'Shop at AH',
    'recipe.ahArticle': 'AH item',
    'recipe.viewAt': 'View {title} at Albert Heijn',
    'recipe.bonusTitle': '{label} · −{amount}',
    'recipe.translating': 'Translating recipe…',
    'recipe.translateNeedsKey': 'Recipe text stays Dutch until you add a Gemini API key.',

    'ai.title': 'Ask the Gemini cooking assistant',
    'ai.subtitle': 'Ask about substitutions, cooking method or tips',
    'ai.keyButton': 'API key',
    'ai.quick.protein': 'Make it higher in protein',
    'ai.quick.replace': 'Substitute ingredients',
    'ai.quick.wine': 'Wine & drink pairing',
    'ai.quick.veg': 'Vegetarian version',
    'ai.placeholder': 'Ask Gemini a question about this dish…',
    'ai.placeholderDisabled': 'Add your Gemini API key first to ask questions…',
    'ai.ask': 'Ask',
    'ai.thinking': 'Chef Gemini is thinking about: “{question}”…',
    'ai.answer': 'Chef Gemini answers:',
    'ai.label': 'Ask Gemini a question',

    'settings.title': 'Settings',
    'settings.subtitle': 'AI cooking help and product preferences',
    'settings.intro': 'To ask Chef Gemini questions about recipes you need a free Google Gemini API key. It is stored only in your own browser (<code class="rounded bg-slate-100 px-1 py-0.5 text-[11px] dark:bg-neutral-800">localStorage</code>) and never shared.',
    'settings.ignoreOnline': 'Ignore products that are only available online',
    'settings.ignoreOnlineHelp': 'Applies to recipe matches and product comparisons everywhere.',
    'settings.apiKey': 'Google Gemini API key',
    'settings.noKeyTitle': 'No key yet?',
    'settings.noKeyBody': 'Create one for free in a minute at',
    'settings.save': 'Save & activate',

    'footer.tagline': 'Your personal cooking assistant.',
    'footer.note': 'AH product data is fetched anonymously and cached locally. Recipes: Allerhande and TheMealDB. AI: Google Gemini.',

    'products.eyebrow': 'Product comparison',
    'products.title': 'My regular products',
    'products.subtitle': 'Compare AH options on current price, bonus, Nutri-Score and protein.',
    'products.add': 'Add product',
    'products.emptyTitle': 'Your list is still empty',
    'products.emptyBody': 'Add a product you buy often to compare AH options.',
    'products.select': 'Select a product from your list.',
    'products.new': 'New product',
    'products.overview': 'Overview',
    'products.refresh': 'Refresh',
    'products.edit': 'Edit',
    'products.cancel': 'Cancel',
    'products.save': 'Save',
    'products.queryLabel': 'Product or product type',
    'products.queryPlaceholder': 'For example: low-fat quark, chicken breast, olive oil',
    'products.categoryLabel': 'Search category',
    'products.allCategories': 'All categories',
    'products.categoryBreadToppings': 'Sandwich toppings',
    'products.refreshCategories': 'Refresh',
    'products.previewHint': 'Enter at least 2 characters to search AH products.',
    'products.previewHintInline': 'Enter at least 2 characters to preview the matching AH products.',
    'products.criteriaLegend': 'What matters for this product? (equal weighting)',
    'products.criteriaPrice': 'Price per kilo',
    'products.criteriaHealth': 'Nutri-Score',
    'products.criteriaProtein': 'Protein per kcal',
    'products.criteriaHelp': 'Change these in edit mode. Saving keeps all changes; missing data is ignored.',
    'products.sortBy': 'Sort by',
    'products.sortBalanced': 'Best score',
    'products.sortPrice': 'Lowest price per kg',
    'products.sortHealth': 'Best Nutri-Score',
    'products.removeAria': 'Remove {name} from my list',
    'products.optionsOne': '{count} option',
    'products.optionsMany': '{count} options',
    'products.loadFailed': 'Products could not be fetched.',
    'products.noneFound': 'No comparable products with a price found.',
    'products.loading': 'Loading AH products…',
    'products.productsLoaded': '{count} AH options loaded{category}.',
    'products.productsInCategory': ' in {category}',
    'products.previewFailed': 'Fetching preview failed: {message}',
    'products.fetchFailed': 'Fetching AH products failed: {message}',
    'products.noneInCategory': 'No AH products found{category} for “{query}”.',
    'products.footer': 'AH offers can change and may depend on store, account or promotion terms.',
    'products.columnProduct': 'AH product · pack',
    'products.columnNutri': 'Nutri-Score',
    'products.columnPrice': 'Price/kg',
    'products.columnScore': 'Score',
    'products.updating': 'Updating AH products…',
    'products.updatingResults': 'Updating AH results…',
    'products.noPricePerKg': '€/kg n/a',
    'products.perKg': '{price} / kg',
    'products.noNutri': 'No score',
    'products.proteinLoading': 'Loading protein data…',
    'products.proteinUnavailable': 'Protein data unavailable',
    'products.proteinInfo': 'Protein {grams} g / 100 g · {score}',
    'products.proteinScore': 'score {score}',
    'products.proteinNoScore': 'score n/a',
    'products.proteinNoData': 'Protein score unavailable',
    'products.onlineOnly': 'Online only',
    'products.packUnknown': 'Pack size not listed',
    'products.scoreTitle': 'Product score based on the selected criteria',
    'products.nutriTitle': 'Nutri-Score {score}',
    'products.noNutriTitle': 'No Nutri-Score available',
    'products.proteinHelp': 'Protein score is the share of calories coming from protein, calculated from AH nutrition values per 100 g.',
    'products.updatedAt': 'updated {date}',
    'products.stale': 'AH unreachable; stored results',
    'products.resultCount': '{shown} {category}options · {total} AH results',
    'products.categoryPrefix': '{category} ',
    'products.loadMore': 'Load more AH results',
    'products.loadingMore': 'Loading more results…',
    'products.loadMoreFailed': 'Loading more results failed: {message}',
    'products.liveLoading': 'Loading live AH products…',
    'products.groupFailed': 'Fetching products failed: {message}',
    'products.emptyGroup': 'No products with a known price found. Try another search term.',
    'products.emptyGroupFiltered': 'Adjust the online-only setting in edit mode to show these products.',
    'products.saved': 'Product settings saved.',
    'products.duplicate': '“{query}” is already in your list in this category.',
    'products.needQuery': 'Enter a product or product type before saving.',
    'products.waitResults': 'Wait until the AH results for this search have been updated.',
    'products.gone': 'This product is no longer in your list. Reopen the overview.',
    'products.chooseCriterion': 'Choose at least one criterion for the product score.',
    'products.needCategoryQuery': 'Enter at least 2 characters to fetch AH categories.',
    'products.saveFailed': 'Saving your list failed. Check your browser storage.',
    'products.staleNotice': 'AH was unreachable; results are updated from stored data.',
    'products.matchSaved': 'Product choice saved.',
    'products.matchSaveFailed': 'Saving product choice failed: {message}',
    'products.settingsFailed': 'Saving or applying product settings failed: {message}',
    'products.onlineSettingFailed': 'AH matches for the online-only setting could not be updated.'
  }
};

/**
 * Reads the stored language, falling back to Dutch.
 * @returns {'nl'|'en'}
 */
function readStoredLanguage() {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return SUPPORTED.includes(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

let currentLanguage = readStoredLanguage();

/**
 * Current interface language.
 * @returns {'nl'|'en'}
 */
export function getLang() {
  return currentLanguage;
}

/**
 * BCP-47 locale for dates and numbers.
 * @returns {string}
 */
export function getLocale() {
  return currentLanguage === 'en' ? 'en-GB' : 'nl-NL';
}

/**
 * Whether English content translation is active.
 * @returns {boolean}
 */
export function isEnglish() {
  return currentLanguage === 'en';
}

// Recipe cuisines arrive from mixed sources: the built-in recipes use Dutch
// names, TheMealDB reports countries ("Netherlands") or English adjectives
// ("Dutch"). Everything is normalised to one canonical English name so a
// single filter value matches all of them, and the Dutch label is rendered
// from a separate map (so "Dutch" shows as "Nederlands", not "Netherlands").
const CUISINE_CANONICAL = {
  // Dutch names from the built-in collection
  Italiaans: 'Italian',
  Aziatisch: 'Asian',
  Mexicaans: 'Mexican',
  Mediterraans: 'Mediterranean',
  Indiaas: 'Indian',
  Hollands: 'Dutch',
  Nederlands: 'Dutch',
  Belgisch: 'Belgian',
  Frans: 'French',
  Duits: 'German',
  Spaans: 'Spanish',
  Portugees: 'Portuguese',
  Grieks: 'Greek',
  Turks: 'Turkish',
  Marokkaans: 'Moroccan',
  Japans: 'Japanese',
  Chinees: 'Chinese',
  Koreaans: 'Korean',
  Vietnamees: 'Vietnamese',
  Thais: 'Thai',
  Indonesisch: 'Indonesian',
  Amerikaans: 'American',
  Engels: 'British',
  Iers: 'Irish',
  Scandinavisch: 'Scandinavian',
  Afrikaans: 'African',
  'Midden-Oosters': 'Middle Eastern',
  // Country names as reported by TheMealDB
  Italy: 'Italian',
  Italy_and_USA: 'Italian',
  Netherlands: 'Dutch',
  Holland: 'Dutch',
  Belgium: 'Belgian',
  France: 'French',
  Germany: 'German',
  Spain: 'Spanish',
  Portugal: 'Portuguese',
  Greece: 'Greek',
  Turkey: 'Turkish',
  Morocco: 'Moroccan',
  Japan: 'Japanese',
  China: 'Chinese',
  Korea: 'Korean',
  Vietnam: 'Vietnamese',
  Thailand: 'Thai',
  Indonesia: 'Indonesian',
  'United States': 'American',
  USA: 'American',
  America: 'American',
  'United Kingdom': 'British',
  UK: 'British',
  England: 'British',
  Scotland: 'British',
  Wales: 'British',
  Ireland: 'Irish',
  Mexico: 'Mexican',
  India: 'Indian',
  'Sri Lanka': 'Sri Lankan',
  Malaysia: 'Malaysian',
  Philippines: 'Filipino',
  Jamaica: 'Jamaican',
  Argentina: 'Argentine',
  Australia: 'Australian',
  Canada: 'Canadian',
  Poland: 'Polish',
  Russia: 'Russian',
  Ukraine: 'Ukrainian',
  Croatia: 'Croatian',
  Serbia: 'Serbian',
  Slovakia: 'Slovak',
  Norway: 'Norwegian',
  Sweden: 'Swedish',
  Denmark: 'Danish',
  Finland: 'Finnish',
  Hungary: 'Hungarian',
  Romania: 'Romanian',
  Bulgaria: 'Bulgarian',
  Tunisia: 'Tunisian',
  Egypt: 'Egyptian',
  Kenya: 'Kenyan',
  Syria: 'Syrian',
  Uruguay: 'Uruguayan',
  Venezuela: 'Venezuelan',
  Brazil: 'Brazilian',
  Peru: 'Peruvian',
  Colombia: 'Colombian'
};

// Canonieke naam -> Nederlandse weergave.
const CUISINE_DUTCH = {
  Italian: 'Italiaans',
  Asian: 'Aziatisch',
  Mexican: 'Mexicaans',
  Mediterranean: 'Mediterraans',
  Indian: 'Indiaas',
  Dutch: 'Nederlands',
  Belgian: 'Belgisch',
  French: 'Frans',
  German: 'Duits',
  Spanish: 'Spaans',
  Portuguese: 'Portugees',
  Greek: 'Grieks',
  Turkish: 'Turks',
  Moroccan: 'Marokkaans',
  Japanese: 'Japans',
  Chinese: 'Chinees',
  Korean: 'Koreaans',
  Vietnamese: 'Vietnamees',
  Thai: 'Thais',
  Indonesian: 'Indonesisch',
  American: 'Amerikaans',
  British: 'Brits',
  Irish: 'Iers',
  Scandinavian: 'Scandinavisch',
  African: 'Afrikaans',
  'Middle Eastern': 'Midden-Oosters',
  Argentine: 'Argentijns',
  Australian: 'Australisch',
  Canadian: 'Canadees',
  Polish: 'Pools',
  Russian: 'Russisch',
  Swedish: 'Zweeds',
  Danish: 'Deens',
  Norwegian: 'Noors',
  Brazilian: 'Braziliaans',
  Jamaican: 'Jamaicaans',
  Filipino: 'Filipijns',
  Malaysian: 'Maleisisch',
  Egyptian: 'Egyptisch',
  Tunisian: 'Tunesisch',
  Peruvian: 'Peruaans',
  Colombian: 'Colombiaans'
};

const normalizeCuisineKey = name => String(name).trim().toLowerCase().replace(/[_-]+/g, ' ');

const CUISINE_BY_KEY = new Map(
  Object.entries(CUISINE_CANONICAL).map(([source, canonical]) => [normalizeCuisineKey(source), canonical])
);

/**
 * Normalises a cuisine name to its canonical (English) form so recipes from
 * mixed sources can be filtered and grouped together.
 * @param {string} name
 * @returns {string}
 */
export function canonicalCuisine(name) {
  if (!name) return '';
  const value = String(name).trim();
  return CUISINE_BY_KEY.get(normalizeCuisineKey(value)) || value;
}

/**
 * Localizes a cuisine name for display.
 * @param {string} name
 * @returns {string}
 */
export function cuisineLabel(name) {
  if (!name) return '';
  const canonical = canonicalCuisine(name);
  if (currentLanguage === 'en') return canonical;
  return CUISINE_DUTCH[canonical] || canonical;
}

/**
 * Translates a dictionary key, interpolating {placeholders}.
 * @param {string} key
 * @param {Record<string, unknown>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  const table = DICTIONARY[currentLanguage] || DICTIONARY[DEFAULT_LANGUAGE];
  let value = table[key] ?? DICTIONARY[DEFAULT_LANGUAGE][key] ?? key;
  if (vars) {
    value = value.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
    );
  }
  return value;
}

/**
 * Subscribes to language changes.
 * @param {(lang: 'nl'|'en') => void} listener
 * @returns {() => void} unsubscribe
 */
export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Stores and broadcasts a new language.
 * @param {'nl'|'en'} lang
 */
export function setLang(lang) {
  if (!SUPPORTED.includes(lang) || lang === currentLanguage) return;
  currentLanguage = lang;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, lang);
  } catch (error) {
    console.warn('Language preference could not be stored.', error);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
  }
  listeners.forEach(listener => {
    try {
      listener(lang);
    } catch (error) {
      console.error('Language listener failed.', error);
    }
  });
}

/**
 * Toggles between Dutch and English.
 * @returns {'nl'|'en'} the new language
 */
export function toggleLang() {
  setLang(currentLanguage === 'nl' ? 'en' : 'nl');
  return currentLanguage;
}

/**
 * Applies the dictionary to elements carrying data-i18n attributes.
 *
 * Text:  <span data-i18n="catalog.title"></span>
 * HTML:  <p data-i18n-html="settings.intro"></p>
 * Attrs: <input data-i18n-attr="placeholder:catalog.searchPlaceholder">
 *        <button data-i18n-attr="aria-label:nav.theme|title:nav.theme">
 * @param {ParentNode} [root]
 */
export function translateDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-html]').forEach(element => {
    element.innerHTML = t(element.dataset.i18nHtml);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach(element => {
    element.dataset.i18nAttr.split('|').forEach(pair => {
      const [attribute, key] = pair.split(':');
      if (attribute && key) element.setAttribute(attribute, t(key));
    });
  });
  document.documentElement.lang = currentLanguage;
  const titleKey = document.documentElement.dataset.i18nTitle;
  if (titleKey) document.title = t(titleKey);
}

/**
 * Sets up the language toggle button(s) and applies translations.
 * @param {{ onChange?: (lang: 'nl'|'en') => void }} [options]
 */
export function initLanguage(options = {}) {
  const buttons = typeof document === 'undefined'
    ? []
    : [...document.querySelectorAll('[data-language-toggle]')];

  const syncButtons = () => {
    buttons.forEach(button => {
      // The button shows the flag of the language you would switch to.
      const next = currentLanguage === 'nl' ? 'en' : 'nl';
      const nextName = next === 'en' ? 'English' : 'Nederlands';
      button.setAttribute('aria-label', `${t('nav.languageTo')} (${nextName})`);
      button.setAttribute('title', `${t('nav.languageTo')} (${nextName})`);
      button.dataset.nextLang = next;
      button.querySelectorAll('[data-language-flag]').forEach(flag => {
        flag.toggleAttribute('hidden', flag.dataset.languageFlag !== next);
      });
      const label = button.querySelector('[data-language-label]');
      if (label) label.textContent = next.toUpperCase();
    });
  };

  const apply = () => {
    translateDom();
    syncButtons();
  };

  if (options.onChange) listeners.add(options.onChange);
  listeners.add(apply);

  buttons.forEach(button => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => toggleLang());
  });

  apply();

  return { apply, syncButtons };
}
