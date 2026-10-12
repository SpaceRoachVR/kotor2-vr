const test = require('node:test');
const assert = require('node:assert/strict');
const { planDoorCrossing } = require('./door-crossing');

test('a sideways fuel-depot approach crosses the transition line through its centre', () => {
  const plan = planDoorCrossing({ x: -61.4, y: 9, z: 9.22 }, {
    start: { x: -61.9156, y: -0.034, z: 9.22 },
    end: { x: -61.9156, y: 9.966, z: 9.22 },
  });
  assert.equal(plan.approach.x, -59.9156);
  assert.equal(plan.beyond.x, -64.9156);
  for (const point of [plan.approach, plan.beyond]) {
    assert.ok(Math.abs(point.y - 4.966) < 1e-9);
    assert.equal(point.z, 9.22);
  }
});

test('crossing selects the player side and is independent of endpoint order', () => {
  const start = { x: -5, y: 10, z: 3 };
  const end = { x: 5, y: 10, z: 3 };
  for (const y of [6, 14]) {
    const player = { x: 4, y, z: 3 };
    const forward = planDoorCrossing(player, { start, end });
    assert.deepEqual(forward, planDoorCrossing(player, { start: end, end: start }));
    assert.equal(forward.approach.y, y < 10 ? 8 : 12);
    assert.equal(forward.beyond.y, y < 10 ? 13 : 7);
  }
});

test('invalid and ambiguous transition geometry fails explicitly', () => {
  const point = { x: 0, y: 0, z: 0 };
  const line = { start: point, end: { x: 10, y: 0, z: 0 } };
  for (const player of [null, {}, { ...point, x: NaN }, { ...point, z: Infinity }]) {
    assert.throws(() => planDoorCrossing(player, line), /finite/);
  }
  assert.throws(() => planDoorCrossing(point, null), /transition/);
  assert.throws(() => planDoorCrossing(point, { start: point, end: point }), /length/);
  assert.throws(() => planDoorCrossing(point, line), /side/);
});
