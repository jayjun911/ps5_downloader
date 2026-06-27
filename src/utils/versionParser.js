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

/**
 * Derives the display version from a parsed param.json.
 *
 * PS5's `contentVersion` is the real release version, formatted "NN.NNN.NNN"
 * (e.g. "01.210.000"); `masterVersion` is just the package master and is usually
 * a flat "01.00". The trailing patch segment is dropped when it's all zeros, so
 * "01.210.000" -> "v01.210", while a non-zero patch like "01.000.004" is kept as
 * "v01.000.004". Falls back to masterVersion, then "01.00", for the rare param
 * that lacks contentVersion. (Note: `applicationVersion` is NOT a param.json
 * field — relying on it always yields the fallback.)
 *
 * @param {object} json parsed param.json
 * @returns {string} v-prefixed version, e.g. "v01.210"
 */
function deriveVersionFromParam(json) {
  const raw = (json && (json.contentVersion || json.masterVersion)) || '01.00';
  const parts = String(raw).split('.');
  if (parts.length === 3 && /^0+$/.test(parts[2])) {
    parts.pop();
  }
  return `v${parts.join('.')}`;
}

/**
 * Picks the title for filenames from a parsed param.json's localizedParameters.
 *
 * Prefers the English (en-US, then any en-*) title because it's the most
 * universally readable/searchable for filenames — many games set
 * defaultLanguage to a CJK locale (e.g. zh-Hant "暗徒誓約") while also shipping an
 * en-US title ("VARLET"). Falls back to the param's defaultLanguage, then any
 * locale that carries a title.
 *
 * @param {object} json parsed param.json
 * @returns {string} the chosen titleName, or '' if none present
 */
function deriveTitleNameFromParam(json) {
  const loc = (json && json.localizedParameters) || {};
  const enKey = loc['en-US']
    ? 'en-US'
    : Object.keys(loc).find((k) => /^en-/i.test(k) && loc[k] && loc[k].titleName);
  const pick = (enKey && loc[enKey])
    || loc[loc.defaultLanguage]
    || Object.values(loc).find((v) => v && v.titleName)
    || {};
  return (pick.titleName || '').trim();
}

module.exports = {
  extractVersion,
  deriveTitleNameFromParam,
  deriveVersionFromParam
};
