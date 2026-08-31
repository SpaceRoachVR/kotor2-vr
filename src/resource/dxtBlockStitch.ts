/**
 * Composites S3TC-compressed frames into one atlas without decoding them.
 *
 * Animated Odyssey textures (`procedureType 1`) ship as a grid of frames that
 * the engine reassembles into a single image per mipmap level. The original
 * route did that in pixel space: decompress every frame with a JavaScript DXT
 * decoder, stitch through an `OffscreenCanvas`, read the pixels back, and
 * re-encode the merged image with a JavaScript DXT *encoder* — per mipmap
 * level, per texture, synchronously on the main thread.
 *
 * None of that is necessary. DXT stores independent 4x4 blocks in row-major
 * order, so an atlas is a block-grid copy: the bytes of a frame's block row go
 * into the destination unchanged. That removes the decoder, the encoder, the
 * canvas and its readback, and it is also lossless — the old route re-quantised
 * every animated texture through a second encode.
 *
 * The one thing block copying cannot do is composite frames smaller than a
 * block, or frames whose dimensions are not block-aligned. Callers must check
 * {@link isBlockStitchable} and keep a pixel-space route for the tail mipmap
 * levels where frames fall below 4x4.
 *
 * @file dxtBlockStitch.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */

/** Bytes per 4x4 block: DXT1 stores colour only, DXT5 adds an alpha block. */
export const DXT1_BLOCK_BYTES = 8;
export const DXT5_BLOCK_BYTES = 16;

const BLOCK_SIZE = 4;

export interface DxtStitchLayout {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly columns: number;
  readonly rows: number;
  readonly blockBytes: number;
}

/**
 * Whether a frame of this size can be composited as whole blocks.
 *
 * False once a mipmap level shrinks a frame below one block, which is where
 * the block grid stops describing the image.
 */
export function isBlockStitchable(frameWidth: number, frameHeight: number): boolean {
  return Number.isInteger(frameWidth) && Number.isInteger(frameHeight) &&
    frameWidth >= BLOCK_SIZE && frameHeight >= BLOCK_SIZE &&
    frameWidth % BLOCK_SIZE === 0 && frameHeight % BLOCK_SIZE === 0;
}

/** Compressed byte length of a block-aligned image. */
export function compressedByteLength(width: number, height: number, blockBytes: number): number {
  return (width / BLOCK_SIZE) * (height / BLOCK_SIZE) * blockBytes;
}

/**
 * Copies each frame's blocks into its place in the atlas.
 *
 * Frames are in row-major order: index `row * columns + column`.
 */
export function stitchCompressedFrames(
  frames: readonly Uint8Array[],
  layout: DxtStitchLayout,
): Uint8Array {
  const { frameWidth, frameHeight, columns, rows, blockBytes } = layout;
  if (!isBlockStitchable(frameWidth, frameHeight)) {
    throw new RangeError(`Frame ${frameWidth}x${frameHeight} is not block-aligned`);
  }
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new RangeError('Frame grid must have at least one row and column');
  }
  if (blockBytes !== DXT1_BLOCK_BYTES && blockBytes !== DXT5_BLOCK_BYTES) {
    throw new RangeError(`Unsupported block size ${blockBytes}`);
  }
  if (frames.length !== columns * rows) {
    throw new RangeError(`Expected ${columns * rows} frames, received ${frames.length}`);
  }

  const frameBlocksPerRow = frameWidth / BLOCK_SIZE;
  const frameBlockRows = frameHeight / BLOCK_SIZE;
  const frameByteLength = frameBlocksPerRow * frameBlockRows * blockBytes;
  const destinationBlocksPerRow = frameBlocksPerRow * columns;
  const rowByteLength = frameBlocksPerRow * blockBytes;

  const atlas = new Uint8Array(destinationBlocksPerRow * frameBlockRows * rows * blockBytes);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const frame = frames[row * columns + column];
      // A short frame would otherwise copy silently and leave the tail of the
      // atlas as zeroes, which decodes to black blocks rather than an error.
      if (!frame || frame.length < frameByteLength) {
        throw new RangeError(
          `Frame ${row * columns + column} holds ${frame ? frame.length : 0} bytes, needs ${frameByteLength}`
        );
      }
      for (let blockRow = 0; blockRow < frameBlockRows; blockRow++) {
        // One block row of a frame is contiguous in both source and
        // destination, so the whole row moves in a single copy.
        const sourceOffset = blockRow * rowByteLength;
        const destinationBlock =
          (row * frameBlockRows + blockRow) * destinationBlocksPerRow + column * frameBlocksPerRow;
        atlas.set(
          frame.subarray(sourceOffset, sourceOffset + rowByteLength),
          destinationBlock * blockBytes,
        );
      }
    }
  }
  return atlas;
}
