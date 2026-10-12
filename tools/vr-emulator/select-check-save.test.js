const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectCheckSave } = require('./select-check-save');

test('selects an explicitly named save without changing enumeration order', () => {
  const saves = [{ directory: 'Saves/QUICKSAVE' }, { directory: 'Saves/admin-return' }];
  assert.equal(selectCheckSave(saves, 'Saves/admin-return'), 1);
  assert.equal(selectCheckSave(saves), 0);
  assert.equal(saves[0].directory, 'Saves/QUICKSAVE');
});
test('rejects missing saves and invalid selection rather than silently using another save', () => {
  for (const saves of [undefined, {}, []]) assert.throws(() => selectCheckSave(saves));
  for (const directory of ['', ' ', 1, 'missing']) {
    assert.throws(() => selectCheckSave([{ directory: 'valid' }], directory));
  }
});
