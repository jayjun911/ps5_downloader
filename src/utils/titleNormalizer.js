/**
 * Normalizes game titles by converting to lowercase and removing all non-alphanumeric characters.
 * Example: "Black Myth: Wukong" -> "blackmythwukong"
 * 
 * @param {string} title 
 * @returns {string} normalized title
 */
function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

module.exports = {
  normalizeTitle
};
