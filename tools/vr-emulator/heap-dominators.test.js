const test = require('node:test');
const assert = require('node:assert');
const { computeDominators } = require('./heap-dominators');

// root(0) -> a(1), root -> b(2); a -> c(3), b -> c; c -> d(4); a -> e(5) weak.
function graph(edges, N) {
  const firstEdge = new Uint32Array(N + 1);
  const sorted = edges.slice().sort((x, y) => x[0] - y[0]);
  for (const [from] of sorted) firstEdge[from + 1]++;
  for (let n = 0; n < N; n++) firstEdge[n + 1] += firstEdge[n];
  return {
    N, firstEdge,
    edgeTo: Uint32Array.from(sorted.map((e) => e[1])),
    edgeType: Uint8Array.from(sorted.map((e) => e[2] || 0)),
    edgeTypes: ['property', 'weak'],
  };
}

test('a node reached by two paths is dominated by their meeting point, weak edges ignored', () => {
  const g = graph([[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [1, 5, 1]], 6);
  const d = computeDominators(g);
  assert.strictEqual(d.idom[3], 0);
  assert.strictEqual(d.idom[4], 3);
  assert.strictEqual(d.idom[1], 0);
  assert.strictEqual(d.postIndex[5], -1);
});

test('a single holder dominates everything under it', () => {
  const g = graph([[0, 1], [1, 2], [2, 3], [2, 4], [3, 4]], 5);
  const d = computeDominators(g);
  assert.strictEqual(d.idom[4], 2);
  assert.strictEqual(d.idom[3], 2);
});
