#!/usr/bin/env node
/**
 * KotOR 2 VR Model Context Protocol (MCP) Server.
 *
 * Connects over Chrome DevTools Protocol (CDP) to the running Electron or
 * emulated browser session, providing AI agents and developer tooling with:
 * - Live engine state introspection (active module, player HP, dialogue, combat)
 * - Spatial interaction target queries (InteractionTargetRegistry)
 * - High-level VR input injection & gesture simulation
 * - 3D spatial debug gizmo control
 * - WebXR trace recording and playback controls
 * - Viewport screenshot capture
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { CdpSession, findPageTarget, waitForEndpoint } = require('../vr-emulator/cdp');
const { WebXRActionDriver } = require('../vr-emulator/dsl/WebXRActionDriver');

const DEFAULT_PORTS = [9222, 9422, 9425];
let activeCdp = null;
let activeDriver = null;
let targetPort = null;

async function getOrConnectCdp() {
  if (activeCdp) {
    try {
      await activeCdp.evaluate('1 + 1');
      return { cdp: activeCdp, driver: activeDriver };
    } catch {
      activeCdp = null;
      activeDriver = null;
    }
  }

  const portsToTry = targetPort ? [targetPort] : DEFAULT_PORTS;
  let lastError = null;

  for (const port of portsToTry) {
    try {
      await waitForEndpoint(port, 400);
      const target = await findPageTarget(port, (u) => u.includes('launch') || u.includes('127.0.0.1') || u.includes('localhost'), 600);
      activeCdp = await CdpSession.connect(target.webSocketDebuggerUrl);
      targetPort = port;
      activeDriver = new WebXRActionDriver({
        evaluate: (expr) => activeCdp.evaluate(expr),
        waitFor: (expr, timeoutMs = 5000) => {
          const deadline = Date.now() + timeoutMs;
          return new Promise(async (resolve, reject) => {
            while (Date.now() < deadline) {
              const res = await activeCdp.evaluate(`!!(${expr})`);
              if (res === true) return resolve(true);
              await new Promise((r) => setTimeout(r, 200));
            }
            reject(new Error(`Timeout waiting for ${expr}`));
          });
        },
      });
      return { cdp: activeCdp, driver: activeDriver };
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`Could not connect to KotOR VR session on CDP ports [${portsToTry.join(', ')}]: ${lastError && lastError.message}`);
}

const TOOLS = [
  {
    name: 'vr_get_engine_state',
    description: 'Query runtime state of the Odyssey engine in KotOR 2 VR (active module, player character, HP, dialogue state, engine mode, combat round).',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'vr_inspect_interaction_targets',
    description: 'Query all active world interaction targets registered in InteractionTargetRegistry (labels, radii, distances, interaction modes, and availability).',
    inputSchema: {
      type: 'object',
      properties: {
        maxDistance: { type: 'number', description: 'Optional max distance in metres to filter targets' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vr_simulate_input',
    description: 'Simulate controller inputs (buttons, thumbsticks, trigger, grip, Force flick, or melee swing) in the VR session.',
    inputSchema: {
      type: 'object',
      properties: {
        hand: { type: 'string', enum: ['left', 'right'], default: 'right' },
        action: { type: 'string', enum: ['press_button', 'set_axes', 'trigger', 'grip', 'force_flick', 'melee_swing'] },
        button: { type: 'string', description: 'Button name e.g. trigger, squeeze, x-button, y-button, a-button, b-button' },
        value: { type: 'number', description: 'Button value from 0.0 to 1.0' },
        durationMs: { type: 'number', description: 'Duration to hold before releasing in ms' },
        axes: { type: 'array', items: { type: 'number' }, description: '[x, y] joystick axes from -1.0 to 1.0' },
        flickDirection: { type: 'string', enum: ['push', 'pull'], default: 'push' },
        swingDirection: { type: 'string', enum: ['horizontal', 'overhead', 'diagonal'], default: 'horizontal' },
      },
      required: ['action'],
    },
  },
  {
    name: 'vr_toggle_debug_gizmos',
    description: 'Toggle or set 3D spatial debug gizmos in the world scene (interaction target spheres, controller rays, gesture velocity ribbons).',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'Set explicit enabled state, or omit to toggle' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'vr_record_trace',
    description: 'Start or stop in-engine WebXR input trace recording (.vrtrace.json) to capture reproducible session input.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', enum: ['start', 'stop', 'status'] },
        title: { type: 'string', description: 'Optional title/tag for the trace' },
      },
      required: ['command'],
    },
  },
  {
    name: 'vr_replay_trace',
    description: 'Load and replay a recorded WebXR input trace (.vrtrace.json) into the running session.',
    inputSchema: {
      type: 'object',
      properties: {
        tracePath: { type: 'string', description: 'Absolute path to .vrtrace.json file' },
        loop: { type: 'boolean', default: false },
        speed: { type: 'number', default: 1.0 },
      },
      required: ['tracePath'],
    },
  },
  {
    name: 'vr_capture_screenshot',
    description: 'Capture a screenshot of the running VR / WebGL viewport and save to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Optional output filename in tools/vr-emulator/evidence/' },
      },
      additionalProperties: false,
    },
  },
];

async function handleToolCall(name, args) {
  const { cdp, driver } = await getOrConnectCdp();

  switch (name) {
    case 'vr_get_engine_state': {
      const state = await cdp.evaluate(`(() => {
        const K = window.KotOR || {};
        const gs = K.GameState;
        const player = gs && gs.player;
        const module = gs && gs.module;
        const vr = K.VRSpike;

        return {
          connected: true,
          engineMode: gs ? gs.getEngineMode() : null,
          module: module ? (module.name || module.resref || 'unknown') : null,
          player: player ? {
            name: player.getName ? player.getName() : null,
            tag: player.getTag ? player.getTag() : null,
            hp: player.getHP ? player.getHP() : null,
            maxHp: player.getMaxHP ? player.getMaxHP() : null,
            position: player.position ? { x: player.position.x, y: player.position.y, z: player.position.z } : null,
          } : null,
          partyMembersCount: gs && gs.party ? gs.party.length : 0,
          vrSessionActive: !!(vr && vr.session),
          gizmosEnabled: vr ? vr.isInteractionGizmosEnabled() : false,
          isRecordingTrace: vr ? vr.inputRecorder.isRecording() : false,
          isPlayingTrace: vr ? vr.tracePlayer.isPlaying() : false,
        };
      })()`);
      return state;
    }

    case 'vr_inspect_interaction_targets': {
      const maxDistance = args.maxDistance || 50;
      const targets = await cdp.evaluate(`(() => {
        const K = window.KotOR || {};
        const vr = K.VRSpike;
        if (!vr || !vr.interactionRegistry) return { targets: [] };

        const all = vr.interactionRegistry.getTargets();
        const player = K.GameState && K.GameState.player;
        const pPos = player && player.position ? player.position : { x: 0, y: 0, z: 0 };
        const temp = new (window.THREE.Vector3)();

        return {
          totalCount: all.length,
          targets: all.map(t => {
            const worldPos = t.getWorldPosition(temp);
            const dist = Math.hypot(worldPos.x - pPos.x, worldPos.y - pPos.y, worldPos.z - pPos.z);
            return {
              id: t.id,
              label: t.label || '(unlabeled)',
              radiusMetres: t.radiusMetres,
              modes: t.interactionModes,
              isAvailable: t.isAvailable ? t.isAvailable() : true,
              worldPosition: { x: Number(worldPos.x.toFixed(2)), y: Number(worldPos.y.toFixed(2)), z: Number(worldPos.z.toFixed(2)) },
              distanceFromPlayerMetres: Number(dist.toFixed(2)),
            };
          }).filter(t => t.distanceFromPlayerMetres <= ${maxDistance}),
        };
      })()`);
      return targets;
    }

    case 'vr_simulate_input': {
      const hand = args.hand || 'right';
      const action = args.action;

      if (action === 'press_button') {
        const btn = args.button || 'trigger';
        const dur = args.durationMs || 120;
        await driver.pressButton(hand, btn, dur);
        return { success: true, message: `Pressed button ${btn} on ${hand} hand for ${dur}ms` };
      } else if (action === 'trigger') {
        await driver.pressTrigger(hand, args.durationMs || 100);
        return { success: true, message: `Trigger pulled on ${hand} hand` };
      } else if (action === 'grip') {
        await driver.squeezeGrip(hand, args.durationMs || 200);
        return { success: true, message: `Grip squeezed on ${hand} hand` };
      } else if (action === 'set_axes') {
        const [x, y] = args.axes || [0, 0];
        await driver.moveThumbstick(hand, x, y, args.durationMs || 500);
        return { success: true, message: `Moved thumbstick on ${hand} to [${x}, ${y}]` };
      } else if (action === 'force_flick') {
        const res = await driver.performForceFlick({ direction: args.flickDirection || 'push', hand });
        return { success: true, gesture: res };
      } else if (action === 'melee_swing') {
        const res = await driver.performMeleeSwing({ direction: args.swingDirection || 'horizontal', hand });
        return { success: true, gesture: res };
      }
      throw new Error(`Unsupported action: ${action}`);
    }

    case 'vr_toggle_debug_gizmos': {
      const result = await cdp.evaluate(`(() => {
        const K = window.KotOR || {};
        const vr = K.VRSpike;
        if (!vr) throw new Error('VRSpike is not available');
        const explicit = ${args.enabled !== undefined ? JSON.stringify(args.enabled) : 'null'};
        if (explicit !== null) {
          vr.setInteractionGizmosEnabled(explicit);
        } else {
          vr.toggleInteractionGizmos();
        }
        return { gizmosEnabled: vr.isInteractionGizmosEnabled() };
      })()`);
      return result;
    }

    case 'vr_record_trace': {
      const cmd = args.command;
      if (cmd === 'start') {
        const res = await cdp.evaluate(`(() => {
          const K = window.KotOR || {};
          const vr = K.VRSpike;
          if (!vr) throw new Error('VRSpike is not available');
          vr.startInputRecording({ title: ${JSON.stringify(args.title || 'agent-recording')} });
          return { recordingStarted: true };
        })()`);
        return res;
      } else if (cmd === 'stop') {
        const trace = await cdp.evaluate(`(() => {
          const K = window.KotOR || {};
          const vr = K.VRSpike;
          if (!vr) throw new Error('VRSpike is not available');
          const recording = vr.stopInputRecording();
          return recording;
        })()`);
        const outDir = path.join(__dirname, '..', 'vr-emulator', 'evidence');
        fs.mkdirSync(outDir, { recursive: true });
        const filePath = path.join(outDir, `trace-${Date.now()}.vrtrace.json`);
        fs.writeFileSync(filePath, JSON.stringify(trace, null, 2), 'utf8');
        return {
          recordingStopped: true,
          frameCount: trace.metadata.frameCount,
          durationMs: trace.metadata.durationMs,
          savedTo: filePath,
        };
      } else {
        const status = await cdp.evaluate(`(() => {
          const K = window.KotOR || {};
          const vr = K.VRSpike;
          return {
            isRecording: vr ? vr.inputRecorder.isRecording() : false,
            frameCount: vr ? vr.inputRecorder.getFrameCount() : 0,
            durationMs: vr ? vr.inputRecorder.getDurationMs(performance.now()) : 0,
          };
        })()`);
        return status;
      }
    }

    case 'vr_replay_trace': {
      if (!fs.existsSync(args.tracePath)) {
        throw new Error(`Trace file not found: ${args.tracePath}`);
      }
      const raw = fs.readFileSync(args.tracePath, 'utf8');
      const traceData = JSON.parse(raw);
      const result = await cdp.evaluate(`(() => {
        const K = window.KotOR || {};
        const vr = K.VRSpike;
        if (!vr) throw new Error('VRSpike is not available');
        const trace = ${JSON.stringify(traceData)};
        vr.playInputTrace(trace, { loop: ${args.loop === true}, playbackSpeed: ${Number(args.speed || 1.0)} });
        return { playbackStarted: true, frameCount: trace.frames.length, durationMs: trace.metadata.durationMs };
      })()`);
      return result;
    }

    case 'vr_capture_screenshot': {
      const outDir = path.join(__dirname, '..', 'vr-emulator', 'evidence');
      fs.mkdirSync(outDir, { recursive: true });
      const filename = args.filename || `screenshot-${Date.now()}.png`;
      const filePath = path.join(outDir, filename);

      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
      return { success: true, savedTo: filePath };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// JSON-RPC stdio loop
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  if (!line || !line.trim()) return;
  let req;
  try {
    req = JSON.parse(line.trim());
  } catch (err) {
    return;
  }

  const { id, method, params } = req;

  if (method === 'initialize') {
    const res = {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'kotor-vr-mcp',
          version: '1.0.0',
        },
      },
    };
    process.stdout.write(JSON.stringify(res) + '\n');
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'ping') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: {} }) + '\n');
    return;
  }

  if (method === 'tools/list') {
    const res = {
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOLS,
      },
    };
    process.stdout.write(JSON.stringify(res) + '\n');
    return;
  }

  if (method === 'tools/call') {
    try {
      const { name, arguments: args } = params || {};
      const output = await handleToolCall(name, args || {});
      const res = {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
        },
      };
      process.stdout.write(JSON.stringify(res) + '\n');
    } catch (err) {
      const res = {
        jsonrpc: '2.0',
        id,
        isError: true,
        result: {
          content: [
            {
              type: 'text',
              text: `Error executing ${params && params.name}: ${err.message}`,
            },
          ],
        },
      };
      process.stdout.write(JSON.stringify(res) + '\n');
    }
  }
});
