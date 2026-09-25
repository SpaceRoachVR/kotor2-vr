/**
 * 103PER fuel pipe (room 103perr, floor z 12.2) overlaps the deck (103pers,
 * z 11.9) in plan. From the fuel-line checkpoint the Exile stands inside the
 * pipe; pushing at the pipe wall toward the deck should stop on the wall.
 * Hooks attachToRoom to record every room change with its call stack, then
 * pushes north-east at the wall and reports whether the Exile ended up on the
 * deck and through which code path.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const SNAP = `(() => {
  const K = window.KotOR; const p = K.PartyManager.party[0];
  return { pos: [+p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2)], room: p.room ? p.area.rooms.indexOf(p.room) : null,
    groundZ: p.collisionManager && p.collisionManager.groundFace ? +((p.collisionManager.groundFace.triangle.a.z + p.collisionManager.groundFace.triangle.b.z + p.collisionManager.groundFace.triangle.c.z) / 3).toFixed(2) : null };
})()`;

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, 'fuel-line');
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    await harness.evaluate(`(() => {
      const K = window.KotOR; const p = K.PartyManager.party[0]; window.__rooms = [];
      const orig = p.attachToRoom.bind(p);
      p.attachToRoom = (room) => { const from = p.room && p.room.name; const to = room && room.name; if (from !== to) { window.__rooms.push({ t: Math.round(performance.now()), from, to, pos: [+p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2)], stack: String(new Error().stack).split(String.fromCharCode(10)).slice(2, 8).map((s) => s.trim().slice(0, 90)) }); } return orig(room); };
      return true;
    })()`);
    console.log('START', JSON.stringify(await harness.evaluate(SNAP)));
    // Put the Exile back on the authored arrival waypoint inside the pipe.
    await harness.evaluate(`(() => { const p = window.KotOR.PartyManager.party[0]; p.position.set(-36.81, -18.24, 12.25); p.positionChanged = true; if (p.collisionManager) { p.collisionManager.groundFace = undefined; p.collisionManager.lastGroundFace = undefined; p.collisionManager.findWalkableFace(); } return true; })()`);
    await steps.sleep(1500);
    console.log('PLACED', JSON.stringify(await harness.evaluate(SNAP)));
    // The pipe room's perimeter edges nearest the arrival, with their normals
    // and the seam verdict the collision pass would give them.
    console.log('EDGES', JSON.stringify(await harness.evaluate(`(() => {
      const p = window.KotOR.PartyManager.party[0]; const room = p.room; if (!room || !room.collisionManager || !room.collisionManager.walkmesh) return { room: null };
      const out = []; const edges = room.collisionManager.walkmesh.edges;
      for (const [index, e] of edges) { if (!e || !e.line) continue; const mx = (e.line.start.x + e.line.end.x) / 2, my = (e.line.start.y + e.line.end.y) / 2;
        const d = Math.hypot(mx - p.position.x, my - p.position.y); if (d > 25) continue;
        let seam = null; try { seam = p.collisionManager.isRoomSeamEdge(e); } catch (err) { seam = String(err.message); }
        out.push({ index, transition: e.transition, start: [+e.line.start.x.toFixed(1), +e.line.start.y.toFixed(1), +e.line.start.z.toFixed(1)], end: [+e.line.end.x.toFixed(1), +e.line.end.y.toFixed(1), +e.line.end.z.toFixed(1)], normal: e.normal ? [+e.normal.x.toFixed(2), +e.normal.y.toFixed(2)] : null, seam, d: +d.toFixed(1) }); }
      return { roomIndex: p.area.rooms.indexOf(room), roomName: room.roomName || room.name || (room.model && room.model.name), faces: room.collisionManager.walkmesh.walkableFaces.length, edges: out };
    })()`)));
    // Straight push north through the pipe's north-east wall (crossed at y ~ -15.4).
    for (const target of [{ x: -36.8, y: -8.0 }, { x: -40.5, y: -4.5 }, { x: -38.6, y: -3.8 }]) {
      const walk = await steps.moveTo(harness, { ...target, z: 12.2, range: 0.8, label: `push to ${target.x},${target.y}`, timeoutMs: 12000, usePath: false }).catch((e) => ({ error: String(e.message).slice(0, 140) }));
      console.log('WALK', JSON.stringify(target), JSON.stringify(walk).slice(0, 160));
      console.log('NOW', JSON.stringify(await harness.evaluate(SNAP)));
    }
    const rooms = await harness.evaluate(`window.__rooms`);
    console.log('ROOM CHANGES', rooms.length);
    for (const r of rooms) console.log(JSON.stringify(r));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
