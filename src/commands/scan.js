const ora = require('ora');
const chalk = require('chalk');
const { getWebGameList, findGameInWebList, getGameSubpageData } = require('../services/webScraper');
const { getCurrentPlatformKey } = require('../services/platformConfig');
const { classifyId, consoleLabel } = require('../utils/consoleClassifier');
const { setLabel, removeLabel, getLabel } = require('../services/labelDb');
const logger = require('../utils/logger');

/**
 * Handles the 'scan' CLI command (PS4 only).
 *
 * Visits the subpages of all games matching `query` (or the whole PS4 list when
 * omitted), classifies their game IDs, and records a PS1/PS2 label for any
 * entry that isn't a native PS4 title — without downloading anything.
 */
async function scanCommand(query, options = {}) {
  const active = getCurrentPlatformKey();
  if (active !== 'ps4') {
    logger.error(`'scan' is only available on the PS4 platform (current: ${active}).`);
    logger.info('Switch with: dlps set-platform ps4');
    return;
  }

  let games;
  try {
    if (query) {
      games = await findGameInWebList(query);
      if (games.length === 0) {
        logger.warn(`No games found matching: "${query}"`);
        return;
      }
    } else {
      games = await getWebGameList(!!options.refresh);
    }
  } catch (err) {
    logger.error('Failed to load the game list.', err);
    return;
  }

  logger.info(`Scanning ${games.length} game(s) for non-PS4 (PS1/PS2) titles...`);

  let labeled = 0;
  let ps4Count = 0;
  let noId = 0;
  let failed = 0;

  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const spinner = ora(`[${i + 1}/${games.length}] ${g.title}`).start();
    try {
      const sections = await getGameSubpageData(g.slug, g.url, !!options.refresh);
      const detected = sections.map(s => classifyId(s.ppsa)).filter(Boolean);
      const hasPs4 = detected.some(d => d.console === 'ps4');

      if (!hasPs4 && detected.length > 0) {
        const other = detected[0];
        const idSection = sections.find(s => {
          const c = classifyId(s.ppsa);
          return c && c.console === other.console;
        });
        setLabel(g.title, other.console, idSection ? idSection.ppsa : '');
        labeled++;
        spinner.succeed(
          `${g.title} → ${chalk.cyan(`[${consoleLabel(other.console)}]`)}` +
          `${idSection ? ` ${chalk.gray(idSection.ppsa)}` : ''}`
        );
      } else if (hasPs4) {
        // Genuine PS4 title — clear any stale label from a previous scan.
        if (getLabel(g.normalizedTitle)) removeLabel(g.title);
        ps4Count++;
        spinner.stop();
      } else {
        noId++;
        spinner.stop();
      }
    } catch (err) {
      failed++;
      spinner.fail(`${g.title}: ${err.message}`);
    }
  }

  logger.success(
    `Scan complete — ${chalk.cyan(labeled)} labeled (PS1/PS2), ` +
    `${ps4Count} PS4, ${noId} no-ID, ${failed} failed.`
  );
}

module.exports = scanCommand;
