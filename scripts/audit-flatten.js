#!/usr/bin/env node
'use strict';

/*
 * audit-flatten.js — read-only forensic audit for flatten-bug damage.
 *
 * The old flattenFolderToEboot logic (introduced this June) could delete the
 * decrypted/ payload when an app0 folder held both encrypted top-level files and
 * a decrypted/ subfolder of the same names. This script surveys archives and
 * flags GAME files whose decrypted eboot appears to be gone.
 *
 * It NEVER fully extracts an archive: it lists entries, locates the shallowest
 * eboot.bin, and extracts ONLY that single file to read its 4-byte magic.
 *
 * Usage:
 *   node scripts/audit-flatten.js [rootDir] [reportPath] [--all] [--year=2026] [--limit=N]
 *     rootDir     default H:\ps5
 *     reportPath  default ./flatten-audit-report.txt
 *     --all       ignore the May–June date filter (scan everything)
 *     --year=YYYY year for the May–June filter (default 2026)
 *     --limit=N   stop after N in-scope archives (trial run)
 *
 * Classification (GAME files only; DLC/BACKPORT excluded by name):
 *   PASS  .exfat inside                          (exFAT pipeline, never flattened)
 *   PASS  shallowest eboot.bin is decrypted      (\x7fELF magic)
 *   PASS  a .../decrypted/eboot.bin entry exists (decrypted payload survived)
 *   FAIL  encrypted top eboot, no decrypted      (likely flatten victim)
 *   FAIL  eboot present but unreadable           (needs manual review)
 *   SKIP  no eboot.bin and no .exfat             (not a game executable archive)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const BZ = 'C:\\Program Files\\Bandizip\\bz.exe';
const PASSWORD_FALLBACKS = ['', 'www.DLPSGAME.COM', 'DLPSGAME.COM', 'www.dlpsgame.com', 'dlpsgame.com'];
// bz l rows: "YYYY-MM-DD HH:MM:SS Attr Size CompSize Name"
const ROW_RE = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+\d+\s+\d+\s+(.+)$/;
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);   // \x7fELF      -> decrypted (fself)
// Encrypted SELF magics (header continues 00 01 01 12 ...). Two variants seen
// in the wild: the classic PS4/PS5 magic and a second one common to PS5 rips.
const SELF_MAGICS = [
  Buffer.from([0x4f, 0x15, 0x3d, 0x1d]),
  Buffer.from([0x54, 0x14, 0xf5, 0xee]),
];

// ── args ────────────────────────────────────────────────────────────────────
const positional = [];
let scanAll = false, year = 2026, limit = Infinity;
for (const a of process.argv.slice(2)) {
  if (a === '--all') scanAll = true;
  else if (a.startsWith('--year=')) year = parseInt(a.slice(7), 10);
  else if (a.startsWith('--limit=')) limit = parseInt(a.slice(8), 10);
  else positional.push(a);
}
const ROOT = positional[0] || 'H:\\ps5';
const REPORT = positional[1] || path.join(process.cwd(), 'flatten-audit-report.txt');

if (!fs.existsSync(BZ)) { console.error(`bz.exe not found at: ${BZ}`); process.exit(1); }
if (!fs.existsSync(ROOT)) { console.error(`Scan root not found: ${ROOT}`); process.exit(1); }

// ── helpers ──────────────────────────────────────────────────────────────────
const norm = (p) => p.replace(/\\/g, '/');
const depth = (p) => norm(p).split('/').filter(Boolean).length;

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// Keep only first-volume archives; skip secondary multipart .rar volumes.
function isScannableArchive(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith('.7z')) return true;
  if (lower.endsWith('.rar')) {
    const m = lower.match(/\.part(\d+)\.rar$/);
    if (m) return parseInt(m[1], 10) === 1; // only .part1/.part01
    return true; // plain .rar
  }
  return false;
}

// GAME scope: exclude DLC and BACKPORT by name.
function archiveType(name) {
  const n = name.toLowerCase();
  if (/\[backport\]/.test(n) || /backport/.test(n)) return 'BACKPORT';
  if (/\[dlc\]/.test(n) || /[-_ (]dlc[-_ )]/.test(n)) return 'DLC';
  if (/\[update\]/.test(n)) return 'UPDATE';
  return 'GAME';
}

function inDateRange(file) {
  if (scanAll) return true;
  let st; try { st = fs.statSync(file); } catch (e) { return false; }
  const t = st.birthtimeMs && st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
  const d = new Date(t);
  return d.getFullYear() === year && (d.getMonth() === 4 || d.getMonth() === 5); // May=4, Jun=5
}

function listEntries(file) {
  for (const pwd of PASSWORD_FALLBACKS) {
    const flag = pwd ? `-p:${pwd}` : '';
    try {
      // NOTE: do not collapse whitespace in the command — entry names/paths can
      // contain runs of consecutive spaces (e.g. "Alan Wake 2     PPSA..."), and
      // squashing them makes bz fail to match the file.
      const out = execSync(`"${BZ}" l -y ${flag} "${file}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 128 * 1024 * 1024 });
      const entries = [];
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(ROW_RE);
        if (m) entries.push(m[1].trim());
      }
      if (entries.length) return entries;
    } catch (e) { /* try next password */ }
  }
  return null;
}

