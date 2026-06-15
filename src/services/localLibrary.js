const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const { extractPPSA } = require('../utils/ppsaParser');
const { normalizeTitle } = require('../utils/titleNormalizer');

const XML_PATH = path.join(__dirname, '../../data/PS5.xml');

/**
 * Loads and parses the local PS5 LaunchBox XML library.
 * 
 * @returns {Array<{title: string, fileName: string, ppsa: string|null, lbId: string, order: number, normalizedTitle: string}>}
 */
function loadLocalLibrary() {
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
    const ppsa = extractPPSA(fileName);
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
