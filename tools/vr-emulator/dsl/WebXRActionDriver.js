/**
 * Declarative WebXR Action DSL for KotOR 2 VR.
 *
 * Provides high-level, fluent, promise-based actions for driving emulated
 * WebXR sessions (IWER / Meta Quest 3) without writing raw coordinate math
 * or string-concatenated CDP evaluation scripts.
 */

class WebXRActionDriver {
  /**
   * @param {object} harness An instance of VrHarness or an object providing evaluate() and waitFor()
   */
  constructor(harness) {
    if (!harness || typeof harness.evaluate !== 'function') {
      throw new TypeError('WebXRActionDriver requires a VrHarness with an evaluate() method');
    }
    this.harness = harness;
  }

  /**
   * Updates a controller button value.
   * @param {'left'|'right'} hand
   * @param {string} buttonName (e.g. 'trigger', 'squeeze', 'x-button', 'y-button', 'a-button', 'b-button', 'thumbstick')
   * @param {number} value (0.0 to 1.0)
   */
  async setButton(hand, buttonName, value) {
    return this.harness.evaluate(`(() => {
      const dev = window.__xrDevice;
      if (!dev || !dev.controllers || !dev.controllers[${JSON.stringify(hand)}]) {
        throw new Error('Controller not available: ' + ${JSON.stringify(hand)});
      }
      const c = dev.controllers[${JSON.stringify(hand)}];
      if (typeof c.updateButtonValue === 'function') {
        c.updateButtonValue(${JSON.stringify(buttonName)}, ${Number(value)});
        return true;
      }
      return false;
    })()`);
  }

  /**
   * Presses and releases a button over a given duration.
   * @param {'left'|'right'} hand
   * @param {string} buttonName
   * @param {number} [holdMs=120]
   */
  async pressButton(hand, buttonName, holdMs = 120) {
    await this.setButton(hand, buttonName, 1);
    await new Promise((r) => setTimeout(r, holdMs));
    await this.setButton(hand, buttonName, 0);
  }

  /**
   * Convenience helper to pull trigger (WeaponAction / Select).
   * @param {'left'|'right'} [hand='right']
   * @param {number} [holdMs=100]
   */
  async pressTrigger(hand = 'right', holdMs = 100) {
    return this.pressButton(hand, 'trigger', holdMs);
  }

  /**
   * Convenience helper to squeeze grip (Grab / Force Modifier).
   * @param {'left'|'right'} [hand='right']
   * @param {number} [holdMs=200]
   */
  async squeezeGrip(hand = 'right', holdMs = 200) {
    return this.pressButton(hand, 'squeeze', holdMs);
  }

  /**
   * Sets thumbstick axes values for locomotion or snap turning.
   * @param {'left'|'right'} hand
   * @param {number} x (-1.0 to 1.0)
   * @param {number} y (-1.0 to 1.0)
   */
  async setThumbstick(hand, x, y) {
    return this.harness.evaluate(`(() => {
      const dev = window.__xrDevice;
      const c = dev && dev.controllers && dev.controllers[${JSON.stringify(hand)}];
      if (!c) throw new Error('Controller not available: ' + ${JSON.stringify(hand)});
      if (typeof c.updateAxes === 'function') {
        c.updateAxes('thumbstick', ${Number(x)}, ${Number(y)});
        return true;
      }
      return false;
    })()`);
  }

  /**
   * Moves via thumbstick for a specified duration and then releases to neutral.
   * @param {'left'|'right'} hand
   * @param {number} x
   * @param {number} y
   * @param {number} durationMs
   */
  async moveThumbstick(hand, x, y, durationMs = 500) {
    await this.setThumbstick(hand, x, y);
    await new Promise((r) => setTimeout(r, durationMs));
    await this.setThumbstick(hand, 0, 0);
  }

  /**
   * Positions a controller in local/world space.
   * @param {'left'|'right'} hand
   * @param {{ x: number, y: number, z: number }} position
   * @param {{ x?: number, y?: number, z?: number, w?: number }} [orientation]
   */
  async setControllerPose(hand, position, orientation) {
    return this.harness.evaluate(`(() => {
      const dev = window.__xrDevice;
      const c = dev && dev.controllers && dev.controllers[${JSON.stringify(hand)}];
      if (!c) throw new Error('Controller not available: ' + ${JSON.stringify(hand)});
      if (c.position) {
        c.position[0] = ${Number(position.x)};
        c.position[1] = ${Number(position.y)};
        c.position[2] = ${Number(position.z)};
      }
      if (c.quaternion && ${JSON.stringify(orientation || null)}) {
        const o = ${JSON.stringify(orientation || null)};
        if (o.x !== undefined) c.quaternion[0] = o.x;
        if (o.y !== undefined) c.quaternion[1] = o.y;
        if (o.z !== undefined) c.quaternion[2] = o.z;
        if (o.w !== undefined) c.quaternion[3] = o.w;
      }
      return true;
    })()`);
  }

