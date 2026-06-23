const fs = require('fs');

/*
 * Minimal read-only UFS2 reader — just enough to validate a .ffpkg image and
 * pull sce_sys/param.json out of it. PS4/PS5 .ffpkg files are FreeBSD UFS2
 * filesystem images (little-endian, x86). Windows has no UFS2 driver, so we
 * parse the on-disk structures directly instead of mounting.
 *
 * On-disk facts used (FreeBSD sys/ufs/ffs/fs.h, dinode.h, dir.h):
 *   - UFS2 superblock at byte offset 65536; fs_magic (int32) at +1372 = 0x19540119
 *   - block/frag addresses ("daddr") are in fragments; byte = daddr * fs_fsize
 *   - root directory is inode 2; ufs2_dinode is 256 bytes
 */

const SBLOCK_UFS2 = 65536;
const UFS2_MAGIC = 0x19540119;
const ROOTINO = 2;
const DINODE_SIZE = 256;
const IFMT = 0xf000, IFDIR = 0x4000, IFREG = 0x8000;

function readBytes(fd, offset, length) {
  const buf = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const n = fs.readSync(fd, buf, read, length - read, offset + read);
    if (n <= 0) break;
    read += n;
  }
  return read === length ? buf : buf.subarray(0, read);
}

function readSuperblock(fd) {
  const sb = readBytes(fd, SBLOCK_UFS2, 1560);
  if (sb.length < 1376) return null;
  const magic = sb.readInt32LE(1372) >>> 0;
  if (magic !== UFS2_MAGIC) return null;
  const fs_iblkno = sb.readInt32LE(16);
  const fs_ncg    = sb.readInt32LE(44);
  const fs_bsize  = sb.readInt32LE(48);
  const fs_fsize  = sb.readInt32LE(52);
  const fs_frag   = sb.readInt32LE(56);
  // struct fs: ... fs_old_cpg@180, fs_ipg@184, fs_fpg@188
  const fs_ipg    = sb.readInt32LE(184);
  const fs_fpg    = sb.readInt32LE(188);
  // dinode is always 256 in UFS2, so derive inodes-per-block from block size.
  const inopb = Math.floor(fs_bsize / DINODE_SIZE);
  return { magic, fs_iblkno, fs_ncg, fs_bsize, fs_fsize, fs_frag, fs_ipg, fs_fpg, inopb };
}

function superblockSane(s) {
  if (!s) return 'superblock magic mismatch (not a UFS2 image)';
  if (!(s.fs_bsize > 0 && (s.fs_bsize & (s.fs_bsize - 1)) === 0)) return `bad block size ${s.fs_bsize}`;
  if (s.fs_fsize <= 0 || s.fs_bsize % s.fs_fsize !== 0) return `bad fragment size ${s.fs_fsize}`;
  if (s.fs_frag !== s.fs_bsize / s.fs_fsize) return 'frag/bsize/fsize inconsistent';
  if (s.fs_ncg < 1 || s.fs_ipg < 1 || s.fs_fpg < 1) return 'bad cylinder-group geometry';
  return null;
}

function inodeByteOffset(s, ino) {
  const cg = Math.floor(ino / s.fs_ipg);
  const inoInCg = ino % s.fs_ipg;
  const cgimin = cg * s.fs_fpg + s.fs_iblkno;                 // fragments
  const fsba = cgimin + Math.floor(inoInCg / s.inopb) * s.fs_frag; // fragments
  return fsba * s.fs_fsize + (inoInCg % s.inopb) * DINODE_SIZE;
}

function readInode(fd, s, ino) {
  const b = readBytes(fd, inodeByteOffset(s, ino), DINODE_SIZE);
  const mode = b.readUInt16LE(0);
  const size = Number(b.readBigUInt64LE(16));
  const db = [], ib = [];
  for (let i = 0; i < 12; i++) db.push(Number(b.readBigInt64LE(112 + i * 8)));
  for (let i = 0; i < 3; i++) ib.push(Number(b.readBigInt64LE(208 + i * 8)));
  return { mode, size, db, ib };
}

