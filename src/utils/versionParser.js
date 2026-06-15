/**
 * Extracts version number from a filename.
 * E.g. "3D MiniGolf [PPSA03647][v01.000].rar" -> "v01.000"
 * E.g. "Black Myth - Wukong [PPSA23226][v1.10].rar" -> "v1.10"
 * 
 * @param {string} fileName 
 * @returns {string} version string (defaults to "v1.00" if not found)
 */
function extractVersion(fileName) {
  if (!fileName) return 'v1.00';
  const match = fileName.match(/\[v?([0-9.]+)\]/i);
  return match ? `v${match[1]}` : 'v1.00';
}

module.exports = {
  extractVersion
};