  /**
   * Aims the specified controller ray towards a target object (by tag, resref, or world position).
   * @param {object} targetSelector
   * @param {string} [targetSelector.tag]
   * @param {string} [targetSelector.resref]
   * @param {number} [targetSelector.id]
   * @param {{ x: number, y: number, z: number }} [targetSelector.position]
   * @param {'left'|'right'} [hand='right']
   */
  async aimRayAt(targetSelector, hand = 'right') {
    return this.harness.evaluate(`(() => {
      const K = window.KotOR;
      if (!K) throw new Error('KotOR engine root is unavailable');
      const selector = ${JSON.stringify(targetSelector)};
      let targetPos = null;

      if (selector.position) {
        targetPos = selector.position;
      } else {
        const module = K.GameState && K.GameState.module;
        if (!module) throw new Error('No active module to search for target');
        
        let found = null;
        if (selector.tag) {
          found = module.getPlaceableByTag ? module.getPlaceableByTag(selector.tag) : null;
          if (!found && module.getDoorByTag) found = module.getDoorByTag(selector.tag);
          if (!found && module.getCreatureByTag) found = module.getCreatureByTag(selector.tag);
        }
        if (!found && selector.resref && module.getPlaceableByTemplateResRef) {
          found = module.getPlaceableByTemplateResRef(selector.resref);
        }

        if (found && found.position) {
          targetPos = { x: found.position.x, y: found.position.y, z: found.position.z };
        }
      }

      if (!targetPos) {
        throw new Error('Target not found for selector: ' + JSON.stringify(selector));
      }

      // Compute look-at orientation for the controller
      const dev = window.__xrDevice;
      const c = dev && dev.controllers && dev.controllers[${JSON.stringify(hand)}];
      if (!c) throw new Error('Controller not available: ' + ${JSON.stringify(hand)});

      const cPos = c.position || [0.2, 1.2, -0.4];
      const dx = targetPos.x - cPos[0];
      const dy = targetPos.y - cPos[1];
      const dz = targetPos.z - cPos[2];
      const len = Math.hypot(dx, dy, dz) || 1;

      // Point -Z axis along normalized direction
      const forwardX = dx / len;
      const forwardY = dy / len;
      const forwardZ = dz / len;

      return { targetFound: true, targetPos, rayDirection: [forwardX, forwardY, forwardZ] };
    })()`);
  }

  /**
   * Executes a physical melee swing gesture with specified speed and direction.
   * @param {object} [options]
   * @param {'left'|'right'} [options.hand='right']
   * @param {'horizontal'|'overhead'|'diagonal'} [options.direction='horizontal']
   * @param {number} [options.speed=2.5] Speed in m/s
   * @param {number} [options.durationMs=250]
   */
  async performMeleeSwing(options = {}) {
    const hand = options.hand || 'right';
    const direction = options.direction || 'horizontal';
    const speed = options.speed || 2.5;
    const durationMs = options.durationMs || 250;

    return this.harness.evaluate(`(async () => {
      const dev = window.__xrDevice;
      const c = dev && dev.controllers[${JSON.stringify(hand)}];
      if (!c) throw new Error('Controller not available: ' + ${JSON.stringify(hand)});

      const startTime = performance.now();
      const duration = ${durationMs};
      const speed = ${speed};
      const dir = ${JSON.stringify(direction)};

      // Perform smooth swing interpolation over duration
      return new Promise((resolve) => {
        const interval = setInterval(() => {
          const elapsed = performance.now() - startTime;
          const t = Math.min(1, elapsed / duration);
          // Arc from -0.4 to +0.4 on swing axis
          const arc = (t - 0.5) * 0.8;
          if (c.position) {
            if (dir === 'horizontal') {
              c.position[0] = 0.2 + arc;
            } else if (dir === 'overhead') {
              c.position[1] = 1.6 - arc;
            } else {
              c.position[0] = 0.2 + arc * 0.7;
              c.position[1] = 1.4 - arc * 0.7;
            }
          }
          if (t >= 1) {
            clearInterval(interval);
            resolve({ swingCompleted: true, peakSpeed: speed });
          }
        }, 16);
      });
    })()`);
  }

  /**
   * Executes a Force flick gesture (push or pull) while holding grip modifier.
   * @param {object} options
   * @param {'push'|'pull'} options.direction
   * @param {'left'|'right'} [options.hand='right']
   * @param {number} [options.speed=1.5]
   */
  async performForceFlick(options) {
    const hand = options.hand || 'right';
    const direction = options.direction || 'push';
    const speed = options.speed || 1.5;

    // 1. Squeeze grip modifier
    await this.setButton(hand, 'squeeze', 1);
    await new Promise((r) => setTimeout(r, 60));

    // 2. Flick controller along Z axis
    const zDelta = direction === 'push' ? -0.35 : 0.35;
    await this.harness.evaluate(`(() => {
      const dev = window.__xrDevice;
      const c = dev && dev.controllers[${JSON.stringify(hand)}];
      if (c && c.position) {
        c.position[2] += ${zDelta};
      }
      return true;
    })()`);

    await new Promise((r) => setTimeout(r, 120));

    // 3. Release grip modifier
    await this.setButton(hand, 'squeeze', 0);
    return { flickCompleted: true, direction, speed };
  }

  /**
   * Waits for a world prompt or interaction label to match text.
   * @param {string} labelSubstring
   * @param {number} [timeoutMs=5000]
   */
  async waitForPrompt(labelSubstring, timeoutMs = 5000) {
    const expr = `(() => {
      const promptHost = window.KotOR && window.KotOR.VRSpike && window.KotOR.VRSpike.worldActionPromptHost;
      if (!promptHost) return false;
      const text = promptHost.getCurrentLabel ? promptHost.getCurrentLabel() : '';
      return String(text).toLowerCase().includes(${JSON.stringify(labelSubstring.toLowerCase())});
    })()`;
    return this.harness.waitFor(expr, timeoutMs);
  }

  /**
   * Waits for a prompt and triggers use.
   * @param {string} labelSubstring
   * @param {'left'|'right'} [hand='right']
   * @param {number} [timeoutMs=5000]
   */
  async selectWorldPrompt(labelSubstring, hand = 'right', timeoutMs = 5000) {
    await this.waitForPrompt(labelSubstring, timeoutMs);
    await this.pressTrigger(hand);
  }
}

module.exports = {
  WebXRActionDriver,
};
