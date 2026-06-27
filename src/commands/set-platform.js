const chalk = require('chalk');
const logger = require('../utils/logger');
const {
  getCurrentPlatformKey,
  getCurrentPlatform,
  setCurrentPlatform,
  listPlatforms,
} = require('../services/platformConfig');

/**
 * Prints all supported platforms, marking the active one.
 */
function printPlatforms(currentKey) {
  console.log(chalk.cyan('\nAvailable platforms:'));
  for (const p of listPlatforms()) {
    const isCurrent = p.key === currentKey;
    const marker = isCurrent ? chalk.green('●') : ' ';
    const host = p.host.replace(/^https?:\/\//, '');
    console.log(`  ${marker} ${chalk.bold(p.key.padEnd(10))} ${p.label.padEnd(18)} ${chalk.gray(host)}`);
  }
}

/**
 * Handles the 'set-platform' CLI command.
 * With no argument, shows the current platform and the available list.
 * With an argument, sets it as the default platform.
 */
function setPlatformCommand(platformKey) {
  const currentKey = getCurrentPlatformKey();

  if (!platformKey) {
    const current = getCurrentPlatform();
    logger.info(`Current platform: ${chalk.bold(current.key)} (${current.label}) — source: ${current.host}`);
    printPlatforms(currentKey);
    console.log(chalk.gray('\nUsage: dlps set-platform <platform>   e.g. dlps set-platform ps4'));
    return;
  }

  try {
    const p = setCurrentPlatform(platformKey);
    logger.success(`Default platform set to ${chalk.bold(p.key)} (${p.label}) — source: ${p.host}`);
  } catch (err) {
    logger.error(err.message);
    printPlatforms(currentKey);
  }
}

module.exports = setPlatformCommand;
