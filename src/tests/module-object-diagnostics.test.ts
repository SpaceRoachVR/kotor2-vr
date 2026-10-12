import { describe, expect, test } from '@jest/globals';
import { describeModuleObject } from '@/utility/ModuleObjectDiagnostics';

describe('module lifecycle diagnostics', () => {
  test('reports primitive identity without returning a reference to the engine object', () => {
    expect(describeModuleObject({ getTemplateResRef: () => 'p_t3m4', getTag: () => 'T3M4', id: 208, objectType: 9 }))
      .toBe('found=true ResRef=p_t3m4 Tag=T3M4 ID=208 Type=9');
  });
  test('states explicitly when the object was not found', () => {
    expect(describeModuleObject(undefined)).toContain('found=false');
    expect(describeModuleObject(null)).toContain('found=false');
  });
  test('does not interrupt teardown when a partially constructed room has no template', () => {
    expect(describeModuleObject({ getTemplateResRef: () => { throw new Error('no template'); },
      getTag: () => 'room', id: 0, objectType: 32 }))
      .toBe('found=true ResRef=unknown Tag=room ID=0 Type=32');
  });
});
