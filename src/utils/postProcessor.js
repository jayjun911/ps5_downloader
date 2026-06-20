const path = require('path');
const fs = require('fs');
const ora = require('ora');
const { extractRarArchive, getGameInfoFromArchive, compressFolderTo7z, compressFileTo7z, findWorkingPassword } = require('../services/unrarService');
const { addDownloadedGame } = require('../services/downloadedDb');
const logger = require('./logger');

function isArchiveFile(file) {
  const lower = file.toLowerCase();
  return lower.endsWith('.rar') || lower.endsWith('.zip') || lower.endsWith('.7z') || /\.r\d{2}$/.test(lower) || /\.z\d{2}$/.test(lower);
}

function checkIsSplitArchive(archiveFiles) {
  if (archiveFiles.length <= 1) return false;
  for (const file of archiveFiles) {
    const lower = file.toLowerCase();
    if (lower.match(/\.part[0-9]+\.(rar|zip|7z|r\d{2}|z\d{2})$/) ||
        /\.r\d{2}$/.test(lower) || /\.z\d{2}$/.test(lower)) return true;
  }
  return false;
}

function findMainArchiveFile(archiveFiles) {
  if (archiveFiles.length === 0) return null;
  const candidate = archiveFiles.find(name => {
    const lower = name.toLowerCase();
    return (lower.endsWith('.rar') && !lower.match(/\.part[2-9]\d*\.rar$/) && !lower.match(/\.part0[2-9]\d*\.rar$/)) ||
           (lower.endsWith('.zip') && !lower.match(/\.part[2-9]\d*\.zip$/) && !lower.match(/\.part0[2-9]\d*\.zip$/)) ||
           (lower.endsWith('.7z') && !lower.match(/\.part[2-9]\d*\.7z$/) && !lower.match(/\.part0[2-9]\d*\.7z$/)) ||
           lower.includes('part1.rar') || lower.includes('part01.rar') ||
           lower.includes('part1.zip') || lower.includes('part01.zip') ||
           lower.includes('part1.7z') || lower.includes('part01.7z');
  });
  return candidate || archiveFiles[0];
}

function getUniqueFilePath(dir, baseName, ext, currentFilePath = null) {
  let filePath = path.join(dir, `${baseName}${ext}`);
  if (!fs.existsSync(filePath)) return filePath;
  
  if (currentFilePath && path.resolve(filePath) === path.resolve(currentFilePath)) {
    return filePath;
  }
  
  let counter = 1;
  while (fs.existsSync(path.join(dir, `${baseName}_${counter}${ext}`))) {
    const checkPath = path.join(dir, `${baseName}_${counter}${ext}`);
    if (currentFilePath && path.resolve(checkPath) === path.resolve(currentFilePath)) {
      return checkPath;
    }
    counter++;
  }
  return path.join(dir, `${baseName}_${counter}${ext}`);
}

/**
 * Post-processes downloaded archive files:
 *   1. Reads param.json to get real title / PPSA / version
 *   2. Removes passwords / unpacks split archives, then recompresses clean
 *   3. Renames to standard `Title [PPSA][vXX.XX].rar` format
 *   4. Registers in downloaded.xml
 *
 * @param {{
 *   downloadedFiles: Array<{filename: string, type: string}>,
 *   downloadDir: string,
 *   password?: string,
 *   hostName?: string,
 *   region?: string,
 *   initialTitle?: string,
 *   initialPpsa?: string
 * }} opts
 */
