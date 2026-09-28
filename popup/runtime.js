'use strict';
DalsiDilPopup.start(document, {
  send: (message) => chrome.runtime.sendMessage(message),
  watch: (listener) => chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') listener();
  })
});
