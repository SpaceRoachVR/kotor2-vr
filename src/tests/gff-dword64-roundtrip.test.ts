import { describe, expect, test } from '@jest/globals';
import { GFFObject } from '@/resource/GFFObject';
import { GFFField } from '@/resource/GFFField';
import { GFFDataType } from '@/enums/resource/GFFDataType';

// Critic run 7: a DWORD64 set through `.value` or setValue was written as
// zero bytes, so a save's TIMESTAMP read back as 1601 and the defeat screen's
// "Load Last Saved Game" could not tell saves apart.
describe('64-bit GFF fields survive a write and read', () => {
  test('a FILETIME TIMESTAMP and the fields after it read back', () => {
    const stamp = 133_700_000_000_000_000n;
    const gff = new GFFObject();
    gff.RootNode.addField(new GFFField(GFFDataType.DWORD64, 'TIMESTAMP')).setValue(stamp);
    gff.RootNode.addField(new GFFField(GFFDataType.INT64, 'Signed')).setValue(-5);
    gff.RootNode.addField(new GFFField(GFFDataType.DWORD, 'After')).setValue(7);
    const back = new GFFObject(gff.getExportBuffer());
    expect(back.getFieldByLabel('TIMESTAMP').getValue()).toBe(stamp);
    expect(back.getFieldByLabel('After').getValue()).toBe(7);
  });
});