// Read a file inode's contents (direct + single + double indirect; param.json is
// tiny so direct blocks suffice, the rest is defensive).
function readFileData(fd, s, inode) {
  const out = Buffer.alloc(inode.size);
  let pos = 0;
  const bsize = s.fs_bsize;
  const ptrs = Math.floor(bsize / 8);
  const copyBlock = (frag) => {
    const len = Math.min(bsize, inode.size - pos);
    if (frag !== 0) readBytes(fd, frag * s.fs_fsize, len).copy(out, pos); // frag 0 = hole (zeros)
    pos += len;
  };
  for (let i = 0; i < 12 && pos < inode.size; i++) copyBlock(inode.db[i]);
  const readIndirect = (frag, depth) => {
    if (pos >= inode.size || !frag) return;
    const tbl = readBytes(fd, frag * s.fs_fsize, bsize);
    for (let j = 0; j < ptrs && pos < inode.size; j++) {
      const ptr = Number(tbl.readBigInt64LE(j * 8));
      if (depth === 1) copyBlock(ptr); else readIndirect(ptr, depth - 1);
    }
  };
  readIndirect(inode.ib[0], 1);
  readIndirect(inode.ib[1], 2);
  return out;
}

function listDir(fd, s, inode) {
  const data = readFileData(fd, s, inode);
  const entries = [];
  let off = 0;
  while (off + 8 <= data.length) {
    const d_ino = data.readUInt32LE(off);
    const d_reclen = data.readUInt16LE(off + 4);
    if (d_reclen < 8) break;
    const d_namlen = data.readUInt8(off + 7);
    if (d_ino !== 0 && d_namlen > 0 && off + 8 + d_namlen <= data.length) {
      entries.push({ ino: d_ino, name: data.toString('latin1', off + 8, off + 8 + d_namlen) });
    }
    off += d_reclen;
  }
  return entries;
}

function lookup(fd, s, dirIno, name) {
  const inode = readInode(fd, s, dirIno);
  if ((inode.mode & IFMT) !== IFDIR) return null;
  const hit = listDir(fd, s, inode).find((e) => e.name === name);
  return hit ? hit.ino : null;
}

function extractMeta(json) {
  const loc = json.localizedParameters || {};
  const defLang = loc.defaultLanguage || 'en-US';
  const locale = loc[defLang] || loc['en-US'] || Object.values(loc).find((v) => v && v.titleName) || {};
  return {
    titleId: (json.titleId || '').trim(),
    titleName: (locale.titleName || '').trim(),
    version: json.applicationVersion ? `v${json.applicationVersion}` : 'v01.00',
  };
}

/**
 * Validate a .ffpkg (UFS2 image) and extract game metadata from sce_sys/param.json.
 * Returns { valid, metadata, message }.
 *   metadata: { titleId, titleName, version } or null.
 * Read-only; never mounts or writes anything.
 */
function readFfpkgParam(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch (e) {
    return { valid: false, metadata: null, message: `cannot open file: ${e.message}` };
  }
  try {
    const s = readSuperblock(fd);
    const bad = superblockSane(s);
    if (bad) return { valid: false, metadata: null, message: bad };

    const sceIno = lookup(fd, s, ROOTINO, 'sce_sys');
    if (!sceIno) return { valid: false, metadata: null, message: 'sce_sys directory not found' };
    const paramIno = lookup(fd, s, sceIno, 'param.json');
    if (!paramIno) return { valid: false, metadata: null, message: 'sce_sys/param.json not found' };

    const pInode = readInode(fd, s, paramIno);
    if ((pInode.mode & IFMT) !== IFREG) return { valid: false, metadata: null, message: 'param.json is not a regular file' };
    if (pInode.size <= 0 || pInode.size > 8 * 1024 * 1024) return { valid: false, metadata: null, message: `param.json size implausible (${pInode.size})` };

    const json = JSON.parse(readFileData(fd, s, pInode).toString('utf-8'));
    return { valid: true, metadata: extractMeta(json), message: 'UFS2 valid; param.json parsed' };
  } catch (e) {
    return { valid: false, metadata: null, message: `UFS2 parse error: ${e.message}` };
  } finally {
    try { fs.closeSync(fd); } catch (e) {}
  }
}

module.exports = { readFfpkgParam };

if (require.main === module) {
  console.log(JSON.stringify(readFfpkgParam(process.argv[2]), null, 2));
}
