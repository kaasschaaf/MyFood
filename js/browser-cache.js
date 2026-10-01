const DATABASE_NAME = 'myfood-cache';
const DATABASE_VERSION = 1;
const STORE_NAME = 'entries';

export class BrowserCache {
  constructor() {
    this.databasePromise = null;
  }

  open() {
    if (!('indexedDB' in globalThis)) {
      return Promise.reject(new Error('IndexedDB is niet beschikbaar in deze browser.'));
    }
    if (this.databasePromise) return this.databasePromise;

    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('De MyFood-cache kon niet worden geopend.'));
      request.onblocked = () => reject(new Error('De MyFood-cache is geblokkeerd door een ander tabblad.'));
    });

    return this.databasePromise;
  }

  async get(key) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error(`Cache lezen mislukt: ${key}`));
      transaction.onerror = () => reject(transaction.error || new Error(`Cache-transactie mislukt: ${key}`));
    });
  }

  async set(key, value) {
    const database = await this.open();
    const entry = { key, value, updatedAt: Date.now() };
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(entry);
      transaction.oncomplete = () => resolve(entry);
      transaction.onerror = () => reject(transaction.error || new Error(`Cache opslaan mislukt: ${key}`));
      transaction.onabort = () => reject(transaction.error || new Error(`Cache opslaan afgebroken: ${key}`));
    });
  }

  async delete(key) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error(`Cache verwijderen mislukt: ${key}`));
    });
  }
}