// Extract ONLY the given inner file and return its first 4 bytes (or null).
function readInnerMagic(file, innerPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ebaudit-'));
  try {
    for (const pwd of PASSWORD_FALLBACKS) {
      const flag = pwd ? `-p:${pwd}` : '';
      try {
        execSync(`"${BZ}" e -y ${flag} -o:"${tmp}" "${file}" "${innerPath}"`,
          { stdio: 'ignore' });
      } catch (e) { /* extraction may still have produced the file; check below */ }
      const out = path.join(tmp, path.basename(norm(innerPath)));
      if (fs.existsSync(out) && fs.statSync(out).size >= 4) {
        const fd = fs.openSync(out, 'r');
        const buf = Buffer.alloc(4);
        try { fs.readSync(fd, buf, 0, 4, 0); } finally { fs.closeSync(fd); }
        return buf;
      }
      try { fs.rmSync(out, { force: true }); } catch (e) {}
    }
    return null;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
}

function magicLabel(buf) {
  if (!buf) return 'UNREADABLE';
  if (buf.equals(ELF_MAGIC)) return 'DECRYPTED';
  if (SELF_MAGICS.some((m) => buf.equals(m))) return 'ENCRYPTED';
  if (buf.slice(0, 3).toString('latin1') === 'SCE') return 'ENCRYPTED';
  return `UNKNOWN(${[...buf].map((b) => b.toString(16).padStart(2, '0')).join(' ')})`;
}

// ── main ─────────────────────────────────────────────────────────────────────
console.log(`Scanning: ${ROOT}`);
console.log(`Filter:   ${scanAll ? 'ALL dates' : `created in May–Jun ${year}`}`);
console.log('');

const allArchives = walk(ROOT).filter(isScannableArchive);
const results = [];
const counts = { PASS: 0, FAIL: 0, UNREADABLE: 0, SKIP: 0, excluded: 0, outOfRange: 0 };
let processed = 0;

for (const file of allArchives) {
  const base = path.basename(file);
  const type = archiveType(base);
  if (type === 'DLC' || type === 'BACKPORT') { counts.excluded++; continue; }
  if (!inDateRange(file)) { counts.outOfRange++; continue; }
  if (processed >= limit) break;
  processed++;

  const rel = path.relative(ROOT, file);
  process.stdout.write(`[${processed}] ${rel} ... `);

  const entries = listEntries(file);
  if (!entries) {
    results.push({ result: 'UNREADABLE', rel, reason: 'could not list archive (encrypted/corrupt?)' });
    counts.UNREADABLE++; console.log('UNREADABLE (list)'); continue;
  }

  const hasExfat = entries.some((e) => norm(e).toLowerCase().endsWith('.exfat'));
  if (hasExfat) {
    results.push({ result: 'PASS', rel, reason: 'contains .exfat (exFAT pipeline)' });
    counts.PASS++; console.log('PASS (exfat)'); continue;
  }

  // A decrypted eboot may live as eboot.bin (ELF) OR as a decrypted backup
  // eboot.bin.esbak (fself-patched games keep the decrypted original there while
  // eboot.bin is the re-signed encrypted SELF). Any ELF copy means the decrypted
  // payload survived.
  const candidates = entries.filter((e) => /(^|\/)eboot\.bin(\.esbak)?$/i.test(norm(e)));
  if (candidates.length === 0) {
    results.push({ result: 'SKIP', rel, reason: 'no eboot.bin/.esbak and no .exfat (not a game executable)' });
    counts.SKIP++; console.log('SKIP (no eboot)'); continue;
  }

  // Check magic in priority order; .esbak and decrypted/ paths are the likely
  // decrypted copies, so try them first and stop at the first ELF found.
  const isEsbak = (e) => /\.esbak$/i.test(e);
  const inDecrypted = (e) => /(^|\/)decrypted\/eboot\.bin$/i.test(norm(e));
  const byDepth = (a, b) => depth(a) - depth(b);
  const priority = [
    ...candidates.filter(isEsbak).sort(byDepth),
    ...candidates.filter((e) => !isEsbak(e) && inDecrypted(e)).sort(byDepth),
    ...candidates.filter((e) => !isEsbak(e) && !inDecrypted(e)).sort(byDepth),
  ];

  let decryptedAt = null, anyReadable = false, lastMagic = 'NONE';
  for (const inner of priority) {
    const m = magicLabel(readInnerMagic(file, inner));
    if (m !== 'UNREADABLE') anyReadable = true;
    lastMagic = m;
    if (m === 'DECRYPTED') { decryptedAt = inner; break; }
  }

  if (decryptedAt) {
    results.push({ result: 'PASS', rel, reason: `decrypted eboot present: ${norm(decryptedAt)}` });
    counts.PASS++; console.log('PASS (decrypted)');
  } else if (!anyReadable) {
    results.push({ result: 'UNREADABLE', rel, reason: `eboot present but unreadable (${candidates.length} candidate(s); encrypted archive / extract failed)` });
    counts.UNREADABLE++; console.log('UNREADABLE (extract)');
  } else {
    results.push({ result: 'FAIL', rel, reason: `no decrypted eboot (${priority.length} candidate(s), all encrypted/unknown; last ${lastMagic})` });
    counts.FAIL++; console.log('FAIL (no decrypted)');
  }
}

// ── report ────────────────────────────────────────────────────────────────────
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
const order = { FAIL: 0, UNREADABLE: 1, SKIP: 2, PASS: 3 };
results.sort((a, b) => (order[a.result] - order[b.result]) || a.rel.localeCompare(b.rel));

const lines = [];
lines.push(`Flatten-bug audit — ${new Date().toISOString()}`);
lines.push(`Root: ${ROOT}`);
lines.push(`Date filter: ${scanAll ? 'ALL' : `May–Jun ${year}`}`);
lines.push('');
lines.push(`Scanned (GAME, in-range): ${processed}`);
lines.push(`  PASS: ${counts.PASS}   FAIL: ${counts.FAIL}   UNREADABLE: ${counts.UNREADABLE}   SKIP: ${counts.SKIP}`);
lines.push(`Excluded (DLC/BACKPORT): ${counts.excluded}   Out of date range: ${counts.outOfRange}`);
lines.push('');
lines.push(`${pad('RESULT', 10)}  ${pad('FILE', 80)}  REASON`);
lines.push('-'.repeat(120));
for (const r of results) lines.push(`${pad(r.result, 10)}  ${pad(r.rel, 80)}  ${r.reason}`);
lines.push('');

fs.writeFileSync(REPORT, lines.join('\r\n'), 'utf-8');

console.log('');
console.log(`PASS ${counts.PASS}  FAIL ${counts.FAIL}  UNREADABLE ${counts.UNREADABLE}  SKIP ${counts.SKIP}  (excluded ${counts.excluded}, out-of-range ${counts.outOfRange})`);
console.log(`Report written: ${REPORT}`);
