'use strict';
const { saveText } = require('./save-text');

// The right-click menu is this list. Adding a line here adds a menu item;
// the userscript does not change.
const ACTIONS = [
  {
    id: 'save',
    label: '存起來',
    accepts: ['text'],
    run: ({ config, payload }) => saveText({ dropDir: config.dropDir, text: payload.text, url: payload.url, title: payload.title }),
  },
  // No run(): the userscript opens its own dialog for this one and talks to /retext.
  { id: 'retext', label: '改這段字', accepts: ['text'], ui: 'retext' },
];

const menuItems = () => ACTIONS.map(({ id, label, accepts, ui }) => (ui ? { id, label, accepts, ui } : { id, label, accepts }));

const findAction = (id) => ACTIONS.find((a) => a.id === id) || null;

module.exports = { menuItems, findAction };
