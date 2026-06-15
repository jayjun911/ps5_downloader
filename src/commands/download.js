const { loadLocalLibrary } = require('../services/localLibrary');
const { loadDownloadedGames, addDownloadedGame } = require('../services/downloadedDb');
const { getWebGameList, findGameInWebList, getGameSubpageData } = require('../services/webScraper');
const { getBestDownloadLinks, getRegionPriority } = require('../services/linkExtractor');
const { download1fichier } = require('../services/fichierDownloader');
const { extractVersion } = require('../utils/versionParser');
const { convertToFfpfsc } = require('../services/converter');
const logger = require('../utils/logger');
const open = require('open');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const ora = require('ora');
const chalk = require('chalk');

const FAIL_LOG_PATH = path.join(__dirname, '../../data/failed_downloads.json');

/**
 * Logs a download failure to failed_downloads.json.
 */
function logFailure(title, url, reason) {
  let failures = [];
  if (fs.existsSync(FAIL_LOG_PATH)) {
    try {
      failures = JSON.parse(fs.readFileSync(FAIL_LOG_PATH, 'utf-8'));
    } catch (e) {
      failures = [];
    }
  }
  failures.push({
    title,
    url,
    reason,
    timestamp: new Date().toISOString()
  });
  
  const dir = path.dirname(FAIL_LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(FAIL_LOG_PATH, JSON.stringify(failures, null, 2), 'utf-8');
}

/**
 * Performs download for a single game.
 */
async function downloadSingleGame(game) {
  const spinner = ora(`Scraping subpage for "${game.title}"...`).start();
  try {
    const sections = await getGameSubpageData(game.slug, game.url);
    if (sections.length === 0) {
      throw new Error('No download sections found on game subpage.');
    }

    // Check if local library has PPSA
    const localGames = loadLocalLibrary();
    const localMatch = localGames.find(lg => lg.normalizedTitle === game.normalizedTitle);
    const targetPPSA = localMatch ? localMatch.ppsa : null;

    // Sort sections so we try the most preferred first:
    // 1. Matches targetPPSA (if targetPPSA is specified)
    // 2. Region priority order (KOR -> EXFAT -> USA -> EUR -> Other)
    sections.sort((a, b) => {
      if (targetPPSA) {
        const aMatch = a.ppsa === targetPPSA;
        const bMatch = b.ppsa === targetPPSA;
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
      }
      return getRegionPriority(a.region) - getRegionPriority(b.region);
    });

    let lastError = null;
    let success = false;
    let chosenSection = null;

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      let downloadedFiles = [];
      
      const regionInfo = `region [${section.region}], PPSA [${section.ppsa}]`;
      spinner.text = `Trying option ${i + 1}/${sections.length}: ${regionInfo}...`;
      
      try {
        const bestLinks = await getBestDownloadLinks([section], null);
        
        spinner.info(`Matched Section: Region [${bestLinks.region}], PPSA [${bestLinks.ppsa || targetPPSA || 'Unknown'}], Host [${bestLinks.hostName}]`);
        
        if (bestLinks.hostName === '1fichier') {
          const downloadDir = process.env.DOWNLOAD_DIR || path.join(__dirname, '../../downloads');
          const totalParts = bestLinks.urls.length;
          let partIdx = 1;
          
          for (const fileUrl of bestLinks.urls) {
            const partLabel = totalParts > 1 ? ` (Part ${partIdx}/${totalParts})` : '';
            const partSpinner = ora(`Downloading part ${partIdx}/${totalParts}...`).start();
            
            try {
              const result = await download1fichier(fileUrl, downloadDir, (progress) => {
                partSpinner.text = `Downloading${partLabel}: ${progress.percent}% (${progress.receivedMB}MB / ${progress.totalMB}MB)`;
              });
              
              partSpinner.succeed(`Downloaded part ${partIdx}: ${result.filename}`);
              downloadedFiles.push(result.filename);
            } catch (downloadErr) {
              partSpinner.fail(`Failed to download part ${partIdx}: ${downloadErr.message}`);
              logFailure(game.title, game.url, `Download Part ${partIdx} failed: ${downloadErr.message}`);
              throw downloadErr;
            }
            partIdx++;
          }
          
          logger.success(`Successfully completed download for "${game.title}"`);
  
          // ── Step 3: Automatically convert to .ffpfsc ──
          if (downloadedFiles.length > 0) {
            let mainFileName = downloadedFiles[0];
            if (downloadedFiles.length > 1) {
              const candidate = downloadedFiles.find(name => {
                const lower = name.toLowerCase();
                return (lower.endsWith('.rar') && !lower.match(/\.part[2-9]\d*\.rar$/) && !lower.match(/\.part0[2-9]\d*\.rar$/)) || 
                       lower.includes('part1.rar') || 
                       lower.includes('part01.rar');
              });
              if (candidate) {
                mainFileName = candidate;
              }
            }
  
            const ppsa = bestLinks.ppsa || targetPPSA || 'Unknown';
            const version = extractVersion(mainFileName);
            const finalBaseName = `${game.title} [${ppsa}][${version}].ffpfsc`;
            const outputFilePath = path.join(downloadDir, finalBaseName);
            const mainFilePath = path.join(downloadDir, mainFileName);
  
            const converterSpinner = ora(`Converting "${mainFileName}" to ffpfsc...`).start();
            try {
              await convertToFfpfsc(mainFilePath, outputFilePath, bestLinks.password);
              converterSpinner.succeed(`Successfully converted to: ${finalBaseName}`);
  
              // Clean up original downloaded archive files
              const deleteSpinner = ora('Cleaning up downloaded archives...').start();
              for (const file of downloadedFiles) {
                try {
                  fs.unlinkSync(path.join(downloadDir, file));
                } catch (e) {
                  // ignore delete error
                }
              }
              deleteSpinner.succeed('Cleaned up downloaded archive files.');
  
              // Save final .ffpfsc file to downloaded.xml database
              addDownloadedGame({
                title: game.title,
                fileName: finalBaseName,
                ppsa: ppsa,
                password: bestLinks.password,
                source: '1fichier',
                region: bestLinks.region
              });
            } catch (convErr) {
              converterSpinner.fail(`Conversion failed: ${convErr.message}`);
              logFailure(game.title, game.url, `Conversion failed: ${convErr.message}`);
              throw convErr;
            }
          }
        } else {
          // Fallback: browser open
          spinner.warn(`1fichier link is not available (best is ${bestLinks.hostName}). Opening browser fallback...`);
          for (const url of bestLinks.urls) {
            await open(url);
          }
          logFailure(game.title, game.url, `No 1fichier links. Host: ${bestLinks.hostName}. Opened browser fallback.`);
        }
        
        success = true;
        break; // Successfully handled the section, exit loop
      } catch (err) {
        lastError = err;
        // Clean up partial files downloaded in this attempt
        if (downloadedFiles && downloadedFiles.length > 0) {
          const downloadDir = process.env.DOWNLOAD_DIR || path.join(__dirname, '../../downloads');
          for (const file of downloadedFiles) {
            try {
              fs.unlinkSync(path.join(downloadDir, file));
            } catch (e) {
              // ignore delete error
            }
          }
        }
        logger.warn(`\nAttempt failed for ${regionInfo}: ${err.message}. Trying next available option...`);
      }
    }

    if (!success) {
      throw lastError || new Error('All download/conversion attempts failed.');
    }

  } catch (err) {
    spinner.fail(`Download failed for "${game.title}": ${err.message}`);
    logFailure(game.title, game.url, err.message);
    throw err;
  }
}

