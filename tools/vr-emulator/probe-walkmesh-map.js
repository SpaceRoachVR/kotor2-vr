/**
 * Renders the current module's walkmesh as an ASCII map, with a route from
 * playthrough-peragus.js, the doors, the player and named placeables laid
 * over it, so via points can be picked from evidence instead of LYT guesses.
 *   node tools/vr-emulator/probe-walkmesh-map.js <checkpoint> [ROUTE_NAME[,ROUTE_NAME]] [cell=2]
 * Output: tools/vr-emulator/evidence/peragus/walkmesh-<module>.txt
 */
const fs = require('fs');
const path = require('path');
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');
const peragus = require('./playthrough-peragus');

const DUMP = `(() => {
  const K = window.KotOR; const gs = K.GameState; const area = gs.module && gs.module.area;
  if (!area) return null;
  const faces = [];
  for (const room of area.rooms || []) {
    const wm = room.collisionManager && room.collisionManager.walkmesh;
    if (!wm) continue;
    const mesh = wm.mesh;
    if (mesh && mesh.matrixWorld) mesh.updateMatrixWorld(true);
    const world = (v) => { const c = v.clone(); if (mesh && mesh.matrixWorld) c.applyMatrix4(mesh.matrixWorld); return c; };
    for (const f of wm.walkableFaces || []) {
      const a = wm.vertices[f.a], b = wm.vertices[f.b], c = wm.vertices[f.c];
      if (!a || !b || !c) continue;
      const tri = [world(a), world(b), world(c)].map((v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]);
      faces.push({ tri, mat: f.materialIndex, room: String(room.name || room.roomName || ''), adj: Array.isArray(f.adjacent) ? f.adjacent.slice() : null, idx: f.walkIndex });
    }
  }
  const p = K.PartyManager.party[0];
  const nameOf = (o) => { try { return String(o.getName ? o.getName() : o.tag); } catch (e) { return String(o.tag); } };
  return {
    module: String(area.name).toLowerCase(),
    player: p ? [+p.position.x.toFixed(1), +p.position.y.toFixed(1), +p.position.z.toFixed(1)] : null,
    faces,
    doors: (area.doors || []).map((d) => ({ tag: String(d.tag), name: nameOf(d), x: +d.position.x.toFixed(1), y: +d.position.y.toFixed(1), z: +d.position.z.toFixed(1), open: d.isOpen ? d.isOpen() : null, locked: d.isLocked ? d.isLocked() : null, link: d.linkedToModule || null })),
    placeables: (area.placeables || []).filter((o) => o.useable || o.isUseable && o.isUseable()).map((o) => ({ tag: String(o.tag), name: nameOf(o), x: +o.position.x.toFixed(1), y: +o.position.y.toFixed(1), z: +o.position.z.toFixed(1) })),
    // Every placeable with a collision walkmesh, as that walkmesh's real
    // faces in world space: debris like a Damaged Mining Droid stands in a
    // tunnel and stops the walker, but a model bounding box overstates it
    // (the Broken Droid by 102PER's second door sealed a corridor the walker
    // squeezes past in practice).
    solids: (area.placeables || []).filter((o) => o && o.collisionManager && o.collisionManager.walkmesh && o.model && o.model.visible !== false).map((o) => {
      const wm = o.collisionManager.walkmesh; const mesh = wm.mesh;
      if (mesh && mesh.matrixWorld) mesh.updateMatrixWorld(true);
      const world = (v) => { const c = v.clone(); if (mesh && mesh.matrixWorld) c.applyMatrix4(mesh.matrixWorld); return c; };
      const tris = [];
      for (const f of wm.faces || []) {
        const a = wm.vertices[f.a], b = wm.vertices[f.b], c = wm.vertices[f.c];
        if (!a || !b || !c) continue;
        tris.push([world(a), world(b), world(c)].map((v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]));
      }
      if (!tris.length) return null;
      return { tag: String(o.tag), name: nameOf(o), tris, z: +o.position.z.toFixed(1) };
    }).filter(Boolean),
    triggers: (area.triggers || []).filter((t) => t.linkedToModule && t.box).map((t) => { const c = t.box.getCenter(t.position.clone()); return { tag: String(t.tag), link: t.linkedToModule, x: +c.x.toFixed(1), y: +c.y.toFixed(1) }; }),
    // Every other trigger with an OnEnter script, as its world polygon:
    // 102PER's HotSteam vents (tr_steamdam) killed the walker on the west wall.
    scripted: (area.triggers || []).filter((t) => t && !t.linkedToModule && t.box && Array.isArray(t.vertices) && t.vertices.length >= 3).map((t) => {
      const script = t.scripts && (t.scripts.onEnter || t.scripts.OnEnter);
      const name = script ? String(script.name || script.resref || script) : '';
      const poly = t.vertices.map((v) => [+(v.x + t.position.x).toFixed(1), +(v.y + t.position.y).toFixed(1)]);
      return { tag: String(t.tag), type: t.type, onEnter: name, poly };
    }),
    creatures: (area.creatures || []).filter((c) => !c.isDead || !c.isDead()).map((c) => ({ name: nameOf(c), x: +c.position.x.toFixed(1), y: +c.position.y.toFixed(1), hostile: p ? c.isHostile(p) : null })),
  };
})()`;

