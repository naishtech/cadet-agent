/**
 * Test helper: build a minimal, valid ZIP in memory.
 *
 * Extracted from `sync.test.mjs` when a second suite needed it, so the two cannot
 * drift into building slightly different archives.
 */

const SIG_LFH = 0x04034b50;
const SIG_CD = 0x02014b50;
const SIG_EOCD = 0x06054b50;

export function buildMinimalZip(files) {
  // files: [{ name: string, content: Buffer | string }]
  const parts = [];
  const cdEntries = [];
  let cdOffset = 0;

  for (const { name, content } of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
    const nameBuf = Buffer.from(name, 'utf-8');

    // Local file header
    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(SIG_LFH, 0);          // signature
    lfh.writeUInt16LE(20, 4);                // version needed
    lfh.writeUInt16LE(0, 6);                 // flags
    lfh.writeUInt16LE(0, 8);                 // method (stored)
    lfh.writeUInt16LE(0, 10);                // mod time
    lfh.writeUInt16LE(0, 12);                // mod date
    lfh.writeUInt32LE(0, 14);                // crc32
    lfh.writeUInt32LE(data.length, 18);      // compressed size
    lfh.writeUInt32LE(data.length, 22);      // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26);   // filename length
    lfh.writeUInt16LE(0, 28);                // extra field length
    nameBuf.copy(lfh, 30);

    const lfhOffset = cdOffset;
    parts.push(lfh, data);
    cdOffset += lfh.length + data.length;

    // Central directory entry
    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(SIG_CD, 0);              // signature
    cd.writeUInt16LE(20, 4);                   // version made by
    cd.writeUInt16LE(20, 6);                   // version needed
    cd.writeUInt16LE(0, 8);                    // flags
    cd.writeUInt16LE(0, 10);                   // method (stored)
    cd.writeUInt16LE(0, 12);                   // mod time
    cd.writeUInt16LE(0, 14);                   // mod date
    cd.writeUInt32LE(0, 16);                   // crc32
    cd.writeUInt32LE(data.length, 20);         // compressed size
    cd.writeUInt32LE(data.length, 24);         // uncompressed size
    cd.writeUInt16LE(nameBuf.length, 28);      // filename length
    cd.writeUInt16LE(0, 30);                   // extra field length
    cd.writeUInt16LE(0, 32);                   // comment length
    cd.writeUInt16LE(0, 34);                   // disk number start
    cd.writeUInt16LE(0, 36);                   // internal attrs
    cd.writeUInt32LE(0, 38);                   // external attrs
    cd.writeUInt32LE(lfhOffset, 42);           // local header offset
    nameBuf.copy(cd, 46);

    cdEntries.push(cd);
  }

  const cdStart = cdOffset;
  for (const cd of cdEntries) {
    parts.push(cd);
    cdOffset += cd.length;
  }
  const cdSize = cdOffset - cdStart;

  // EOCD
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);             // disk number
  eocd.writeUInt16LE(0, 6);             // cd disk
  eocd.writeUInt16LE(files.length, 8);  // cd entries on disk
  eocd.writeUInt16LE(files.length, 10); // cd entries total
  eocd.writeUInt32LE(cdSize, 12);       // cd size
  eocd.writeUInt32LE(cdStart, 16);      // cd offset
  eocd.writeUInt16LE(0, 20);            // comment length

  parts.push(eocd);
  return Buffer.concat(parts);
}
