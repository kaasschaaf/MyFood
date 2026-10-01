/**
 * Gemini Service - Beheert interactie met Google Generative Language API
 */
export class GeminiService {
  constructor() {
    this.storageKey = 'myfood_gemini_api_key';
    this.modelName = 'gemini-2.5-flash';
  }

  getApiKey() {
    return localStorage.getItem(this.storageKey) || '';
  }

  setApiKey(key) {
    if (!key) {
      localStorage.removeItem(this.storageKey);
    } else {
      localStorage.setItem(this.storageKey, key.trim());
    }
  }

  hasApiKey() {
    return Boolean(this.getApiKey());
  }

  /**
   * Vraag Gemini een vraag over een specifiek recept
   * @param {Object} recipe 
   * @param {string} userQuestion 
   * @param {number} servings 
   * @returns {Promise<string>}
   */
  async askAboutRecipe(recipe, userQuestion, servings = 2) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('Geen Gemini API key gevonden. Voer eerst je API sleutel in bij de instellingen.');
    }

    const scale = servings / (recipe.baseServings || 2);
    const scaledIngredients = (recipe.ingredients || []).map(i => {
      const amount = Math.round((i.amount * scale) * 10) / 10;
      return `- ${amount} ${i.unit} ${i.name}`;
    }).join('\n');

    const systemPrompt = `Je bent een vriendelijke, deskundige Nederlandse chef-kok en voedingsdeskundige in de MyFood webapp.
De gebruiker bekijkt momenteel dit recept:
- Naam: "${recipe.title}"
- Stijl / Keuken: ${recipe.cuisine}
- Aantal personen: ${servings} personen
- Bereidingstijd: ${recipe.prepTimeMinutes} minuten
- Voedingswaarden per persoon: ${recipe.nutrition?.calories || '-'} kcal, ${recipe.nutrition?.proteinGrams || '-'}g eiwit, ${recipe.nutrition?.carbsGrams || '-'}g koolhydraten, ${recipe.nutrition?.fatGrams || '-'}g vet
- Gezondheidsscore: ${recipe.nutrition?.healthScore || '-'}/100

Ingrediënten voor ${servings} personen:
${scaledIngredients}

Bereidingsstappen:
${(recipe.instructions || []).map((step, idx) => `${idx + 1}. ${step}`).join('\n')}

Geef een to-the-point, enthousiast en praktisch antwoord in goed Nederlands. Gebruik markdown waar nuttig (lijstjes, vetgedrukt).`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: `${systemPrompt}\n\nVraag van de gebruiker:\n${userQuestion}` }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1000
      }
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        let errorMsg = `API Fout (${response.status})`;
        if (errorData && errorData.error && errorData.error.message) {
          errorMsg = errorData.error.message;
        }
        if (response.status === 400 || response.status === 403) {
          errorMsg += ' (Controleer of je API sleutel geldig is)';
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!answer) {
        throw new Error('Geen antwoord ontvangen van Gemini.');
      }

      return answer;
    } catch (err) {
      console.error('Gemini API call mislukt:', err);
      throw err;
    }
  }
}
