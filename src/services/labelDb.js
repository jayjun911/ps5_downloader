const fs = require('fs');
const path = require('path');
const { platformDataPath } = require('./platformConfig');
const { normalizeTitle } = require('../utils/titleNormalizer');

// Per-platform console-label store, e.g. data/labels-ps4.json
// Records entries in the active platform's list that actually belong to another
// console (PS1/PS2 emulation packages), as detected during download.
function labelFile() {
  return platformDataPath('labels', 'json');
}

function ensureDirectoryExistence(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Loads all labels for the active platform.
 * @returns {Array<{title: string, normalizedTitle: string, console: string, gameId: string, detectedAt: string}>}
 */
function loadLabels() {
  const file = labelFile();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) || [];
  } catch (err) {
    return [];
  }
}

function saveLabels(labels) {
  const file = labelFile();
  ensureDirectoryExistence(file);
  fs.writeFileSync(file, JSON.stringify(labels, null, 2), 'utf-8');
}

/**
 * Returns a Map of normalizedTitle -> label entry.
 */
function loadLabelMap() {
  return new Map(loadLabels().map(l => [l.normalizedTitle, l]));
}

/**
 * Looks up a label by normalized title.
 */
function getLabel(normalizedTitle) {
  return loadLabels().find(l => l.normalizedTitle === normalizedTitle) || null;
}

/**
 * Upserts a console label for a title. Returns the stored entry.
 */
function setLabel(title, consoleKey, gameId) {
  const labels = loadLabels();
  const normalized = normalizeTitle(title);
  const existing = labels.find(l => l.normalizedTitle === normalized);
  if (existing) {
    existing.title = title;
    existing.console = consoleKey;
    existing.gameId = gameId || existing.gameId;
    existing.detectedAt = new Date().toISOString();
  } else {
    labels.push({
      title,
      normalizedTitle: normalized,
      console: consoleKey,
      gameId: gameId || '',
      detectedAt: new Date().toISOString(),
    });
  }
  saveLabels(labels);
  return existing || labels[labels.length - 1];
}

/**
 * Removes a label by title. Returns true if removed.
 */
function removeLabel(title) {
  const labels = loadLabels();
  const normalized = normalizeTitle(title);
  const filtered = labels.filter(l => l.normalizedTitle !== normalized);
  if (filtered.length === labels.length) return false;
  saveLabels(filtered);
  return true;
}

module.exports = {
  loadLabels,
  loadLabelMap,
  getLabel,
  setLabel,
  removeLabel,
};
