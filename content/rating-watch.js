(function () {
  'use strict';
  let timer;
  let watchingUntil = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        chrome.runtime.sendMessage({ type: 'rating-changed', href: location.href }).catch(() => {});
      } catch (_) { /* The extension may have been reloaded in another tab. */ }
    }, 1500);
  }
  document.addEventListener('click', (event) => {
    const star = event.target.closest && event.target.closest('.stars-rating .star[data-rating]');
    if (!star || !/^#secureHandle-/.test(star.getAttribute('href') || '')) return;
    watchingUntil = Date.now() + 30000;
    schedule();
  }, true);
  // ČSFD replaces rating snippets after the save; a slow response needs a new read.
  new MutationObserver((records) => {
    if (Date.now() > watchingUntil) return;
    if (records.some((record) => record.target.closest && record.target.closest('.my-rating') ||
      [...record.addedNodes].some((node) => node.nodeType === 1 &&
        (node.matches('.my-rating') || node.querySelector('.my-rating'))))) schedule();
  }).observe(document, { childList: true, subtree: true });
})();
