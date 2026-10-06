import { deflateSync } from 'node:zlib';

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}

/** Original geometric card symbol; no remote asset fetching or image processing dependency. */
export function walletIconPng(size = 256): Buffer {
  if (!Number.isInteger(size) || size < 16 || size > 512) throw new RangeError('Invalid icon size');
  const pixels = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = x / size;
      const sy = y / size;
      const card = sx > 0.18 && sx < 0.82 && sy > 0.29 && sy < 0.72;
      const stripe = sy > 0.39 && sy < 0.47;
      const stamp = (sx - 0.69) ** 2 + (sy - 0.60) ** 2 < 0.045 ** 2;
      const light = card && !stripe && !stamp;
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      pixels[offset] = light ? 246 : 23;
      pixels[offset + 1] = light ? 248 : 68;
      pixels[offset + 2] = light ? 236 : 54;
      pixels[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
