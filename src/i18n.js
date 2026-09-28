(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DalsiDilI18n = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_LOCALE = 'cs';
  const supported = ['cs', 'sk', 'en'];
  const catalog = {
    cs: {
      subtitle: 'Další epizody podle hodnocení na ČSFD', refresh: 'Obnovit', settings: 'Nastavení',
      profile: 'Adresa profilu na ČSFD', count: 'Počet seriálů', language: 'Jazyk',
      fullRefresh: 'Načíst vše znovu', privacy: 'Data zůstávají v tomto prohlížeči. Rozšíření kontaktuje pouze ČSFD.',
      lastRated: 'Naposledy', latestRating: 'poslední hodnocená epizoda', openNext: 'Otevřít →', series: 'Seriál', nextEpisode: 'Další epizoda',
      challenge: 'ČSFD zablokovalo obnovení. Otevřete ČSFD v kartě, dokončete kontrolu a zkuste to znovu.',
      network: 'ČSFD není dostupné. Níže zůstávají uložené výsledky.', parserUnavailable: 'Čtení ČSFD není dostupné. Zavřete a znovu otevřete rozšíření.',
      detecting: 'Zjišťuji přihlášený účet na ČSFD…', resolving: 'Hledám následující epizody a jejich názvy…',
      setup: 'Přihlaste se na ČSFD nebo přidejte adresu profilu v Nastavení.', idle: 'Účet nalezen. Spouštím první načtení…',
      error: 'Něco se nepodařilo. Znovu otevřete rozšíření a zkuste to znovu.', empty: 'Žádný rozkoukaný hodnocený seriál zatím nebyl nalezen.',
      scanning: 'Stále procházím hodnocení — stránka {page}. Uložené výsledky zůstávají použitelné.',
      httpError: 'ČSFD vrátilo chybu {code}. Níže zůstávají uložené výsledky.', stopped: 'Obnovení se zastavilo: {status}. Zkuste to znovu.',
      items: '{count} položek', launcherSetup: 'Nastavení a první načtení najdete v ikoně rozšíření.',
      launcherEmpty: 'V uloženém výběru zatím nic není. Obnovit ho můžete v ikoně rozšíření.',
      refreshing: 'Obnovuji hodnocení…', background: 'Aktualizace pokračuje na pozadí.', done: 'Hotovo.', refreshFailed: 'Obnovení se nepodařilo. Zkuste to znovu.'
      , loginUnconfirmed: 'Aktuální přihlášení na ČSFD se nepodařilo ověřit. Zobrazuji dříve vybraný účet.'
      , identifyFailed: 'Přihlášený účet na ČSFD se nepodařilo zjistit. Otevřete ČSFD a zkuste to znovu nebo přidejte adresu profilu v Nastavení.'
      , signedOut: 'Přihlaste se na ČSFD a znovu otevřete rozšíření. Adresu profilu můžete přidat také v Nastavení.'
      , invalidProfile: 'Toto není platná adresa profilu na ČSFD.'
    },
    sk: {
      subtitle: 'Ďalšie epizódy podľa hodnotení na ČSFD', refresh: 'Obnoviť', settings: 'Nastavenia',
      profile: 'Adresa profilu na ČSFD', count: 'Počet seriálov', language: 'Jazyk',
      fullRefresh: 'Načítať všetko znova', privacy: 'Dáta zostávajú v tomto prehliadači. Rozšírenie kontaktuje iba ČSFD.',
      lastRated: 'Naposledy', latestRating: 'posledná hodnotená epizóda', openNext: 'Otvoriť →', series: 'Seriál', nextEpisode: 'Ďalšia epizóda',
      challenge: 'ČSFD zablokovalo obnovenie. Otvorte ČSFD na karte, dokončite kontrolu a skúste to znova.',
      network: 'ČSFD nie je dostupné. Nižšie zostávajú uložené výsledky.', parserUnavailable: 'Čítanie ČSFD nie je dostupné. Zatvorte a znova otvorte rozšírenie.',
      detecting: 'Zisťujem prihlásený účet na ČSFD…', resolving: 'Hľadám nasledujúce epizódy a ich názvy…',
      setup: 'Prihláste sa na ČSFD alebo pridajte adresu profilu v Nastaveniach.', idle: 'Účet nájdený. Spúšťam prvé načítanie…',
      error: 'Niečo sa nepodarilo. Znova otvorte rozšírenie a skúste to znova.', empty: 'Nenašiel sa zatiaľ žiadny rozpozeraný hodnotený seriál.',
      scanning: 'Stále prechádzam hodnotenia — stránka {page}. Uložené výsledky zostávajú použiteľné.',
      httpError: 'ČSFD vrátilo chybu {code}. Nižšie zostávajú uložené výsledky.', stopped: 'Obnovenie sa zastavilo: {status}. Skúste to znova.',
      items: '{count} položiek', launcherSetup: 'Nastavenia a prvé načítanie nájdete v ikone rozšírenia.',
      launcherEmpty: 'V uloženom výbere zatiaľ nič nie je. Obnoviť ho môžete v ikone rozšírenia.',
      refreshing: 'Obnovujem hodnotenia…', background: 'Aktualizácia pokračuje na pozadí.', done: 'Hotovo.', refreshFailed: 'Obnovenie sa nepodarilo. Skúste to znova.'
      , loginUnconfirmed: 'Aktuálne prihlásenie na ČSFD sa nepodarilo overiť. Zobrazujem skôr vybraný účet.'
      , identifyFailed: 'Prihlásený účet na ČSFD sa nepodarilo zistiť. Otvorte ČSFD a skúste to znova alebo pridajte adresu profilu v Nastaveniach.'
      , signedOut: 'Prihláste sa na ČSFD a znova otvorte rozšírenie. Adresu profilu môžete pridať aj v Nastaveniach.'
      , invalidProfile: 'Toto nie je platná adresa profilu na ČSFD.'
    },
    en: {
      subtitle: 'Your next episodes from ČSFD ratings', refresh: 'Refresh', settings: 'Settings',
      profile: 'ČSFD profile URL', count: 'Series to show', language: 'Language',
      fullRefresh: 'Full rescan', privacy: 'Data stays in this browser. Only ČSFD is contacted.',
      lastRated: 'Last rated', latestRating: 'your latest episode rating', openNext: 'Open next →', series: 'Series', nextEpisode: 'Next episode',
      challenge: 'ČSFD blocked the refresh. Open ČSFD in a tab, complete its check, then refresh here.',
      network: 'ČSFD could not be reached. Cached results are shown below.', parserUnavailable: 'ČSFD parser unavailable. Close and reopen the extension, then try again.',
      detecting: 'Checking which ČSFD account is signed in…', resolving: 'Finding the following episodes and their names…',
      setup: 'Sign in to ČSFD, or add your profile URL in Settings.', idle: 'Account found. Starting the first scan…',
      error: 'Something unexpected failed. Reopen the extension and try again.', empty: 'No unfinished rated series found yet.',
      scanning: 'Still scanning your ratings — page {page}. Cached results stay usable.',
      httpError: 'ČSFD returned error {code}. Cached results are shown below.', stopped: 'Refresh stopped: {status}. Try again.',
      items: '{count} items', launcherSetup: 'Settings and the first scan are available from the extension icon.',
      launcherEmpty: 'Nothing is in the saved list yet. Refresh it from the extension icon.',
      refreshing: 'Refreshing ratings…', background: 'The refresh continues in the background.', done: 'Done.', refreshFailed: 'Refresh failed. Try again.'
      , loginUnconfirmed: 'Could not confirm the current ČSFD login. Showing the previously selected account.'
      , identifyFailed: 'Could not identify the signed-in ČSFD account. Open ČSFD, then try again or add the profile URL in Settings.'
      , signedOut: 'Sign in to ČSFD, then reopen this extension. You can also add the profile URL in Settings.'
      , invalidProfile: 'That is not a ČSFD profile URL.'
    }
  };

  function locale(value) { return supported.includes(value) ? value : DEFAULT_LOCALE; }
  function t(value, key, vars) {
    let text = (catalog[locale(value)] && catalog[locale(value)][key]) || catalog[DEFAULT_LOCALE][key] || key;
    for (const [name, replacement] of Object.entries(vars || {})) text = text.replaceAll(`{${name}}`, String(replacement));
    return text;
  }

  return { DEFAULT_LOCALE, supported, locale, t };
});
