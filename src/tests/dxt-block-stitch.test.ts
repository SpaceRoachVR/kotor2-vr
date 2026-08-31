import { describe, expect, test } from '@jest/globals';
import {
  DXT1_BLOCK_BYTES,
  DXT5_BLOCK_BYTES,
  compressedByteLength,
  isBlockStitchable,
  stitchCompressedFrames,
} from '@/resource/dxtBlockStitch';

/**
 * Animated Odyssey textures ship as a grid of frames the engine reassembles
 * per mipmap level. That used to run a JavaScript DXT decoder over every
 * frame and a JavaScript DXT encoder over the merged result, through an
 * OffscreenCanvas readback, synchronously on the main thread.
 *
 * DXT blocks are independent and row-major, so the atlas is a block copy.
 * These tests pin the block arithmetic, because getting it wrong produces a
 * plausible-looking image with frames in the wrong places rather than a crash.
 */
describe('DXT block-space frame stitching', () => {
  /** A frame whose every block byte encodes which frame it came from. */
  const frameOfBlocks = (marker: number, blockCount: number, blockBytes: number) =>
    new Uint8Array(blockCount * blockBytes).fill(marker);

  test('places a 2x2 grid of single-block frames in row-major order', () => {
    const frames = [1, 2, 3, 4].map((marker) => frameOfBlocks(marker, 1, DXT1_BLOCK_BYTES));

    const atlas = stitchCompressedFrames(frames, {
      frameWidth: 4,
      frameHeight: 4,
      columns: 2,
      rows: 2,
      blockBytes: DXT1_BLOCK_BYTES,
    });

    // An 8x8 atlas is a 2x2 block grid, so the blocks land in order 1,2,3,4.
    expect(atlas).toHaveLength(4 * DXT1_BLOCK_BYTES);
    const markerOfBlock = (index: number) => atlas[index * DXT1_BLOCK_BYTES];
    expect([0, 1, 2, 3].map(markerOfBlock)).toEqual([1, 2, 3, 4]);
  });

  test('interleaves block rows when frames are more than one block wide', () => {
    // Two frames side by side, each 8x8 = 2x2 blocks. The atlas is 16x8, so
    // its first block row must be [left, left, right, right] — not the whole
    // of the left frame followed by the whole of the right.
    const frames = [
      frameOfBlocks(0xa, 4, DXT1_BLOCK_BYTES),
      frameOfBlocks(0xb, 4, DXT1_BLOCK_BYTES),
    ];

    const atlas = stitchCompressedFrames(frames, {
      frameWidth: 8,
      frameHeight: 8,
      columns: 2,
      rows: 1,
      blockBytes: DXT1_BLOCK_BYTES,
    });

    const markerOfBlock = (index: number) => atlas[index * DXT1_BLOCK_BYTES];
    expect([0, 1, 2, 3].map(markerOfBlock)).toEqual([0xa, 0xa, 0xb, 0xb]);
    expect([4, 5, 6, 7].map(markerOfBlock)).toEqual([0xa, 0xa, 0xb, 0xb]);
  });

  test('preserves every source byte exactly — the copy is lossless', () => {
    const frame = new Uint8Array(DXT5_BLOCK_BYTES).map((_, index) => index * 7 % 256);
    const atlas = stitchCompressedFrames([frame], {
      frameWidth: 4,
      frameHeight: 4,
      columns: 1,
      rows: 1,
      blockBytes: DXT5_BLOCK_BYTES,
    });
    expect(Array.from(atlas)).toEqual(Array.from(frame));
  });

  test('produces exactly the compressed length the atlas dimensions imply', () => {
    const frames = Array.from({ length: 8 }, () => frameOfBlocks(1, 4, DXT5_BLOCK_BYTES));
    const atlas = stitchCompressedFrames(frames, {
      frameWidth: 8,
      frameHeight: 8,
      columns: 4,
      rows: 2,
      blockBytes: DXT5_BLOCK_BYTES,
    });
    expect(atlas).toHaveLength(compressedByteLength(32, 16, DXT5_BLOCK_BYTES));
  });

  test('recognises which mipmap levels can be stitched as blocks', () => {
    expect(isBlockStitchable(64, 64)).toBe(true);
    expect(isBlockStitchable(4, 4)).toBe(true);
    // The tail of the mipmap chain, where a frame drops below one block.
    expect(isBlockStitchable(2, 2)).toBe(false);
    expect(isBlockStitchable(1, 1)).toBe(false);
    // Non-multiples of the block size cannot be placed on block boundaries.
    expect(isBlockStitchable(6, 8)).toBe(false);
    expect(isBlockStitchable(8, 6)).toBe(false);
  });

  test('refuses a short frame rather than leaving black blocks in the atlas', () => {
    // Zero-filled tails decode to black. Silence here would look like a
    // texture bug anywhere but the place that caused it.
    expect(() => stitchCompressedFrames(
      [frameOfBlocks(1, 4, DXT1_BLOCK_BYTES), new Uint8Array(DXT1_BLOCK_BYTES)],
      { frameWidth: 8, frameHeight: 8, columns: 2, rows: 1, blockBytes: DXT1_BLOCK_BYTES },
    )).toThrow(RangeError);
  });

  test('the atlas decodes to the same pixels as decoding each frame alone', () => {
    // The property that actually matters, checked against the real decoder:
    // stitching in block space must land every frame's pixels exactly where
    // the pixel-space route put them. Block arithmetic that is off by a row
    // still produces a valid image, so only a decode comparison catches it.
    const dxtJs = require('dxt-js');
    const FRAME = 8;
    const COLUMNS = 2;
    const ROWS = 2;
    const blocksPerFrame = (FRAME / 4) * (FRAME / 4);

    let seed = 1;
    const nextByte = () => (seed = (seed * 1103515245 + 12345) % 2147483648) % 256;
    const frames = Array.from({ length: COLUMNS * ROWS }, () =>
      new Uint8Array(blocksPerFrame * DXT1_BLOCK_BYTES).map(nextByte));

    const atlas = stitchCompressedFrames(frames, {
      frameWidth: FRAME,
      frameHeight: FRAME,
      columns: COLUMNS,
      rows: ROWS,
      blockBytes: DXT1_BLOCK_BYTES,
    });

    const atlasWidth = FRAME * COLUMNS;
    const atlasPixels = dxtJs.decompress(atlas, atlasWidth, FRAME * ROWS, dxtJs.flags.DXT1);

    for(let row = 0; row < ROWS; row++){
      for(let column = 0; column < COLUMNS; column++){
        const framePixels = dxtJs.decompress(
          frames[row * COLUMNS + column], FRAME, FRAME, dxtJs.flags.DXT1,
        );
        for(let y = 0; y < FRAME; y++){
          const atlasRowStart = (((row * FRAME) + y) * atlasWidth + column * FRAME) * 4;
          expect(Array.from(atlasPixels.slice(atlasRowStart, atlasRowStart + FRAME * 4)))
            .toEqual(Array.from(framePixels.slice(y * FRAME * 4, (y + 1) * FRAME * 4)));
        }
      }
    }
  });

  test('refuses layouts it cannot represent', () => {
    const frames = [frameOfBlocks(1, 1, DXT1_BLOCK_BYTES)];
    const layout = { frameWidth: 4, frameHeight: 4, columns: 1, rows: 1, blockBytes: DXT1_BLOCK_BYTES };

    expect(() => stitchCompressedFrames(frames, { ...layout, frameWidth: 2 })).toThrow(RangeError);
    expect(() => stitchCompressedFrames(frames, { ...layout, blockBytes: 12 })).toThrow(RangeError);
    expect(() => stitchCompressedFrames(frames, { ...layout, columns: 0 })).toThrow(RangeError);
    expect(() => stitchCompressedFrames(frames, { ...layout, columns: 2 })).toThrow(RangeError);
  });
});
