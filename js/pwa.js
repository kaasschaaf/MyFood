// Registers the service worker that makes Kost installable and available
// offline. Shared by every page so pages do not each implement their own logic.
const THEME_COLORS = { light: '#047857', dark: '#141414' };

function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const isDark = document.documentElement.classList.contains('dark');
  meta.setAttribute('content', isDark ? THEME_COLORS.dark : THEME_COLORS.light);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (window.isSecureContext === false) return;
  navigator.serviceWorker.register('./sw.js').catch(error => {
    console.warn('Kost kon de offline ondersteuning niet registreren.', error);
  });
}

syncThemeColor();
new MutationObserver(syncThemeColor).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class']
});

if (document.readyState === 'complete') {
  registerServiceWorker();
} else {
  window.addEventListener('load', registerServiceWorker, { once: true });
}
