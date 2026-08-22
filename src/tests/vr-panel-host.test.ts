import * as THREE from 'three';
import { describe, expect, jest, test } from '@jest/globals';
import { VRPanelHost } from '@/vr/runtime/VRPanelHost';
import { XRWorldPose } from '@/vr/runtime/XRTypes';

describe('VRPanelHost', () => {
  test('places a readable panel once in front of the head when a menu opens', () => {
    const worldScene = new THREE.Scene();
    const host = new VRPanelHost(worldScene, { distanceMetres: 1.5, widthMetres: 1.6 });
    const head = pose(
      new THREE.Vector3(10, 20, 2),
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(1, 0, 0)
      )
    );
    const owner = {};

    host.present(owner, head, 1600, 900);

    expect(host.isVisible).toBe(true);
    expect(host.object.parent).toBe(worldScene);
    expect(host.object.position.x).toBeCloseTo(11.5);
    expect(host.object.position.y).toBeCloseTo(20);
    expect(host.object.position.z).toBeCloseTo(2);
    expect(host.object.scale.x).toBeCloseTo(1.6);
    expect(host.object.scale.y).toBeCloseTo(0.9);

    host.present(owner, pose(new THREE.Vector3(30, 40, 5), new THREE.Quaternion()), 1600, 900);
    expect(host.object.position.x).toBeCloseTo(11.5);
    expect(host.object.position.y).toBeCloseTo(20);
  });

  test('spawns a pitched-head menu at eye level and keeps it upright', () => {
    const host = new VRPanelHost(new THREE.Scene(), { distanceMetres: 1.5 });
    const pitchedForward = new THREE.Vector3(1, 0, -1).normalize();
    const head = pose(
      new THREE.Vector3(4, 5, 1.72),
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, -1),
        pitchedForward
      )
    );

    host.present({}, head, 1600, 900);

    expect(host.object.position.toArray()).toEqual([5.5, 5, 1.72]);
    const panelUp = new THREE.Vector3(0, 1, 0).applyQuaternion(host.object.quaternion);
    expect(panelUp.x).toBeCloseTo(0);
    expect(panelUp.y).toBeCloseTo(0);
    expect(panelUp.z).toBeCloseTo(1);
  });

  test.each([
    new THREE.Quaternion(),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI),
  ])('faces the player for each supported startup heading', (orientation) => {
    const host = new VRPanelHost(new THREE.Scene());
    const head = pose(new THREE.Vector3(3, 4, 1.7), orientation);

    host.present({}, head, 1600, 900);

    const panelFront = new THREE.Vector3(0, 0, 1).applyQuaternion(host.object.quaternion);
    const panelToHead = head.position.clone().sub(host.object.position).normalize();
    expect(panelFront.dot(panelToHead)).toBeGreaterThan(0.999);
  });

  test('keeps an open panel fixed in the world until its owner changes', () => {
    const host = new VRPanelHost(new THREE.Scene(), { distanceMetres: 1.5 });
    const owner = {};
    host.present(owner, pose(new THREE.Vector3(0, 0, 1.7), new THREE.Quaternion()), 1600, 900);

    host.present(
      owner,
      pose(
        new THREE.Vector3(4, 5, 1.7),
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, -1),
          new THREE.Vector3(1, 0, 0)
        )
      ),
      1600,
      900
    );

    expect(host.object.position.toArray()).toEqual([0, 1.5, 1.7]);
    const panelUp = new THREE.Vector3(0, 1, 0).applyQuaternion(host.object.quaternion);
    expect(panelUp.x).toBeCloseTo(0);
    expect(panelUp.y).toBeCloseTo(0);
    expect(panelUp.z).toBeCloseTo(1);

    const nextOwner = {};
    host.present(nextOwner, pose(new THREE.Vector3(4, 5, 1.7), new THREE.Quaternion()), 1600, 900);
    expect(host.object.position.toArray()).toEqual([4, 6.5, 1.7]);
  });

  test('raises the authored lower-canvas main menu without moving character generation', () => {
    const host = new VRPanelHost(new THREE.Scene());
    const head = pose(new THREE.Vector3(0, 0, 1.7), new THREE.Quaternion());

    host.present({ gui_resref: 'mainmenu8x6_p' }, head, 1600, 900);
    expect(host.object.position.z).toBeCloseTo(2.0);

    host.clear();
    host.present({ gui_resref: 'classsel_p' }, head, 1600, 900);
    expect(host.object.position.z).toBeCloseTo(1.7);
  });

  test('renders the GUI into its texture with XR disabled and restores renderer state', () => {
    const guiScene = new THREE.Scene();
    const guiCamera = new THREE.OrthographicCamera();
    const host = new VRPanelHost(new THREE.Scene());
    host.present({}, pose(new THREE.Vector3(), new THREE.Quaternion()), 1280, 720);
    const previousTarget = {} as THREE.WebGLRenderTarget;
    const renderer = createRenderer(previousTarget);

    host.renderGui(renderer as unknown as THREE.WebGLRenderer, guiScene, guiCamera);

    expect(renderer.render).toHaveBeenCalledWith(guiScene, guiCamera);
    expect(renderer.xr.enabled).toBe(true);
    expect(renderer.autoClear).toBe(false);
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(previousTarget);
    expect(renderer.setClearAlpha).toHaveBeenLastCalledWith(1);
  });

  test('runs a menu-owned legacy pass with XR disabled before rendering the GUI scene', () => {
    const guiScene = new THREE.Scene();
    const guiCamera = new THREE.OrthographicCamera();
    const host = new VRPanelHost(new THREE.Scene());
    const renderer = createRenderer({} as THREE.WebGLRenderTarget);
    const render = jest.fn((passRenderer: THREE.WebGLRenderer) => {
      expect(passRenderer.xr.enabled).toBe(false);
    });

    host.renderGui(
      renderer as unknown as THREE.WebGLRenderer,
      guiScene,
      guiCamera,
      { render }
    );

    expect((render as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toBe(renderer);
    expect(render.mock.invocationCallOrder[0]).toBeLessThan(
      (renderer.render as jest.Mock).mock.invocationCallOrder[0]
    );
  });

  test('composites authored cutscene and caption layers into one theater target', () => {
    const cutsceneScene = new THREE.Scene();
    const cutsceneCamera = new THREE.PerspectiveCamera();
    const captionScene = new THREE.Scene();
    const captionCamera = new THREE.OrthographicCamera();
    const host = new VRPanelHost(new THREE.Scene());
    const renderer = createRenderer({} as THREE.WebGLRenderTarget);

    host.renderGuiLayers(renderer as unknown as THREE.WebGLRenderer, [
      { scene: cutsceneScene, camera: cutsceneCamera },
      { scene: captionScene, camera: captionCamera },
    ]);

    expect(renderer.setRenderTarget).toHaveBeenCalledWith(host.renderTarget);
    expect(renderer.render).toHaveBeenNthCalledWith(1, cutsceneScene, cutsceneCamera);
    expect(renderer.render).toHaveBeenNthCalledWith(2, captionScene, captionCamera);
    expect(renderer.setRenderTarget).toHaveBeenCalledTimes(2);
    expect(renderer.xr.enabled).toBe(true);
  });

  test('hides and releases panel ownership when presentation is cancelled', () => {
    const host = new VRPanelHost(new THREE.Scene());
    host.present({}, pose(new THREE.Vector3(), new THREE.Quaternion()), 1280, 720);

    host.clear();

    expect(host.isVisible).toBe(false);
    expect(host.owner).toBeNull();
  });
});

function pose(position: THREE.Vector3, orientation: THREE.Quaternion): XRWorldPose {
  return {
    position,
    orientation,
    linearVelocity: null,
    angularVelocity: null,
    trackingState: 'tracked',
  };
}

function createRenderer(previousTarget: THREE.WebGLRenderTarget) {
  let clearAlpha = 1;
  return {
    xr: { enabled: true },
    autoClear: false,
    getRenderTarget: jest.fn(() => previousTarget),
    setRenderTarget: jest.fn(),
    getClearAlpha: jest.fn(() => clearAlpha),
    setClearAlpha: jest.fn((value: number) => { clearAlpha = value; }),
    clear: jest.fn(),
    render: jest.fn(),
  };
}
