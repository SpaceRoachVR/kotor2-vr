function validatePoint(point, label) {
  if (!point || !['x', 'y', 'z'].every((axis) => Number.isFinite(point[axis]))) {
    throw new Error(`${label} must contain finite x, y, and z coordinates`);
  }
}

/** Approach the centre of an engine transition line from the player's side. */
function planDoorCrossing(player, transitionLine) {
  validatePoint(player, 'player');
  if (!transitionLine) throw new Error('door transition line is missing');
  const { start, end } = transitionLine;
  validatePoint(start, 'transition start');
  validatePoint(end, 'transition end');
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) throw new Error('door transition line has zero length');
  const centre = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, z: player.z };
  const nx = -dy / length;
  const ny = dx / length;
  const sideDistance = (player.x - centre.x) * nx + (player.y - centre.y) * ny;
  if (Math.abs(sideDistance) < 0.001) throw new Error('player side of door transition line is ambiguous');
  const side = Math.sign(sideDistance);
  const offset = (distance) => ({ x: centre.x + nx * side * distance, y: centre.y + ny * side * distance, z: centre.z });
  return { approach: offset(2), beyond: offset(-3) };
}

module.exports = { planDoorCrossing };
