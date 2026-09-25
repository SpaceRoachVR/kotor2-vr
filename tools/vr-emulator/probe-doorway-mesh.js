/**
 * Dumps the walkmesh geometry around a point (default: 102PER's fourth
 * PeragusDoor1 at -7.8,-16.7): every walkable face with a vertex within R
 * metres, per room, plus each room's perimeter edges nearby and whether the
 * engine treats them as seams. Then stands the player on each side and
 * pushes across, reporting where the step is refused.
 *   node tools/vr-emulator/probe-doorway-mesh.js [checkpoint] [x] [y] [R]
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const [checkpoint = 'mining-tunnels', X = '-7.8', Y = '-16.7', R = '5'] = process.argv.slice(2);

const GEOM = `(() => {
  const K = window.KotOR; const gs = K.GameState; const area = gs.module.area;
  const cx = ${Number(X)}, cy = ${Number(Y)}, R = ${Number(R)};
  const out = { rooms: [], doors: [] };
  for (const room of area.rooms || []) {
    const wm = room.collisionManager && room.collisionManager.walkmesh;
    if (!wm) continue;
    const mesh = wm.mesh; if (mesh) mesh.updateMatrixWorld(true);
    const world = (v) => { const c = v.clone(); if (mesh) c.applyMatrix4(mesh.matrixWorld); return c; };
    const faces = [];
    for (const f of wm.walkableFaces || []) {
      const tri = [wm.vertices[f.a], wm.vertices[f.b], wm.vertices[f.c]].map(world);
      if (!tri.some((v) => Math.hypot(v.x - cx, v.y - cy) <= R)) continue;
      faces.push({ idx: f.walkIndex, mat: f.materialIndex, tri: tri.map((v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]), adj: f.adjacent });
    }
    const edges = [];
    for (const [idx, e] of (wm.edges || new Map())) {
      const s = e.line ? e.line.start : null, en = e.line ? e.line.end : null;
      if (!s || !en) continue;
      if (Math.hypot(s.x - cx, s.y - cy) > R && Math.hypot(en.x - cx, en.y - cy) > R) continue;
      edges.push({ idx, start: [+s.x.toFixed(2), +s.y.toFixed(2)], end: [+en.x.toFixed(2), +en.y.toFixed(2)], transition: e.transition, face: e.face ? e.face.walkIndex : null, seam: e.seam !== undefined ? e.seam : null });
    }
    if (faces.length || edges.length) out.rooms.push({ room: String(room.name || room.roomName || ''), faces, edges, vertexCount: wm.vertices.length });
  }
  for (const d of area.doors || []) {
    if (Math.hypot(d.position.x - cx, d.position.y - cy) > R) continue;
    const wm = d.collisionManager && d.collisionManager.walkmesh;
    out.doors.push({ tag: String(d.tag), pos: [+d.position.x.toFixed(2), +d.position.y.toFixed(2)], bearing: +d.rotation.z.toFixed(3), open: d.isOpen(), openState: d.openState,
      wmFaces: wm ? (wm.faces || []).map((f) => [wm.vertices[f.a], wm.vertices[f.b], wm.vertices[f.c]].map((v) => { const c = v.clone(); if (wm.mesh) { wm.mesh.updateMatrixWorld(true); c.applyMatrix4(wm.mesh.matrixWorld); } return [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)]; })) : null,
      wmInScene: !!(wm && wm.mesh && wm.mesh.parent) });
  }
  const p = K.PartyManager.party[0];
  out.player = p ? { pos: [+p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2)], room: p.room ? String(p.room.name || '?') : null, groundFace: p.collisionManager && p.collisionManager.groundFace ? p.collisionManager.groundFace.walkIndex : null } : null;
  return out;
})()`;

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, checkpoint);
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    await harness.evaluate(`(() => { const p = window.KotOR.PartyManager.party[0]; p.position.set(-6.5, -18.5, 3.4); p.positionChanged = true; return true; })()`);
    await steps.sleep(1500);
    const geom = await harness.evaluate(GEOM, { timeoutMs: 60000 });
    console.log(JSON.stringify(geom, null, 1));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
