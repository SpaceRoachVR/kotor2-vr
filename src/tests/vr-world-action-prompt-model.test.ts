import * as THREE from 'three';
import { describe, expect, jest, test } from '@jest/globals';
import {
  VRWorldActionPromptModel,
  VRWorldPromptAction,
  VRWorldPromptCandidate,
  buildVRWorldPromptPages,
  resolveValidVRWorldPromptPage,
  selectVRWorldPromptCandidate,
} from '@/vr/runtime/VRWorldActionPromptModel';
import { XRWorldPose } from '@/vr/runtime/XRTypes';

describe('selectVRWorldPromptCandidate', () => {
  test('prefers an explicitly aimed eligible object, otherwise view-center angle then distance then id', () => {
    const candidates = [candidate('near-off-center', 1, 20), candidate('center', 2, 2)];

    expect(selectVRWorldPromptCandidate(
      candidates,
      headPose(),
      null,
      ['near-off-center'],
      () => true,
    )?.id).toBe('near-off-center');
    expect(selectVRWorldPromptCandidate(candidates, headPose(), null, [], () => true)?.id)
      .toBe('center');
  });

  test('preserves the current eligible candidate until a ray nominates another', () => {
    const candidates = [candidate('current', 3, 20), candidate('center', 1, 0)];

    expect(selectVRWorldPromptCandidate(candidates, headPose(), 'current', [], () => true)?.id)
      .toBe('current');
    expect(selectVRWorldPromptCandidate(
      candidates,
      headPose(),
      'current',
      ['center'],
      () => true,
    )?.id).toBe('center');
  });

  test('lets either ray nominate another eligible object while the other remains on current', () => {
    const candidates = [candidate('current', 1, 10), candidate('other', 1, -10)];

    expect(selectVRWorldPromptCandidate(
      candidates,
      headPose(),
      'current',
      ['current', 'other'],
      () => true,
    )?.id).toBe('other');
  });

  test('uses actor distance and then stable id to break equal-angle ties', () => {
    const equalAngle = [candidate('far', 2, 10), candidate('near', 1, 10)];
    expect(selectVRWorldPromptCandidate(equalAngle, headPose(), null, [], () => true)?.id)
      .toBe('near');

    const equalDistance = [candidate('z-last', 1, 10), candidate('a-first', 1, -10)];
    expect(selectVRWorldPromptCandidate(equalDistance, headPose(), null, [], () => true)?.id)
      .toBe('a-first');
  });

  test('rejects candidates outside 55 degrees, frustum, range, or with no actions', () => {
    const base = candidate('door', 1, 0);
    const behind = { ...base, position: positionAtAngle(56, 1) };

    expect(selectVRWorldPromptCandidate([behind], headPose(), null, [], () => true)).toBeNull();
    expect(selectVRWorldPromptCandidate([base], headPose(), null, [], () => false)).toBeNull();
    expect(selectVRWorldPromptCandidate([{ ...base, inRange: false }], headPose(), null, [], () => true))
      .toBeNull();
    expect(selectVRWorldPromptCandidate([{ ...base, hasActions: false }], headPose(), null, [], () => true))
      .toBeNull();
  });

  test('rejects a non-finite head pose before consulting the frustum', () => {
    const invalidPose = headPose();
    invalidPose.position.setX(Number.NaN);
    const isInFrustum = jest.fn(() => true);

    expect(() => selectVRWorldPromptCandidate(
      [candidate('door', 1, 0)],
      invalidPose,
      null,
      [],
      isInFrustum,
    )).toThrow('head pose');
    expect(isInFrustum).not.toHaveBeenCalled();
  });

  test.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects a %s candidate position before consulting the frustum', (_label, x) => {
    const invalidCandidate = {
      ...candidate('invalid', 1, 0),
      position: new THREE.Vector3(x, 1, 0),
    };
    const isInFrustum = jest.fn(() => true);

    expect(selectVRWorldPromptCandidate(
      [invalidCandidate],
      headPose(),
      null,
      [],
      isInFrustum,
    )).toBeNull();
    expect(isInFrustum).not.toHaveBeenCalled();
  });
});

describe('buildVRWorldPromptPages', () => {
  test('paginates world actions in groups of four with previous and next controls', () => {
    expect(buildVRWorldPromptPages(actions(5)).map((page) =>
      page.entries.map((entry) => entry.id)))
      .toEqual([
        ['action-0', 'action-1', 'action-2', 'action-3', 'prompt:next'],
        ['prompt:previous', 'action-4'],
      ]);
  });

  test('omits malformed and duplicate actions without invoking behavior', () => {
    const activate = jest.fn();
    const valid: VRWorldPromptAction = {
      kind: 'action',
      id: 'valid',
      label: 'Valid',
      revalidate: () => true,
      activate,
    };
    const invalid = { ...valid, id: ' ', activate: 'not callable' } as unknown as VRWorldPromptAction;

    const pages = buildVRWorldPromptPages([invalid, valid, { ...valid, label: 'Duplicate' }]);

    expect(pages.map((page) => page.entries.map((entry) => entry.id))).toEqual([['valid']]);
    expect(activate).not.toHaveBeenCalled();
  });

  test('returns no pages when no valid actions exist', () => {
    expect(buildVRWorldPromptPages([])).toEqual([]);
  });
});

