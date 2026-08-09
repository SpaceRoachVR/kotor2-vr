import * as THREE from "three";
import { PerfSampler } from "./PerfSampler";

/**
 * Phase 0.1 — stereo perf spike.
 *
 * This is a MEASUREMENT HARNESS, not the VR layer. Roadmap 0.1 says explicitly:
 * do not build the rig here. There is no locomotion, no controller input, no
 * walkmesh coupling and no comfort handling. The only job is to submit two eyes
 * of `101PER` and find out what it costs.
 *
 * Three things had to change in the engine for that to be possible, and each is
 * kept behind an `isPresenting` check so the flatscreen path is untouched:
 *
 *  1. The GL context is created before this runs, so it must be promoted with
 *     `makeXRCompatible()` rather than the usual `{ xrCompatible: true }`.
 *  2. WebXR owns the frame callback. `requestAnimationFrame` runs at monitor
 *     rate, not headset rate, so `GameState.scheduleNextFrame()` defers to
 *     `renderer.setAnimationLoop` while presenting.
 *  3. EffectComposer renders into its own targets and blits to the default
 *     framebuffer. That framebuffer is not the XR one, so nothing reaches the
 *     headset. While presenting we bypass the composer entirely.
 *
 * Point 3 is worth carrying forward: whatever post-processing the mod ends up
 * wanting has to be re-plumbed for XR, it is not free.
 */
/**
 * What the spike needs from the engine. Passed in rather than imported:
 * GameState already imports VRSpike, and importing it back would close a cycle.
 */
export interface VRSpikeHooks {
  /** The engine's frame function. WebXR calls this instead of rAF. */
  update: () => void;
  /** Player's feet in world space, or null before a module is loaded. */
  getPlayerPosition: () => THREE.Vector3 | null;
  /** Follower camera facing, radians about the world Z axis. */
  getFacing: () => number;
}

export class VRSpike {
  static readonly perf = new PerfSampler();

  static renderer: THREE.WebGLRenderer | null = null;
  static scene: THREE.Scene | null = null;
  static hooks: VRSpikeHooks | null = null;

  /** Parent of the XR camera. Its world transform is the headset's origin. */
  static rig: THREE.Group | null = null;
  /** Passed to `renderer.render`; THREE overwrites it from the headset pose. */
  static camera: THREE.PerspectiveCamera | null = null;

  static session: XRSession | null = null;
  static installed = false;

  /**
   * Metres from the walkmesh to the eyes. Fixed and canonical by design
   * decision — no per-player calibration. Only used to place the rig; a
   * `local-floor` reference space supplies the real head height on top.
   */
  static eyeHeight = 1.75;

  /**
   * Yaw correction, radians, applied on top of the follower camera's facing.
   * Exposed because the sign convention is easier to settle by nudging it in
   * DevTools than by reading it out of the camera code.
   */
  static yawOffset = 0;

  /** Follow the in-game camera each frame. Off = stand still and look around. */
  static followCamera = true;

  /**
   * Promote the context, flip on XR, and put an Enter VR button on screen.
   * Safe to call when no headset is attached — it just reports and returns.
   */
  static async install(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    hooks: VRSpikeHooks
  ): Promise<void> {
    if (VRSpike.installed) return;
    VRSpike.installed = true;
    VRSpike.renderer = renderer;
    VRSpike.scene = scene;
    VRSpike.hooks = hooks;
    VRSpike.perf.attach(renderer);

    (window as any).VRSpike = VRSpike;

    if (typeof navigator === 'undefined' || !(navigator as any).xr) {
      console.warn('[VRSpike] navigator.xr is undefined — no WebXR in this runtime.');
      return;
    }

    // The renderer was handed a context that already exists, so the usual
    // `{ xrCompatible: true }` attribute is not an option.
    const gl = renderer.getContext() as WebGLRenderingContext & {
      makeXRCompatible?: () => Promise<void>;
    };
    if (typeof gl.makeXRCompatible === 'function') {
      try {
        await gl.makeXRCompatible();
      } catch (e) {
        // Usually means the GL context is on a different adapter than the HMD.
        console.error('[VRSpike] makeXRCompatible failed — the context cannot present:', e);
        return;
      }
    }

    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');

    VRSpike.rig = new THREE.Group();
    VRSpike.rig.name = 'VRSpike.rig';
    // KOTOR's world is Z-up; WebXR hands back Y-up poses. This rotation is the
    // whole conversion — without it you are lying on your back in the level.
    VRSpike.rig.rotation.x = Math.PI / 2;

    VRSpike.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 15000);
    VRSpike.rig.add(VRSpike.camera);
    scene.add(VRSpike.rig);

