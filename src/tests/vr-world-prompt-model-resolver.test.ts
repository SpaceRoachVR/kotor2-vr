import * as THREE from 'three';
import { expect, jest, test } from '@jest/globals';
import {
  VRWorldPromptModelResolver,
} from '@/vr/runtime/VRWorldPromptModelResolver';
import { VRWorldActionPromptModel } from '@/vr/runtime/VRWorldActionPromptModel';

test('recovers from one transient construction failure after stable-frame backoff', () => {
  const logger = { error: jest.fn() };
  const resolver = new VRWorldPromptModelResolver({ retryDelayStableFrames: 2, logger });
  const model = promptModel('recovered');
  const factory = jest.fn<() => VRWorldActionPromptModel | null>()
    .mockImplementationOnce(() => { throw new Error('transient refresh'); })
    .mockReturnValue(model);
  const identity = { candidateId: 'module-object:42', openingKey: 'state:v1' };

  expect(resolver.resolve(identity, factory)).toEqual({ status: 'failed' });
  expect(resolver.resolve(identity, factory)).toEqual({ status: 'failed' });
  expect(factory).toHaveBeenCalledTimes(1);
  expect(resolver.resolve(identity, factory)).toEqual({ status: 'success', model });
  expect(factory).toHaveBeenCalledTimes(2);
  expect(logger.error).toHaveBeenCalledTimes(1);
  expect(logger.error).toHaveBeenCalledWith(
    expect.stringContaining('module-object:42'),
    expect.any(Error),
  );
});

test('caches expected empty and success but never retries a repeated failure hot', () => {
  const resolver = new VRWorldPromptModelResolver({ retryDelayStableFrames: 3, logger: { error: jest.fn() } });
  const emptyFactory = jest.fn<() => VRWorldActionPromptModel | null>(() => null);
  const emptyIdentity = { candidateId: 'module-object:1', openingKey: 'empty:v1' };
  expect(resolver.resolve(emptyIdentity, emptyFactory)).toEqual({ status: 'expected-empty' });
  expect(resolver.resolve(emptyIdentity, emptyFactory)).toEqual({ status: 'expected-empty' });
  expect(emptyFactory).toHaveBeenCalledTimes(1);

  const failure = new Error('persistent refresh failure');
  const failingFactory = jest.fn<() => VRWorldActionPromptModel | null>(() => { throw failure; });
  const failureIdentity = { candidateId: 'module-object:2', openingKey: 'failure:v1' };
  expect(resolver.resolve(failureIdentity, failingFactory)).toEqual({ status: 'failed' });
  resolver.resolve(failureIdentity, failingFactory);
  resolver.resolve(failureIdentity, failingFactory);
  expect(failingFactory).toHaveBeenCalledTimes(1);
  resolver.resolve(failureIdentity, failingFactory);
  expect(failingFactory).toHaveBeenCalledTimes(2);
  for (let frame = 0; frame < 10; frame += 1) resolver.resolve(failureIdentity, failingFactory);
  expect(failingFactory).toHaveBeenCalledTimes(2);
});

test('resets cached outcomes when lifecycle ownership is cleared', () => {
  const resolver = new VRWorldPromptModelResolver({ retryDelayStableFrames: 2 });
  const factory = jest.fn<() => VRWorldActionPromptModel | null>(() => promptModel('door'));
  const identity = { candidateId: 'module-object:3', openingKey: 'door:v1' };

  resolver.resolve(identity, factory);
  resolver.resolve(identity, factory);
  resolver.reset();
  resolver.resolve(identity, factory);

  expect(factory).toHaveBeenCalledTimes(2);
});

function promptModel(id: string): VRWorldActionPromptModel {
  return {
    id,
    name: id,
    anchor: new THREE.Vector3(),
    pages: [{
      index: 0,
      entries: [{
        kind: 'action',
        id: 'use',
        label: 'Use',
        revalidate: () => true,
        activate: () => undefined,
      }],
    }],
  };
}
