module.exports = new Proxy({}, {
  get: (target, prop) => {
    if (prop === '__esModule') return true;
    if (prop === 'mergeBufferGeometries') return (geoms) => (geoms && geoms[0]) || null;
    return class Stub {};
  }
});