    const supported = await (navigator as any).xr.isSessionSupported('immersive-vr');
    console.log(`[VRSpike] installed. immersive-vr supported: ${supported}`);
    VRSpike.addButton(supported);
  }

  private static addButton(supported: boolean): void {
    const btn = document.createElement('button');
    btn.id = 'vr-spike-button';
    btn.textContent = supported ? 'Enter VR (spike)' : 'VR unavailable';
    Object.assign(btn.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      zIndex: '9999',
      padding: '10px 16px',
      font: '13px monospace',
      background: supported ? '#123' : '#333',
      color: supported ? '#7fd' : '#999',
      border: '1px solid #7fd',
      borderRadius: '4px',
      cursor: supported ? 'pointer' : 'not-allowed',
      opacity: '0.85',
    } as CSSStyleDeclaration);
    btn.disabled = !supported;
    btn.addEventListener('click', () => {
      if (VRSpike.session) VRSpike.exit();
      else VRSpike.enter();
    });
    document.body.appendChild(btn);
  }

  /** Request an immersive session and hand the frame loop to WebXR. */
  static async enter(): Promise<void> {
    if (!VRSpike.renderer) return;
    if (VRSpike.session) return;

    try {
      const session: XRSession = await (navigator as any).xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      });
      VRSpike.session = session;
      session.addEventListener('end', VRSpike.onSessionEnd);

      await VRSpike.renderer.xr.setSession(session as any);

      const btn = document.getElementById('vr-spike-button');
      if (btn) btn.textContent = 'Exit VR (spike)';

      // Headset rate, not monitor rate. 72 over Virtual Desktop is the floor
      // the roadmap cares about; read the real value back where available.
      const rate = (session as any).frameRate;
      VRSpike.perf.targetHz = rate || 72;

      // WebXR now drives the loop. GameState.scheduleNextFrame() steps aside.
      VRSpike.renderer.setAnimationLoop(VRSpike.frame);
      VRSpike.perf.start('stereo');
      console.log(`[VRSpike] presenting at target ${VRSpike.perf.targetHz} Hz`);
    } catch (e) {
      console.error('[VRSpike] requestSession failed:', e);
      VRSpike.session = null;
    }
  }

  static exit(): void {
    if (VRSpike.session) VRSpike.session.end();
  }

  private static onSessionEnd = (): void => {
    VRSpike.perf.stop();
    VRSpike.session = null;

    const btn = document.getElementById('vr-spike-button');
    if (btn) btn.textContent = 'Enter VR (spike)';

    // Hand the loop back to requestAnimationFrame, exactly once.
    VRSpike.renderer?.setAnimationLoop(null);
    const update = VRSpike.hooks?.update;
    if (update) requestAnimationFrame(() => update());
    console.log('[VRSpike] session ended, back on requestAnimationFrame');
  };

  /**
   * The frame callback while presenting. WebXR supplies its own timestamp; the
   * engine reads THREE.Clock instead and does not need it.
   */
  private static frame = (): void => {
    VRSpike.hooks?.update();
  };

  static get isPresenting(): boolean {
    return !!VRSpike.renderer?.xr?.isPresenting;
  }

  /**
   * Stereo render path. Replaces `composer.render()` while presenting.
   *
   * `autoClear` is false engine-wide because the flatscreen path layers world,
   * GUI and cursor passes by hand. In XR we own the whole frame, so clear once
   * and submit the world only. The GUI scene is deliberately absent: it is an
   * orthographic overlay with no meaning in a headset, and Phase 4 replaces it.
   */
  static render(worldCamera: THREE.Camera): void {
    const renderer = VRSpike.renderer;
    const scene = VRSpike.scene;
    if (!renderer || !scene || !VRSpike.camera || !VRSpike.rig) return;

    if (VRSpike.followCamera && worldCamera) {
      VRSpike.syncRig(worldCamera);
    }

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.render(scene, VRSpike.camera);
    renderer.autoClear = prevAutoClear;
  }

  /**
   * Put the rig where the player is standing. Height comes from the floor, not
   * from the follower camera, which sits well above the head and pitched down.
   */
  private static syncRig(worldCamera: THREE.Camera): void {
    const rig = VRSpike.rig;
    if (!rig) return;

    const feet = VRSpike.hooks?.getPlayerPosition() ?? null;
    if (feet) {
      rig.position.copy(feet);
    } else {
      worldCamera.getWorldPosition(rig.position);
      rig.position.z -= VRSpike.eyeHeight;
    }

    // Rebuild the rotation each frame: Z-up conversion first, then yaw about
    // the world's up axis. Order matters — yaw is applied in world space.
    const facing = VRSpike.hooks?.getFacing() ?? 0;
    rig.rotation.set(Math.PI / 2, 0, 0);
    rig.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), facing + VRSpike.yawOffset);
  }
}