/**
 * Handles the 'download' CLI command.
 * 
 * @param {string} titleQuery 
 * @param {{limit: string}} options 
 */
async function downloadCommand(titleQuery, options = {}) {
  const limit = options.limit ? parseInt(options.limit, 10) : null;

  try {
    if (limit !== null) {
      if (isNaN(limit) || limit <= 0) {
        logger.error('Invalid limit value. Please specify a positive integer.');
        return;
      }

      // TBD list download
      const localGames = loadLocalLibrary();
      const downloadedGames = loadDownloadedGames();
      const webList = await getWebGameList();

      const localMap = new Map(localGames.map(g => [g.normalizedTitle, g]));
      const dlMap = new Map(downloadedGames.map(g => [g.normalizedTitle, g]));

      const { loadExcludedGames } = require('../services/excludedDb');
      const excludedGames = loadExcludedGames();
      const excludedSet = new Set(excludedGames.map(g => g.normalizedTitle));

      const tbdList = webList.filter(g => 
        !localMap.has(g.normalizedTitle) && 
        !dlMap.has(g.normalizedTitle) && 
        !excludedSet.has(g.normalizedTitle)
      );

      if (tbdList.length === 0) {
        logger.info('No TBD (To Be Downloaded) games found.');
        return;
      }

      const count = Math.min(limit, tbdList.length);
      logger.info(`Starting batch download of ${count} games sequentially...`);

      for (let i = 0; i < count; i++) {
        const game = tbdList[i];
        console.log(chalk.bold.magenta(`\n=== Batch [${i + 1}/${count}]: ${game.title} ===`));
        try {
          await downloadSingleGame(game);
        } catch (e) {
          logger.error(`Skipping batch item "${game.title}" due to error.`);
        }
      }
      logger.success('\nBatch download job finished.');
      return;
    }

    if (!titleQuery) {
      logger.error('Please specify a game title to download. Example: ps5dl download "3D MiniGolf"');
      return;
    }

    // Single game query matching
    const matches = await findGameInWebList(titleQuery);
    if (matches.length === 0) {
      logger.warn(`No games found matching: "${titleQuery}"`);
      
      // Propose suggestions
      const webList = await getWebGameList();
      const normalizedQuery = titleQuery.toLowerCase();
      const suggestions = webList
        .filter(g => g.title.toLowerCase().includes(normalizedQuery))
        .slice(0, 3);
      
      if (suggestions.length > 0) {
        console.log(chalk.cyan('Did you mean one of these?'));
        suggestions.forEach(s => console.log(` - ${s.title}`));
      }
      return;
    }

    if (matches.length === 1) {
      await downloadSingleGame(matches[0]);
      return;
    }

    // Multiple matches, prompt selection
    console.log(chalk.yellow(`\nMultiple games match your query "${titleQuery}":`));
    matches.forEach((game, idx) => {
      console.log(`  [${idx + 1}] ${game.title} (${game.url})`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(chalk.cyan('\nSelect a game number to download (or press Enter to cancel): '), async (answer) => {
      rl.close();
      const num = parseInt(answer.trim(), 10);
      if (num > 0 && num <= matches.length) {
        await downloadSingleGame(matches[num - 1]);
      } else {
        logger.info('Cancelled.');
      }
    });

  } catch (err) {
    logger.error('Download command failed.', err);
  }
}

module.exports = downloadCommand;
