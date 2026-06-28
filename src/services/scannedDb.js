const fs = require('fs');
const { platformDataPath } = require('./platformConfig');

// Per-platform set of normalized titles already visited by `scan`, e.g.
// data/scanned-ps4.json. Lets `scan --limit` advance past games it has already
// classified (including genuine PS4 ones that stay in the TBD list).
function scannedPath() {
  return platformDataPath('scanned', 'json');
}

function loadScannedSet() {
  try {
    const p = scannedPath();
    if (fs.existsSync(p)) {
      return new Set(JSON.parse(fs.readFileSync(p, 'utf-8')));
    }
  } catch (e) {
    // ignore malformed file
  }
  return new Set();
}

/**
 * Records a title as scanned (idempotent). Persisted immediately so an aborted
 * scan can resume where it left off.
 */
function markScanned(normalizedTitle) {
  const set = loadScannedSet();
  if (set.has(normalizedTitle)) return;
  set.add(normalizedTitle);
  fs.writeFileSync(scannedPath(), JSON.stringify([...set], null, 2), 'utf-8');
}

/**
 * Clears all scan-progress marks for the active platform.
 */
function clearScanned() {
  try {
    const p = scannedPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    // ignore
  }
}

module.exports = { loadScannedSet, markScanned, clearScanned };
