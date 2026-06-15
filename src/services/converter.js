const { execSync } = require('child_process');
const logger = require('../utils/logger');

/**
 * Converts a downloaded RAR/ZIP archive directly to .ffpfsc format using the configured converter tool.
 * 
 * @param {string} rarFilePath Path to the source archive file (input)
 * @param {string} outputFilePath Path to the target .ffpfsc file (output)
 * @param {string} password Archive password (optional)
 * @returns {Promise<void>}
 */
async function convertToFfpfsc(rarFilePath, outputFilePath, password) {
  const binaryPath = process.env.CONVERTER_PATH || 'python';
  let argsTemplate = process.env.CONVERTER_ARGS || 'cli.py {input} {output} --password {password} --overwrite';
  
  // Replace placeholders in args
  let cmdArgs = argsTemplate
    .replace('{input}', `"${rarFilePath}"`)
    .replace('{output}', `"${outputFilePath}"`);
    
  if (password) {
    cmdArgs = cmdArgs.replace('{password}', `"${password}"`);
  } else {
    // Clean up password parameter if none is provided
    cmdArgs = cmdArgs
      .replace('--password {password}', '')
      .replace('--password=""', '')
      .replace('-p {password}', '')
      .replace('-p ""', '');
  }
  
  // Clean up any double spaces caused by removing arguments
  cmdArgs = cmdArgs.replace(/\s+/g, ' ').trim();
  
  const fullCommand = `"${binaryPath}" ${cmdArgs}`;
  logger.info(`Executing conversion: ${fullCommand}`);
  
  execSync(fullCommand, { stdio: 'inherit' });
}

module.exports = {
  convertToFfpfsc
};
