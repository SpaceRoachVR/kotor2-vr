/**
 * GLOBALVARS.res packs global booleans eight to a byte, MOST significant bit
 * first: boolean 0 is bit 7 of byte 0. Measured on a retail TSL save (March
 * 2026, 106PER): read MSB-first it holds 101PER_KREIA_STUNT; read LSB-first it
 * claims 220TEL_Battle_Over, which no Peragus save can have.
 *
 * The writer used to pack LSB-first while the reader unpacked MSB-first, so
 * every engine save scrambled its booleans within each byte on reload (301NAR's
 * 301_FIRST_ENTER read back false and the arrival script sent the party home).
 */
export function globalBooleanByteLength(count: number): number {
  return Math.ceil(count / 8);
}

export function packGlobalBoolean(bytes: Uint8Array, index: number, value: boolean): void {
  if(value) bytes[index >> 3] |= 0x80 >> (index & 7);
}

export function unpackGlobalBoolean(bytes: Uint8Array, index: number): boolean {
  return !!((bytes[index >> 3] >> (7 - (index & 7))) & 1);
}
