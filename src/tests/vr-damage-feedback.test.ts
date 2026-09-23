import { describe, expect, it } from "@jest/globals";
import * as THREE from "three";
import { VRDamageFeedbackTracker, resolveVRDamageSide } from "@/vr/runtime/VRDamageFeedback";
import { VRDamageFlashHost } from "@/vr/runtime/VRDamageFlashHost";

// KOTOR world is Z-up; the player faces +Y here.
const PLAYER = new THREE.Vector3(0, 0, 0);
const FORWARD = new THREE.Vector3(0, 1, 0);

describe("resolveVRDamageSide (ROADMAP 3.14)", () => {
  it.each([
    [new THREE.Vector3(-3, 0, 0), "left"],
    [new THREE.Vector3(3, 0, 0), "right"],
    [new THREE.Vector3(0.5, 4, 0), "front"],
    [new THREE.Vector3(-0.5, -4, 0), "behind"],
    [new THREE.Vector3(-2, 2, 0), "left"],
    [new THREE.Vector3(2, -2, 0), "right"],
  ] as const)("an attacker at %o is on the %s", (attacker, side) => {
    expect(resolveVRDamageSide(attacker, PLAYER, FORWARD)).toBe(side);
  });

  it("ignores height, and looking up or down", () => {
    const pitchedForward = new THREE.Vector3(0, 0.3, 0.95);
    expect(resolveVRDamageSide(new THREE.Vector3(-3, 0, 5), PLAYER, pitchedForward)).toBe("left");
  });

  it("is unknown when the attacker stands on the player", () => {
    expect(resolveVRDamageSide(new THREE.Vector3(0, 0, 1), PLAYER, FORWARD)).toBe("unknown");
  });
});

describe("VRDamageFeedbackTracker", () => {
  const observe = (tracker: VRDamageFeedbackTracker, hitPoints: number, nowMs: number, actorId = 7) =>
    tracker.observe({ actorId, hitPoints, playerPosition: PLAYER, headForward: FORWARD, nowMs });

  it("reports a drop in hit points on the side of the last attacker", () => {
    const tracker = new VRDamageFeedbackTracker();
    expect(observe(tracker, 40, 1_000)).toBeNull();
    tracker.recordAttack({ attackerPosition: new THREE.Vector3(-3, 0, 0), critical: false, timestampMs: 1_010 });
    expect(observe(tracker, 34, 1_400)).toEqual({ side: "left", critical: false, amount: 6 });
  });

  it("carries a critical from the roll to the damage", () => {
    const tracker = new VRDamageFeedbackTracker();
    observe(tracker, 40, 1_000);
    tracker.recordAttack({ attackerPosition: new THREE.Vector3(3, 0, 0), critical: true, timestampMs: 1_000 });
    expect(observe(tracker, 20, 1_100)).toMatchObject({ side: "right", critical: true });
  });

  it("shows damage with no recent attacker, such as a mine, as unattributed", () => {
    const tracker = new VRDamageFeedbackTracker();
    observe(tracker, 40, 1_000);
    tracker.recordAttack({ attackerPosition: new THREE.Vector3(3, 0, 0), critical: false, timestampMs: 1_000 });
    expect(observe(tracker, 30, 9_000)).toMatchObject({ side: "unknown" });
  });

  it("uses an attack once, so a following poison tick is not blamed on it", () => {
    const tracker = new VRDamageFeedbackTracker();
    observe(tracker, 40, 1_000);
    tracker.recordAttack({ attackerPosition: new THREE.Vector3(-3, 0, 0), critical: false, timestampMs: 1_000 });
    expect(observe(tracker, 35, 1_100)?.side).toBe("left");
    expect(observe(tracker, 33, 1_200)?.side).toBe("unknown");
  });

  it("does not treat healing, a party swap or the first frame as a hit", () => {
    const tracker = new VRDamageFeedbackTracker();
    expect(observe(tracker, 10, 1_000)).toBeNull();
    expect(observe(tracker, 30, 1_100)).toBeNull();
    // Swapping to a companion with fewer hit points is not damage.
    expect(observe(tracker, 5, 1_200, 8)).toBeNull();
    expect(observe(tracker, 3, 1_300, 8)).toMatchObject({ amount: 2 });
  });
});

describe("VRDamageFlashHost", () => {
  const edges = (host: VRDamageFlashHost) => {
    const [left, right] = host.object.children as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[];
    return { left, right };
  };

  it("lights only the side the hit came from, then fades out", () => {
    const camera = new THREE.Object3D();
    const host = new VRDamageFlashHost(camera, () => null);
    host.flash("left", false, 1_000);
    host.update(1_000);
    expect(edges(host).left.visible).toBe(true);
    expect(edges(host).right.visible).toBe(false);
    host.update(1_500);
    expect(edges(host).left.visible).toBe(false);
  });

  it("lights both edges for a hit from in front, and harder for a critical", () => {
    const host = new VRDamageFlashHost(new THREE.Object3D(), () => null);
    host.flash("front", false, 1_000);
    host.update(1_000);
    const normal = edges(host).left.material.opacity;
    expect(edges(host).right.visible).toBe(true);

    const critical = new VRDamageFlashHost(new THREE.Object3D(), () => null);
    critical.flash("behind", true, 1_000);
    critical.update(1_000);
    expect(edges(critical).left.material.opacity).toBeGreaterThan(normal);
  });
});
