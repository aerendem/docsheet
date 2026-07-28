// The app is bundled by Vite, which fills in the extension on a relative
// import. Node's own resolver doesn't, so `npm test` would fail to find
// "./barcode" the moment a module under test imports a sibling. Add exactly
// what Vite would have added, and nothing else.

import { registerHooks } from "node:module"

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context)
      } catch {
        /* not a .ts sibling — let node resolve it as written */
      }
    }
    return next(specifier, context)
  },
})