function render(dump, routes, cell) {
  const inside = (px, py, [a, b, c]) => {
    const s1 = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
    const s2 = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0]);
    const s3 = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0]);
    return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  };
  const xs = dump.faces.flatMap((f) => f.tri.map((v) => v[0])); const ys = dump.faces.flatMap((f) => f.tri.map((v) => v[1]));
  const minX = Math.floor(Math.min(...xs) / cell) * cell, maxX = Math.ceil(Math.max(...xs) / cell) * cell;
  const minY = Math.floor(Math.min(...ys) / cell) * cell, maxY = Math.ceil(Math.max(...ys) / cell) * cell;
  const W = Math.round((maxX - minX) / cell) + 1, H = Math.round((maxY - minY) / cell) + 1;
  const grid = Array.from({ length: H }, () => Array(W).fill(' '));
  const zAt = {};
  const put = (x, y, ch, force) => {
    const cx = Math.round((x - minX) / cell), cy = Math.round((y - minY) / cell);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return;
    if (force || grid[cy][cx] === ' ' || grid[cy][cx] === '.') grid[cy][cx] = ch;
  };
  // Rasterise each triangle: every cell whose centre lies inside it is walkable.
  for (const f of dump.faces) {
    const fx = f.tri.map((v) => v[0]), fy = f.tri.map((v) => v[1]);
    const cx0 = Math.floor((Math.min(...fx) - minX) / cell), cx1 = Math.ceil((Math.max(...fx) - minX) / cell);
    const cy0 = Math.floor((Math.min(...fy) - minY) / cell), cy1 = Math.ceil((Math.max(...fy) - minY) / cell);
    for (let cy = cy0; cy <= cy1; cy += 1) for (let cx = cx0; cx <= cx1; cx += 1) {
      const px = minX + cx * cell, py = minY + cy * cell;
      if (!inside(px, py, f.tri)) continue;
      put(px, py, '.');
      zAt[`${cx},${cy}`] = f.tri[0][2];
    }
    // Small faces can miss every cell centre; keep their centroid at least.
    put((fx[0] + fx[1] + fx[2]) / 3, (fy[0] + fy[1] + fy[2]) / 3, '.');
    zAt[`${Math.round(((fx[0] + fx[1] + fx[2]) / 3 - minX) / cell)},${Math.round(((fy[0] + fy[1] + fy[2]) / 3 - minY) / cell)}`] = f.tri[0][2];
  }
  const legend = [];
  // Hazard triggers ('~'): steam, fire, traps - anything whose enter script
  // hurts. Drawn under solids and markers.
  const hazard = /steam|fire|flame|dam|trap|hot|burn|gas|shock/i;
  const harmless = /com|atton|spch|dlg|talk|spawn|ambush/i;
  for (const t of dump.scripted || []) {
    const isHazard = (hazard.test(t.tag) || hazard.test(t.onEnter)) && !harmless.test(t.tag) && !harmless.test(t.onEnter);
    legend.push(`${isHazard ? '~' : ' '} trigger ${t.tag} onEnter=${t.onEnter || '-'} poly=${JSON.stringify(t.poly)}`);
    if (!isHazard) continue;
    const xs = t.poly.map((v) => v[0]), ys = t.poly.map((v) => v[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y += cell) for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x += cell) {
      let inside = false;
      for (let i = 0, j = t.poly.length - 1; i < t.poly.length; j = i++) {
        const [xi, yi] = t.poly[i], [xj, yj] = t.poly[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (!inside) continue;
      const cx = Math.round((x - minX) / cell), cy = Math.round((y - minY) / cell);
      if (cy >= 0 && cy < H && cx >= 0 && cx < W && grid[cy][cx] === '.') grid[cy][cx] = '~';
    }
  }
  // Solid placeable collision faces, so their cells read as blocked ('#')
  // and later markers still draw on top.
  for (const o of dump.solids || []) {
    if (dump.player && Math.abs(o.z - dump.player[2]) > 6) continue;
    let cells = 0;
    for (const tri of o.tris) {
      const fx = tri.map((v) => v[0]), fy = tri.map((v) => v[1]);
      const cx0 = Math.floor((Math.min(...fx) - minX) / cell), cx1 = Math.ceil((Math.max(...fx) - minX) / cell);
      const cy0 = Math.floor((Math.min(...fy) - minY) / cell), cy1 = Math.ceil((Math.max(...fy) - minY) / cell);
      for (let cy = cy0; cy <= cy1; cy += 1) for (let cx = cx0; cx <= cx1; cx += 1) {
        if (cy < 0 || cy >= H || cx < 0 || cx >= W) continue;
        if (!inside(minX + cx * cell, minY + cy * cell, tri)) continue;
        grid[cy][cx] = '#'; cells += 1;
      }
    }
    legend.push(`# solid ${o.tag} "${o.name}" ${cells} cell(s) at z ${o.z}`);
  }
  for (const d of dump.doors) { put(d.x, d.y, d.link ? 'T' : (d.open ? 'o' : 'D'), true); legend.push(`D/o/T door ${d.tag} "${d.name}" @(${d.x},${d.y},${d.z}) open=${d.open} locked=${d.locked}${d.link ? ' -> ' + d.link : ''}`); }
  for (const t of dump.triggers) { put(t.x, t.y, 'X', true); legend.push(`X trigger ${t.tag} -> ${t.link} @(${t.x},${t.y})`); }
  let n = 0;
  for (const o of dump.placeables) { const ch = String.fromCharCode(97 + (n % 26)); n += 1; put(o.x, o.y, ch, true); legend.push(`${ch} ${o.tag} "${o.name}" @(${o.x},${o.y},${o.z})`); }
  for (const c of dump.creatures) { put(c.x, c.y, c.hostile ? '!' : '&', true); }
  for (const [name, route] of Object.entries(routes)) {
    route.forEach((pt, i) => { put(pt.x, pt.y, String((i + 1) % 10), true); legend.push(`${(i + 1) % 10} ${name}[${i}] @(${pt.x},${pt.y},${pt.z}) ${zAt[`${Math.round((pt.x - minX) / cell)},${Math.round((pt.y - minY) / cell)}`] === undefined ? 'OFF-MESH' : 'on mesh'}`); });
  }
  if (dump.player) put(dump.player[0], dump.player[1], '@', true);
  const lines = [`module ${dump.module}  cell ${cell}m  x ${minX}..${maxX}  y ${minY}..${maxY}  (north = up; '.' walkable, '!' hostile, '&' creature, '@' player)`];
  for (let cy = H - 1; cy >= 0; cy -= 1) lines.push(String(minY + cy * cell).padStart(6) + ' ' + grid[cy].join(''));
  lines.push('       ' + Array.from({ length: W }, (_, i) => (i % 5 === 0 ? String(minX + i * cell).padEnd(5).slice(0, 5) : '')).join('').slice(0, W));
  lines.push('', ...legend);
  return lines.join('\n');
}

(async () => {
  const checkpoint = process.argv[2] || 'mining-tunnels';
  const routeNames = (process.argv[3] || '').split(',').filter(Boolean);
  const cell = Number(process.argv[4] || 2);
  // Only faces within this many metres of the player's height: 103PER has
  // two decks stacked in plan view (z 22.4 and z 12.2).
  const zBand = Number(process.argv[5] || 4);
  const routes = {};
  for (const name of routeNames) { if (peragus.ROUTES[name]) routes[name] = peragus.ROUTES[name]; else console.warn('unknown route', name); }
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, checkpoint);
    await steps.sleep(4000);
    const dump = await harness.evaluate(DUMP, { timeoutMs: 120000 });
    if (!dump) throw new Error('no area loaded');
    if (dump.player && Number.isFinite(zBand)) {
      const pz = dump.player[2];
      const before = dump.faces.length;
      dump.faces = dump.faces.filter((f) => f.tri.some((v) => Math.abs(v[2] - pz) <= zBand));
      dump.doors = dump.doors.filter((d) => Math.abs(d.z - pz) <= zBand + 1);
      dump.placeables = dump.placeables.filter((o) => Math.abs(o.z - pz) <= zBand + 1);
      dump.solids = (dump.solids || []).filter((o) => Math.abs(o.z - pz) <= zBand + 1);
      console.log(`deck filter: kept ${dump.faces.length}/${before} faces within ${zBand} m of z ${pz}`);
    }
    const text = render(dump, routes, cell);
    const out = path.join(__dirname, 'evidence', 'peragus', `walkmesh-${dump.module}.txt`);
    fs.writeFileSync(out, text);
    fs.writeFileSync(out.replace(/\.txt$/, '.json'), JSON.stringify({ ...dump, faces: undefined, faceCount: dump.faces.length }, null, 1));
    // The faces themselves, for walkmesh-plan.js (height-aware face graph).
    fs.writeFileSync(out.replace(/\.txt$/, '.faces.json'), JSON.stringify({ module: dump.module, player: dump.player, faces: dump.faces, solids: dump.solids || [], scripted: dump.scripted || [], doors: dump.doors, triggers: dump.triggers }));
    console.log(text);
    console.log(`\nwritten ${out} (${dump.faces.length} faces)`);
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
