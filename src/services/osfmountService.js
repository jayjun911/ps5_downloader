const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

function getOsfMountPath() {
  return process.env.OSFMOUNT_PATH || 'C:\\Program Files\\OSFMount\\OSFMount.exe';
}

function findFreeDriveLetter() {
  try {
    const output = execSync('wmic logicaldisk get caption', {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore']
    });
    const used = new Set((output.match(/[A-Z]:/g) || []).map(s => s.toUpperCase()));
    // Search from V: downward to avoid conflicting with common drive letters
    for (let c = 'V'.charCodeAt(0); c >= 'D'.charCodeAt(0); c--) {
      const letter = String.fromCharCode(c) + ':';
      if (!used.has(letter)) return letter;
    }
  } catch (e) { /* fall through */ }
  throw new Error('No free drive letter available for OSFMount');
}

function parseUnitNumber(output) {
  // "Virtual disk #0", "disk #0", "unit 0", "Unit: 0"
  let m = output.match(/(?:virtual\s+disk\s+|disk\s+|unit[:\s]+)#?(\d+)/i);
  if (m) return parseInt(m[1], 10);
  m = output.match(/#(\d+)/);
  if (m) return parseInt(m[1], 10);
  return null;
}

function getUnitByFile(osfPath, exfatFilePath) {
  try {
    const listOutput = execSync(`"${osfPath}" -l`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore']
    });
    const needle = path.basename(exfatFilePath).toLowerCase();
    for (const line of listOutput.split(/\r?\n/)) {
      if (line.toLowerCase().includes(needle)) {
        const m = line.match(/\b(\d+)\b/);
        if (m) return parseInt(m[1], 10);
      }
    }
  } catch (e) { /* unable to list */ }
  return null;
}

function dismount(osfPath, unitNumber) {
  try {
    execSync(`"${osfPath}" -d -u ${unitNumber}`, {
      stdio: ['pipe', 'pipe', 'ignore'], timeout: 15000
    });
    logger.info(`OSFMount: dismounted unit ${unitNumber}`);
  } catch (e) {
    logger.warn(`OSFMount dismount (unit ${unitNumber}) failed: ${e.message}`);
  }
}

/**
 * Mounts an exFAT disk image read-only via OSFMount, runs chkdsk for filesystem
 * validation, then dismounts. Returns { valid, message, skipped }.
 *
 * Skips silently (valid:true, skipped:true) when OSFMount is not installed.
 * Throws when OSFMount is present but mounting itself fails.
 */
async function validateExfat(exfatFilePath, onStatus) {
  const osfPath = getOsfMountPath();

  if (!fs.existsSync(osfPath)) {
    logger.warn(`OSFMount not found at: ${osfPath} — skipping exFAT validation.`);
    return { valid: true, skipped: true };
  }

  let driveLetter;
  try {
    driveLetter = findFreeDriveLetter();
  } catch (e) {
    logger.warn(`Cannot allocate drive letter for OSFMount: ${e.message} — skipping validation.`);
    return { valid: true, skipped: true };
  }

  if (onStatus) onStatus(`Mounting exFAT at ${driveLetter} (read-only)...`);

  let mountOutput = '';
  try {
    mountOutput = execSync(
      `"${osfPath}" -a -t file -f "${exfatFilePath}" -d ${driveLetter} -o ro`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }
    );
  } catch (err) {
    const errOut = (err.stdout || '') + (err.stderr || '');
    throw new Error(`OSFMount mount failed: ${errOut.trim() || err.message}`);
  }

  let unitNumber = parseUnitNumber(mountOutput);
  if (unitNumber === null) unitNumber = getUnitByFile(osfPath, exfatFilePath);
  if (unitNumber === null) unitNumber = 0;

  // Give Windows time to register the new volume
  await new Promise(r => setTimeout(r, 2000));

  if (onStatus) onStatus(`Running chkdsk ${driveLetter}...`);

  let valid = false;
  let message = '';

  try {
    const chkOut = execSync(`chkdsk ${driveLetter}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000
    });
    message = chkOut.trim();
    const lower = message.toLowerCase();
    valid = !lower.includes('found errors') &&
            !lower.includes('found problems') &&
            !lower.includes('corrupt') &&
            !lower.includes('unrecoverable');
  } catch (chkErr) {
    message = ((chkErr.stdout || '') + (chkErr.stderr || '')).trim() || chkErr.message;
    const exitCode = chkErr.status;
    // exit 0 = clean, exit 2 = disk cleanup (minor, still usable), exit 3 = unrecoverable
    valid = exitCode === 0 || exitCode === 2;
    if (exitCode === 3) valid = false;
    const lower = message.toLowerCase();
    if (lower.includes('unrecoverable') || lower.includes('found errors')) valid = false;
  }

  dismount(osfPath, unitNumber);

  // Return last few lines of chkdsk output as summary
  const summary = message.split(/\r?\n/).filter(l => l.trim()).slice(-4).join(' | ');
  return { valid, message: summary };
}

module.exports = { validateExfat };
