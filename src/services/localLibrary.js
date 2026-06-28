const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const { normalizeTitle } = require('../utils/titleNormalizer');
const { getCurrentPlatform } = require('./platformConfig');
const { extractTitleId } = require('../utils/consoleClassifier');

/**
 * Loads and parses the local LaunchBox XML library for the selected platform.
 *
 * @returns {Array<{title: string, fileName: string, ppsa: string|null, lbId: string, order: number, normalizedTitle: string}>}
 */
function loadLocalLibrary() {
  const XML_PATH = path.join(__dirname, '../../data', getCurrentPlatform().xmlFile);

  if (!fs.existsSync(XML_PATH)) {
    throw new Error(`Local library file not found at ${XML_PATH}`);
  }

  const xmlData = fs.readFileSync(XML_PATH, 'utf-8');
  
  const parser = new XMLParser({
    ignoreAttributes: false,
    isArray: (name) => ['PlaylistGame', 'Game'].includes(name)
  });

  const jsonObj = parser.parse(xmlData);
  const games = [];

  const playlistGames = jsonObj.LaunchBox?.PlaylistGame || [];
  
  for (const pg of playlistGames) {
    const title = pg.GameTitle || '';
    const fileName = pg.GameFileName || '';
    // Extract the title ID (CUSA/PPSA/SLUS/...) from the filename, preferring
    // the active platform's console so PS4 games resolve their CUSA, not a
    // co-listed PS5 id.
    const idMatch = extractTitleId(fileName, { preferConsole: getCurrentPlatform().key });
    const ppsa = idMatch ? idMatch.id : null;
    const lbId = pg.LaunchBoxDbId || '';
    const order = parseInt(pg.ManualOrder, 10) || 0;

    games.push({
      title,
      fileName,
      ppsa,
      lbId,
      order,
      normalizedTitle: normalizeTitle(title)
    });
  }

  return games;
}

module.exports = {
  loadLocalLibrary
};
