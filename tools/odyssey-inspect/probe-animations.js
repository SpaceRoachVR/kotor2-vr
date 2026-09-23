const fs = require('fs');
const path = require('path');

const GAME_ROOT = process.env.KOTOR2_PATH || 'D:/SteamLibrary/steamapps/common/Knights of the Old Republic II';
const keyBuf = fs.readFileSync(path.join(GAME_ROOT, 'chitin.key'));
const keyCount = keyBuf.readUInt32LE(12);
const offKey = keyBuf.readUInt32LE(20);
const bifBuf = fs.readFileSync(path.join(GAME_ROOT, 'data/2da.bif'));
const vOff = bifBuf.readUInt32LE(16);

function get2da(name) {
  name = name.toLowerCase();
  for (let i = 0; i < keyCount; i++) {
    const p = offKey + i * 22;
    const resref = keyBuf.toString('latin1', p, p + 16).replace(/\0[\s\S]*$/, '');
    const resType = keyBuf.readUInt16LE(p + 16);
    const resId = keyBuf.readUInt32LE(p + 18);
    if (resType === 2017 && resref.toLowerCase() === name) {
      const resIdx = resId & 0xFFFFF;
      const bp = vOff + resIdx * 16;
      const offset = bifBuf.readUInt32LE(bp + 4);
      const size = bifBuf.readUInt32LE(bp + 8);
      return bifBuf.subarray(offset, offset + size);
    }
  }
}

function parse2da(b) {
  let pos = 9;
  let headerStr = '';
  while (pos < b.length && b[pos] !== 0) {
    headerStr += String.fromCharCode(b[pos++]);
  }
  pos++;
  const colNames = headerStr.split('\t').filter(c => c.length > 0);
  const numDataCols = colNames.length;

  const rowCount = b.readUInt32LE(pos); pos += 4;
  const rowIndexes = [];
  for (let i = 0; i < rowCount; i++) {
    let rIndex = '';
    while (pos < b.length && b[pos] !== 9) rIndex += String.fromCharCode(b[pos++]);
    pos++;
    rowIndexes.push(rIndex);
  }
  const cellCount = numDataCols * rowCount;
  const offsets = [];
  for (let i = 0; i < cellCount; i++) {
    offsets.push(b.readUInt16LE(pos)); pos += 2;
  }
  pos += 2;
  const dataOffset = pos;
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    const row = { __index: i, __rowlabel: rowIndexes[i] };
    for (let j = 0; j < numDataCols; j++) {
      const off = dataOffset + offsets[i * numDataCols + j];
      let end = off;
      while (end < b.length && b[end] !== 0) end++;
      let token = b.toString('latin1', off, end);
      if (token === '') token = '****';
      row[colNames[j]] = token;
    }
    rows.push(row);
  }
  return { cols: ['__rowlabel', ...colNames], rows };
}

const anims = parse2da(get2da('animations'));
console.log('Total animation rows:', anims.rows.length);

fs.writeFileSync(path.join(__dirname, 'animations_all.json'), JSON.stringify(anims.rows, null, 2));
console.log('Saved', anims.rows.length, 'animations to animations_all.json');