async function processDownloadedFiles({ downloadedFiles, downloadDir, password = '', hostName = 'Unknown', region = 'Unknown', initialTitle = 'Unknown Game', initialPpsa = 'Unknown' }) {
  let finalTitle = initialTitle;
  let finalPpsa = initialPpsa;
  let finalVer = 'v01.00';

  // Group files by type
  const fileGroups = {};
  for (const fileItem of downloadedFiles) {
    const type = fileItem.type || 'GAME';
    const filePath = path.join(downloadDir, fileItem.filename);
    if (!fs.existsSync(filePath)) continue;
    if (!fileGroups[type]) fileGroups[type] = [];
    fileGroups[type].push(fileItem.filename);
  }

  // Read metadata from the GAME archive first so all group names use the real title/PPSA
  const gameArchives = (fileGroups['GAME'] || []).filter(isArchiveFile);
  if (gameArchives.length > 0) {
    const mainFilePath = path.join(downloadDir, findMainArchiveFile(gameArchives));
    const checkSpinner = ora(`Inspecting "${path.basename(mainFilePath)}" internally...`).start();
    try {
      const gameInfo = await getGameInfoFromArchive(mainFilePath, password);
      finalPpsa = gameInfo.titleId;
      finalVer = gameInfo.version;
      finalTitle = gameInfo.titleName;
      checkSpinner.succeed(`Read metadata: ${finalTitle} [${finalPpsa}] ${finalVer}`);
    } catch (err) {
      checkSpinner.warn(`Failed to read param.json: ${err.message}. Using fallback metadata.`);
    }
  }

  const registeredFiles = [];

  const processArchiveSet = async (archiveSet, groupType, baseNameLabel) => {
    const mainFileName = findMainArchiveFile(archiveSet);
    if (!mainFileName) return;
    const mainFilePath = path.join(downloadDir, mainFileName);

    let workingPassword = '';
    try {
      const pwdCandidates = password ? [password] : [];
      workingPassword = await findWorkingPassword(mainFilePath, pwdCandidates);
    } catch (e) { /* ignore */ }

    const isSplit = checkIsSplitArchive(archiveSet);
    const encrypted = workingPassword !== '';

    if (encrypted || isSplit) {
      const extractSpinner = ora(`[${groupType}] Extracting "${mainFileName}" (encrypted/split)...`).start();
      const outputFolderPath = path.join(downloadDir, baseNameLabel);
      try {
        await extractRarArchive(mainFilePath, outputFolderPath, workingPassword);
        if (!fs.existsSync(outputFolderPath) || fs.readdirSync(outputFolderPath).length === 0) {
          throw new Error(`Extraction output folder is empty: ${outputFolderPath}`);
        }
        extractSpinner.succeed(`[${groupType}] Extracted to: ${baseNameLabel}`);

        const deleteSpinner = ora(`[${groupType}] Cleaning up downloaded archives...`).start();
        const basePattern = mainFileName.replace(/\.part[0-9]+\.(rar|zip|7z)$/i, '').replace(/\.(rar|zip|7z)$/i, '');
        for (const file of archiveSet) {
          if (file.toLowerCase().startsWith(basePattern.toLowerCase()) || file === mainFileName) {
            try { fs.unlinkSync(path.join(downloadDir, file)); } catch (e) { /* ignore */ }
          }
        }
        deleteSpinner.succeed(`[${groupType}] Cleaned up.`);

        const destRarPath = path.join(downloadDir, `${baseNameLabel}.7z`);
        const compressSpinner = ora(`[${groupType}] Recompressing to ${baseNameLabel}.7z...`).start();
        await compressFolderTo7z(outputFolderPath, destRarPath);
        if (!fs.existsSync(destRarPath) || fs.statSync(destRarPath).size === 0) {
          throw new Error(`Recompressed 7z is empty: ${destRarPath}`);
        }
        compressSpinner.succeed(`[${groupType}] Recompressed: ${baseNameLabel}.7z`);
        registeredFiles.push({ fileName: `${baseNameLabel}.7z`, type: groupType });

        try { fs.rmSync(outputFolderPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
      } catch (extErr) {
        const isPasswordError = extErr.status === 11;
        const userMsg = isPasswordError
          ? (workingPassword ? `Incorrect archive password: "${workingPassword}".` : `Archive is password-protected. Try: --password <pwd>`)
          : extErr.message;
        extractSpinner.fail(`[${groupType}] ${userMsg}`);
        const cleanErr = new Error(userMsg);
        cleanErr.isUserError = true;
        throw cleanErr;
      }
    } else {
      const origExt = path.extname(mainFileName).toLowerCase();
      const newFileName = `${baseNameLabel}${origExt}`;
      try {
        fs.renameSync(path.join(downloadDir, mainFileName), path.join(downloadDir, newFileName));
        logger.success(`[${groupType}] Renamed to: ${newFileName}`);
        registeredFiles.push({ fileName: newFileName, type: groupType });
      } catch (renameErr) {
        logger.warn(`[${groupType}] Rename failed: ${renameErr.message}`);
        registeredFiles.push({ fileName: mainFileName, type: groupType });
      }
    }
  };

  for (const [type, files] of Object.entries(fileGroups)) {
    const archives = files.filter(isArchiveFile);
    const extraFiles = files.filter(f => !isArchiveFile(f));
    const isGame = type === 'GAME';
    const baseName = isGame
      ? `${finalTitle} [${finalPpsa}][${finalVer}]`
      : `${finalTitle} [${finalPpsa}][${type}]`;

    if (archives.length > 0) {
      if (checkIsSplitArchive(archives) || isGame) {
        await processArchiveSet(archives, type, baseName);
      } else {
        for (let idx = 0; idx < archives.length; idx++) {
          const fileBaseName = archives.length > 1 ? `${baseName}_${idx + 1}` : baseName;
          await processArchiveSet([archives[idx]], type, fileBaseName);
        }
      }
    }

    for (const file of extraFiles) {
      const ext = path.extname(file).toLowerCase();
      const isText = ['.txt', '.pdf', '.jpg', '.jpeg', '.png', '.md', '.htm', '.html'].includes(ext);

      // Non-archive GAME files (e.g. .exfat raw images) get wrapped in 7z before registering
      if (isGame && !isText) {
        const dest7zPath = path.join(downloadDir, `${baseName}.7z`);
        const compressSpinner = ora(`[${type}] Renaming and compressing "${file}" to 7z...`).start();
        const currentPath = path.join(downloadDir, file);
        const renamedPath = path.join(downloadDir, `${baseName}${ext}`);
        let actualRenamedPath = renamedPath;

        try {
          if (path.resolve(currentPath) !== path.resolve(renamedPath)) {
            actualRenamedPath = getUniqueFilePath(downloadDir, baseName, ext, currentPath);
            fs.renameSync(currentPath, actualRenamedPath);
          }

          // Validate exFAT filesystem via OSFMount + chkdsk before compressing
          if (ext === '.exfat') {
            const { validateExfat } = require('../services/osfmountService');
            compressSpinner.text = `[${type}] Validating exFAT filesystem...`;
            const { valid, message, skipped } = await validateExfat(actualRenamedPath, (s) => {
              compressSpinner.text = `[${type}] ${s}`;
            });
            if (skipped) {
              compressSpinner.text = `[${type}] Compressing "${path.basename(actualRenamedPath)}" to 7z...`;
            } else if (!valid) {
              const valErr = new Error(`exFAT validation failed: filesystem errors detected`);
              valErr.isExfatValidationError = true;
              throw valErr;
            } else {
              logger.success(`[${type}] exFAT validation passed`);
              compressSpinner.text = `[${type}] Compressing "${path.basename(actualRenamedPath)}" to 7z...`;
            }
          }

          await compressFileTo7z(actualRenamedPath, dest7zPath);
          if (!fs.existsSync(dest7zPath) || fs.statSync(dest7zPath).size === 0) {
            throw new Error('Output 7z is empty.');
          }

          compressSpinner.succeed(`[${type}] Renamed and compressed to: ${baseName}.7z`);
          registeredFiles.push({ fileName: `${baseName}.7z`, type });
        } catch (compErr) {
          if (compErr.isExfatValidationError) {
            compressSpinner.fail(`[${type}] exFAT validation failed — filesystem errors detected`);
            throw compErr; // propagate: download.js will rename .exfat → .failed
          }
          compressSpinner.fail(`[${type}] Processing failed: ${compErr.message}. Keeping original file.`);
          const finalName = path.basename(actualRenamedPath);
          registeredFiles.push({ fileName: finalName, type });
        }
      } else {
        const currentPath = path.join(downloadDir, file);
        const newPath = getUniqueFilePath(downloadDir, baseName, ext, currentPath);
        const newFileName = path.basename(newPath);
        try {
          if (path.resolve(currentPath) !== path.resolve(newPath)) {
            fs.renameSync(currentPath, newPath);
            logger.info(`Renamed: ${file} → ${newFileName}`);
          }
          registeredFiles.push({ fileName: newFileName, type });
        } catch (renameErr) {
          logger.warn(`Rename failed for "${file}": ${renameErr.message}`);
          registeredFiles.push({ fileName: file, type });
        }
      }
    }
  }

  const titleToRegister = (initialTitle && initialTitle !== 'Unknown Game') ? initialTitle : finalTitle;
  const gameToRegister = registeredFiles.find(rf => rf.type === 'GAME');
  const otherToRegister = registeredFiles.filter(rf => rf.type !== 'GAME');

  if (gameToRegister) {
    addDownloadedGame({ title: titleToRegister, fileName: gameToRegister.fileName, ppsa: finalPpsa, password: '', source: hostName, region });
  } else if (otherToRegister.length > 0) {
    addDownloadedGame({ title: titleToRegister, fileName: otherToRegister[0].fileName, ppsa: finalPpsa, password: '', source: hostName, region });
  }

  return { registeredFiles, finalTitle, finalPpsa, finalVer };
}

module.exports = { processDownloadedFiles, getUniqueFilePath, isArchiveFile, checkIsSplitArchive, findMainArchiveFile };
