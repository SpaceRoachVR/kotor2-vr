/**
 * Records when a webpack build last completed.
 *
 * `vr:check` reads `dist/` and does not build it, so it warns when the bundle
 * predates its sources. Comparing `dist/KotOR.js` mtime alone is not enough:
 * webpack's `compareBeforeEmit` defaults to true, so a rebuild whose output is
 * byte-identical does not rewrite the asset, and the bundle stays older than
 * source while being perfectly current. That produced a false "stale" warning
 * the first time the guard was exercised.
 *
 * This stamp is written on every completed build regardless of what was
 * emitted, so freshness can be judged by when the build ran rather than by
 * whether its output happened to change.
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, '.build-stamp'), `${Date.now()}\n`, 'utf8');
