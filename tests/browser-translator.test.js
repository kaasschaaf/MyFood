import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BrowserTranslator, isBrowserTranslationSupported } from '../js/browser-translator.js';

/**
 * Installs a fake Translator API for the duration of a test.
 * @param {{status?: string, translate?: (text: string) => string}} options
 */
function installTranslator({ status = 'available', translate = text => `EN(${text})` } = {}) {
  const calls = [];
  globalThis.Translator = {
    availability: async () => status,
    create: async ({ sourceLanguage, targetLanguage }) => {
      calls.push(`${sourceLanguage}>${targetLanguage}`);
      return {
        translate: async text => {
          calls.push(text);
          return translate(text);
        },
        destroy() {}
      };
    }
  };
  return calls;
}

function removeTranslator() {
  delete globalThis.Translator;
  delete globalThis.translation;
}

test('without the API the translator reports unsupported and passes text through', async () => {
  removeTranslator();
  assert.equal(isBrowserTranslationSupported(), false);
  const translator = new BrowserTranslator();
  assert.equal(translator.isSupported(), false);
  assert.equal(await translator.canTranslate('nl', 'en'), false);
  assert.equal(await translator.translate('Hallo', { source: 'nl', target: 'en' }), 'Hallo');
});

test('a supported API translates through the on-device model', async () => {
  const calls = installTranslator();
  try {
    const translator = new BrowserTranslator();
    assert.equal(translator.isSupported(), true);
    assert.equal(await translator.canTranslate('nl', 'en'), true);
    assert.equal(await translator.translate('Hallo', { source: 'nl', target: 'en' }), 'EN(Hallo)');
    assert.deepEqual(await translator.translateAll(['een', 'twee'], { source: 'nl', target: 'en' }), ['EN(een)', 'EN(twee)']);
    assert.deepEqual(calls.filter(call => call.includes('>')), ['nl>en']);
  } finally {
    removeTranslator();
  }
});

test('repeated strings come from memory instead of the model', async () => {
  const calls = installTranslator();
  try {
    const translator = new BrowserTranslator();
    await translator.translate('Kipfilet', { source: 'nl', target: 'en' });
    await translator.translate('Kipfilet', { source: 'nl', target: 'en' });
    assert.equal(calls.filter(call => call === 'Kipfilet').length, 1);
  } finally {
    removeTranslator();
  }
});

test('an unavailable language pair leaves the text alone', async () => {
  installTranslator({ status: 'unavailable' });
  try {
    const translator = new BrowserTranslator();
    assert.equal(await translator.canTranslate('nl', 'en'), false);
    assert.equal(await translator.translate('Hallo', { source: 'nl', target: 'en' }), 'Hallo');
  } finally {
    removeTranslator();
  }
});

test('a model that fails to translate falls back to the original text', async () => {
  installTranslator({ translate: text => { if (text === 'boom') throw new Error('model error'); return text; } });
  try {
    const translator = new BrowserTranslator();
    assert.equal(await translator.translate('boom', { source: 'nl', target: 'en' }), 'boom');
    assert.equal(await translator.translate('ok', { source: 'nl', target: 'en' }), 'ok');
  } finally {
    removeTranslator();
  }
});

test('a hanging availability probe cannot block the interface', async () => {
  globalThis.Translator = {
    availability: () => new Promise(() => {}),
    create: async () => ({ translate: async text => text })
  };
  try {
    const translator = new BrowserTranslator();
    const started = Date.now();
    const status = await translator.status('nl', 'en');
    assert.equal(status, 'unavailable');
    assert.ok(Date.now() - started < 5000, 'status should give up quickly');
  } finally {
    removeTranslator();
  }
});

test('the legacy translation namespace is still understood', async () => {
  globalThis.translation = {
    canTranslate: async () => 'readily',
    createTranslator: async () => ({ translate: async text => `LEGACY(${text})` })
  };
  try {
    const translator = new BrowserTranslator();
    assert.equal(translator.isSupported(), true);
    assert.equal(await translator.translate('Hallo', { source: 'nl', target: 'en' }), 'LEGACY(Hallo)');
  } finally {
    removeTranslator();
  }
});
