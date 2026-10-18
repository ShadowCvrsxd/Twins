// Preload (`node -r ./test/force-no-sqlite.js ...`) that makes require('node:sqlite')
// throw, forcing db.js onto its JSON fallback path. Used by T8 QA and T13.
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'node:sqlite') {
    throw new Error('force-no-sqlite: node:sqlite disabled for fallback test');
  }
  return originalLoad.call(this, request, parent, isMain);
};