describe('resolveValidVRWorldPromptPage', () => {
  test('returns the selected page only when the entire prompt structure is valid', () => {
    const model = promptModelForValidation();

    expect(resolveValidVRWorldPromptPage(model, 0)).toBe(model.pages[0]);
    expect(resolveValidVRWorldPromptPage(model, 1)).toBeNull();
    expect(resolveValidVRWorldPromptPage(model, 0.5)).toBeNull();
  });

  test.each([
    ['null pages', (model: VRWorldActionPromptModel) => ({ ...model, pages: null as unknown })],
    ['null entry', (model: VRWorldActionPromptModel) => ({
      ...model,
      pages: [{ index: 0, entries: [null as unknown] }],
    })],
    ['invalid kind', (model: VRWorldActionPromptModel) => ({
      ...model,
      pages: [{ index: 0, entries: [{
        kind: 'unsupported', id: 'use', label: 'Use', revalidate: () => true, activate: (): void => undefined,
      }] }],
    })],
    ['duplicate IDs', (model: VRWorldActionPromptModel) => ({
      ...model,
      pages: [{ index: 0, entries: [model.pages[0].entries[0], model.pages[0].entries[0]] }],
    })],
    ['empty ID', (model: VRWorldActionPromptModel) => ({
      ...model,
      pages: [{ index: 0, entries: [{
        kind: 'action', id: ' ', label: 'Use', revalidate: () => true, activate: (): void => undefined,
      }] }],
    })],
    ['empty label', (model: VRWorldActionPromptModel) => ({
      ...model,
      pages: [{ index: 0, entries: [{
        kind: 'action', id: 'use', label: ' ', revalidate: () => true, activate: (): void => undefined,
      }] }],
    })],
    ['malformed revalidate callable', (model: VRWorldActionPromptModel) => ({
      ...model,
      pages: [{ index: 0, entries: [{
        kind: 'action', id: 'use', label: 'Use', revalidate: 'invalid', activate: (): void => undefined,
      }] }],
    })],
    ['malformed activate callable', (model: VRWorldActionPromptModel) => ({
      ...model,
      pages: [{ index: 0, entries: [{
        kind: 'action', id: 'use', label: 'Use', revalidate: () => true, activate: 'invalid',
      }] }],
    })],
  ])('rejects %s without invoking prompt behavior', (_label, mutate) => {
    const model = promptModelForValidation();
    const revalidate = jest.mocked((model.pages[0].entries[0] as VRWorldPromptAction).revalidate);
    const activate = jest.mocked((model.pages[0].entries[0] as VRWorldPromptAction).activate);

    expect(resolveValidVRWorldPromptPage(mutate(model), 0)).toBeNull();
    expect(revalidate).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  test('rejects duplicate action IDs across pages while allowing canonical navigation IDs to repeat', () => {
    const promptActions = actions(9);
    const validModel = {
      id: 'door',
      name: 'Door',
      anchor: new THREE.Vector3(0, 1, 1),
      pages: buildVRWorldPromptPages(promptActions),
    };
    expect(resolveValidVRWorldPromptPage(validModel, 1)).toBe(validModel.pages[1]);
    const duplicateAction = {
      ...promptActions[4],
      id: promptActions[0].id,
    };
    const malformedModel = {
      ...validModel,
      pages: [
        validModel.pages[0],
        {
          ...validModel.pages[1],
          entries: [validModel.pages[1].entries[0], duplicateAction, validModel.pages[1].entries[2]],
        },
        validModel.pages[2],
      ],
    };

    expect(resolveValidVRWorldPromptPage(malformedModel, 1)).toBeNull();
  });
});

function candidate(id: string, actorDistanceMetres: number, angleDegrees: number): VRWorldPromptCandidate {
  return {
    id,
    name: id,
    position: positionAtAngle(angleDegrees, actorDistanceMetres),
    actorDistanceMetres,
    hasActions: true,
    inRange: true,
  };
}

function positionAtAngle(angleDegrees: number, distance: number): THREE.Vector3 {
  const radians = THREE.MathUtils.degToRad(angleDegrees);
  return new THREE.Vector3(
    Math.sin(radians) * distance,
    Math.cos(radians) * distance,
    0,
  );
}

function headPose(): XRWorldPose {
  return {
    position: new THREE.Vector3(),
    orientation: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)),
    linearVelocity: null,
    angularVelocity: null,
    trackingState: 'tracked',
  };
}

function actions(count: number): VRWorldPromptAction[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'action',
    id: `action-${index}`,
    label: `Action ${index}`,
    revalidate: () => true,
    activate: jest.fn(),
  }));
}

function promptModelForValidation(): VRWorldActionPromptModel {
  return {
    id: 'door',
    name: 'Door',
    anchor: new THREE.Vector3(0, 1, 1),
    pages: buildVRWorldPromptPages([{
      kind: 'action',
      id: 'use',
      label: 'Use',
      revalidate: jest.fn(() => true),
      activate: jest.fn(),
    }]),
  };
}
