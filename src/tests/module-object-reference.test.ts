import { describe, expect, test } from '@jest/globals';
import { ModuleObjectConstant } from '@/enums/module/ModuleObjectConstant';
import { ensureObjectReference } from '@/managers/object-reference/EnsureObjectReference';

interface TestObject {
  id?: number;
}

const objectWithId = (id?: number): TestObject => ({ id });

function registry(existing: TestObject[] = []) {
  const objectList = new Map<number, TestObject>();
  for (const object of existing) objectList.set(object.id!, object);
  let nextId = 1;
  return {
    objectList,
    ensure(object?: TestObject): number {
      return ensureObjectReference({
        object,
        objectList,
        nextId: () => nextId++,
        invalidId: ModuleObjectConstant.OBJECT_INVALID,
      });
    },
  };
}

describe('ensureObjectReference', () => {

  test('assigns and registers an unregistered inventory-style object', () => {
    const object = objectWithId();
    const references = registry();

    const id = references.ensure(object);

    expect(id).toBeGreaterThan(0);
    expect(references.objectList.get(id)).toBe(object);
  });

  test('preserves a valid registered identity', () => {
    const object = objectWithId(77);
    const references = registry([object]);

    expect(references.ensure(object)).toBe(77);
    expect(object.id).toBe(77);
  });

  test('allocates a new identity instead of overwriting an existing object', () => {
    const existing = objectWithId(1);
    const incoming = objectWithId(1);
    const references = registry([existing]);

    const id = references.ensure(incoming);

    expect(id).not.toBe(1);
    expect(references.objectList.get(1)).toBe(existing);
    expect(references.objectList.get(id)).toBe(incoming);
  });

  test('returns OBJECT_INVALID for a missing object', () => {
    expect(registry().ensure(undefined)).toBe(ModuleObjectConstant.OBJECT_INVALID);
  });
});
