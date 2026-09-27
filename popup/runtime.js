'use strict';
DalsiDilPopup.start(document, { send: (message) => chrome.runtime.sendMessage(message) });
