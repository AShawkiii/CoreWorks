'use strict';
/**
 * Loads one or more apps-script/*.gs files into a SHARED vm context, the
 * same way Apps Script merges every file into one global namespace at
 * runtime. Plain Node `require()` can't be used for the "composite" pure
 * files (e.g. TaskLogic.gs references the ENUMS global from Enums.gs) since
 * each require'd file gets its own isolated module scope — this loader
 * mirrors GAS's actual execution model instead.
 *
 * Returns the vm context object itself: top-level `var`/`function`
 * declarations in the loaded files become its own properties, so
 * `ctx.computeDaysRemaining(...)` works directly.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function loadGasContext(relativePaths) {
  const sandbox = {};
  const context = vm.createContext(sandbox);

  relativePaths.forEach((relativePath) => {
    const fullPath = path.join(REPO_ROOT, relativePath);
    const src = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(src, context, { filename: fullPath });
  });

  return context;
}

module.exports = { loadGasContext, REPO_ROOT };
