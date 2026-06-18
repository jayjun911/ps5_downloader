/**
 * Normalizes game titles by converting to lowercase and removing all non-alphanumeric characters.
 * Example: "Black Myth: Wukong" -> "blackmythwukong"
 * 
 * @param {string} title 
 * @returns {string} normalized title
 */
function normalizeTitle(title) {
  if (!title) return '';
  let normalized = title.toLowerCase();
  
  // Replace standalone Roman numerals with Arabic digits
  normalized = normalized
    .replace(/\bviii\b/g, '8')
    .replace(/\bvii\b/g, '7')
    .replace(/\bvi\b/g, '6')
    .replace(/\biv\b/g, '4')
    .replace(/\bix\b/g, '9')
    .replace(/\biii\b/g, '3')
    .replace(/\bii\b/g, '2')
    .replace(/\bv\b/g, '5')
    .replace(/\bx\b/g, '10');

  return normalized
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

module.exports = {
  normalizeTitle
};
