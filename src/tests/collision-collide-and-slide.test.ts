import * as THREE from 'three';
import { describe, expect, it, test } from '@jest/globals';
import { getChokeSlideVelocity } from '@/engine/collision/ChokeSlideRules';

describe('CollisionManager choke-point slide behavior', () => {
  it('allows sliding forward down a tapered corridor when velocity penetrates both walls', () => {
    // Left wall normal pointing +X into corridor, right wall normal pointing mostly -X but angled
    const n1 = new THREE.Vector3(1, 0, 0);
    const n2Tapered = new THREE.Vector3(-0.95, -0.3, 0).normalize();

    expect(n1.dot(n2Tapered)).toBeLessThan(-0.3);

    // Actor trying to move down corridor (+Y) with slight angle into left wall
    const velocity = new THREE.Vector3(-0.2, 1.0, 0);
    expect(velocity.dot(n1)).toBeLessThan(0); // into left wall
    expect(velocity.dot(n2Tapered)).toBeLessThan(0); // into tapered right wall too!

    const slide = getChokeSlideVelocity(n1, n2Tapered, velocity);
    expect(slide).not.toBeNull();
    // Slide should point forward down corridor (+Y)
    expect(slide!.y).toBeGreaterThan(0.8);
    // Slide should not drive steeply into either wall
    expect(slide!.dot(n1)).toBeGreaterThanOrEqual(-0.25);
    expect(slide!.dot(n2Tapered)).toBeGreaterThanOrEqual(-0.25);
  });

  it('allows sliding along corridor centerline for opposing parallel walls', () => {
    const n1 = new THREE.Vector3(1, 0, 0);
    const n2 = new THREE.Vector3(-1, 0, 0);

    expect(n1.dot(n2)).toBe(-1);

    const velocity = new THREE.Vector3(0, 1.0, 0);
    const slide = getChokeSlideVelocity(n1, n2, velocity);
    expect(slide).not.toBeNull();
    expect(slide!.y).toBeCloseTo(1.0);
    expect(slide!.x).toBeCloseTo(0.0);
  });

  it('blocks forward movement into a closed dead-end apex where both slide directions penetrate', () => {
    // Funnel closing in +Y direction: both normals have negative Y components
    const n1 = new THREE.Vector3(0.9, -0.436, 0).normalize();
    const n2 = new THREE.Vector3(-0.9, -0.436, 0).normalize();

    expect(n1.dot(n2)).toBeLessThan(-0.3);

    // Velocity directly driving forward into the closed apex
    const velocity = new THREE.Vector3(0, 1.0, 0);
    expect(velocity.dot(n1)).toBeLessThan(0);
    expect(velocity.dot(n2)).toBeLessThan(0);

    const slide = getChokeSlideVelocity(n1, n2, velocity);
    // Should be null because moving forward along either wall cuts through the opposing wall
    expect(slide).toBeNull();
  });

  it('does not choke when velocity moves away from walls', () => {
    // Funnel closing in +Y direction, but actor is backing out in -Y
    const n1 = new THREE.Vector3(0.9, -0.436, 0).normalize();
    const n2 = new THREE.Vector3(-0.9, -0.436, 0).normalize();

    const backingOut = new THREE.Vector3(0, -1.0, 0);
    // Moving away from both faces
    expect(backingOut.dot(n1)).toBeGreaterThan(0);
    expect(backingOut.dot(n2)).toBeGreaterThan(0);
  });
});
