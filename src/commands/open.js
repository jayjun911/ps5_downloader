const { findGameInWebList } = require('../services/webScraper');
const logger = require('../utils/logger');
const open = require('open');
const readline = require('readline');
const chalk = require('chalk');

/**
 * Handles the 'open' CLI command.
 * 
 * @param {string} titleQuery 
 */
async function openCommand(titleQuery) {
  if (!titleQuery) {
    logger.error('Please specify a game title. Example: dlps open "Cyberpunk 2077"');
    return;
  }

  try {
    const matches = await findGameInWebList(titleQuery);
    
    if (matches.length === 0) {
      logger.warn(`No games found matching: "${titleQuery}"`);
      return;
    }

    if (matches.length === 1) {
      logger.info(`Opening: "${matches[0].title}" (${matches[0].url})`);
      await open(matches[0].url);
      return;
    }

    // Multiple matches, prompt user selection
    console.log(chalk.yellow(`\nMultiple games match your query "${titleQuery}":`));
    matches.forEach((game, idx) => {
      console.log(`  [${idx + 1}] ${game.title} (${game.url})`);
    });
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(chalk.cyan('\nSelect a game number to open (or press Enter to cancel): '), async (answer) => {
      rl.close();
      const num = parseInt(answer.trim(), 10);
      if (num > 0 && num <= matches.length) {
        const selected = matches[num - 1];
        logger.info(`Opening: "${selected.title}" (${selected.url})`);
        await open(selected.url);
      } else {
        logger.info('Cancelled.');
      }
    });

  } catch (err) {
    logger.error('Failed to open game page.', err);
  }
}

module.exports = openCommand;
