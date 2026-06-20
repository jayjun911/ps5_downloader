const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../utils/logger');

const FDM_EXE = 'C:\\Program Files\\Softdeluxe\\Free Download Manager\\fdm.exe';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function getFilenameFromDisposition(disposition) {
  if (!disposition) return null;
  const filenameStarMatch = disposition.match(/filename\*=\s*UTF-8''([^;\n]+)/i);
  if (filenameStarMatch) {
    try { return decodeURIComponent(filenameStarMatch[1].trim()); } catch (e) {}
  }
  const filenameMatch = disposition.match(/filename="([^"]+)"/i);
  if (filenameMatch) return filenameMatch[1].trim();
  const noQuotesMatch = disposition.match(/filename=([^;\n]+)/i);
  if (noQuotesMatch) return noQuotesMatch[1].trim();
  return null;
}

async function get1fichierDirectUrlAndFilename(fileUrl) {
  const apiKey = process.env.FICHIER_API_KEY;
  if (!apiKey) throw new Error('FICHIER_API_KEY is not defined in environment variables.');

  let tokenRes;
  try {
    tokenRes = await axios.post(
      'https://api.1fichier.com/v1/download/get_token.cgi',
      { url: fileUrl, single: 1 },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT
        }
      }
    );
  } catch (err) {
    if (err.response && err.response.status === 404) {
      const e = new Error('File not found (404) on 1fichier. The link is likely dead or has been deleted.');
      e.isLinkDead = true;
      throw e;
    }
    throw err;
  }

  if (tokenRes.data.status !== 'OK') {
    throw new Error(`1fichier token error: ${tokenRes.data.message || JSON.stringify(tokenRes.data)}`);
  }

  const directUrl = tokenRes.data.url;

  // HEAD request to get filename from Content-Disposition
  let filename = null;
  try {
    const headRes = await axios.head(directUrl, {
      headers: { 'User-Agent': USER_AGENT },
      maxRedirects: 5,
      timeout: 15000
    });
    filename = getFilenameFromDisposition(headRes.headers['content-disposition']);
    if (!filename) {
      filename = decodeURIComponent(path.basename(new URL(directUrl).pathname));
    }
  } catch (e) {
    try { filename = decodeURIComponent(path.basename(new URL(directUrl).pathname)); } catch (_) {}
  }

  return { directUrl, filename: filename || 'downloaded_file' };
}

async function resolveDatanodesDirectUrl(fileUrl) {
  const { extractDatanodesId } = require('./datanodesDownloader');
  const fileId = extractDatanodesId(fileUrl);
  if (!fileId) throw new Error(`Cannot parse datanodes file ID from URL: ${fileUrl}`);

  const base = 'https://datanodes.to';
  const filePageUrl = `${base}/${fileId}`;
  const downloadPageUrl = `${base}/download`;
  const cookieStore = {};

  const parseCookies = (setCookieHeaders) => {
    if (!setCookieHeaders) return {};
    const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    const result = {};
    for (const h of arr) {
      const parts = h.split(';')[0].trim().split('=');
      if (parts.length >= 2) result[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
    return result;
  };
  const formatCookies = (store) => Object.entries(store).map(([k, v]) => `${k}=${v}`).join('; ');
  const makeHeaders = (extra = {}) => ({
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    ...extra,
    'Cookie': formatCookies(cookieStore)
  });
  const updateCookies = (response) => {
    const setCookie = response.headers['set-cookie'];
    if (setCookie) Object.assign(cookieStore, parseCookies(setCookie));
  };

  let step1;
  try {
    step1 = await axios.get(filePageUrl, { headers: makeHeaders(), maxRedirects: 0, validateStatus: s => s < 400 || s === 302 || s === 301 });
  } catch (err) {
    if (err.response && err.response.status === 404) {
      const e = new Error(`File not found on datanodes.to (${fileId}). The link may have expired.`);
      e.isLinkDead = true;
      throw e;
    }
    throw err;
  }
  updateCookies(step1);

  const step2 = await axios.get(downloadPageUrl, { headers: makeHeaders({ 'Referer': filePageUrl }), maxRedirects: 5 });
  updateCookies(step2);

  const fnameMatch = step2.data.match(/name="fname"\s+value="([^"]+)"/);
  const fname = fnameMatch ? fnameMatch[1] : fileId;

  const step3 = await axios.post(downloadPageUrl, new URLSearchParams({
    op: 'download1', usr_login: '', id: fileId, fname, referer: filePageUrl, method_free: 'Free Download >>'
  }).toString(), {
    headers: makeHeaders({ 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': base, 'Referer': downloadPageUrl }),
    maxRedirects: 5
  });
  updateCookies(step3);

  const countdownHtml = step3.data;
  const captchaMatch = countdownHtml.match(/:has-captcha="(true|false)"/);
  if (captchaMatch && captchaMatch[1] === 'true') throw new Error('datanodes.to requires reCAPTCHA. Cannot automate.');

  const randMatch = countdownHtml.match(/\brand="([^"]*)"/);
  const rand = randMatch ? randMatch[1] : '';
  const countdownMatch = countdownHtml.match(/:countdown="(\d+)"/);
  const waitSeconds = countdownMatch ? parseInt(countdownMatch[1], 10) : 0;
  if (waitSeconds > 0) await new Promise(resolve => setTimeout(resolve, (waitSeconds + 1) * 1000));

  const step4 = await axios.post(downloadPageUrl, new URLSearchParams({
    op: 'download2', id: fileId, rand, referer: filePageUrl,
    method_free: 'Free Download >>', method_premium: '', g_captch__a: '1'
  }).toString(), {
    headers: makeHeaders({ 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': base, 'Referer': downloadPageUrl }),
    maxRedirects: 0, validateStatus: s => s < 400
  });
  updateCookies(step4);

  let directUrl;
  try {
    const json = typeof step4.data === 'string' ? JSON.parse(step4.data) : step4.data;
    if (!json.url) throw new Error(`Unexpected response: ${JSON.stringify(json).substring(0, 200)}`);
    directUrl = decodeURIComponent(json.url);
  } catch (e) {
    const loc = step4.headers['location'];
    if (loc && loc.startsWith('http')) { directUrl = loc; }
    else throw new Error(`download2 did not return a URL. Response: ${JSON.stringify(step4.data).substring(0, 200)}`);
  }

  let filename = null;
  try {
    const headRes = await axios.head(directUrl, { headers: makeHeaders({ 'Referer': downloadPageUrl }), maxRedirects: 5, timeout: 15000 });
    filename = getFilenameFromDisposition(headRes.headers['content-disposition']);
  } catch (e) {}
  if (!filename) {
    try { filename = decodeURIComponent(path.basename(new URL(directUrl).pathname)); } catch (_) {}
  }
  if (!filename) filename = fname || `${fileId}.bin`;

  return { directUrl, filename };
}

function pollForFile(filePath, onProgress) {
  return new Promise((resolve, reject) => {
    const POLL_MS = 3000;
    const TIMEOUT_MS = 72 * 60 * 60 * 1000; // 72 hours
    let elapsed = 0;
    let lastSize = -1;
    let stableCount = 0;
    const STABLE_NEEDED = 5; // 5 * 3s = 15 stable seconds = download complete

    const timer = setInterval(() => {
      elapsed += POLL_MS;
      if (elapsed > TIMEOUT_MS) {
        clearInterval(timer);
        return reject(new Error('FDM download timed out (72 hours exceeded)'));
      }

      if (fs.existsSync(filePath)) {
        try {
          const size = fs.statSync(filePath).size;
          if (onProgress) onProgress(size);
          if (size > 0 && size === lastSize) {
            if (++stableCount >= STABLE_NEEDED) {
              clearInterval(timer);
              return resolve({ destPath: filePath, filename: path.basename(filePath), size });
            }
          } else {
            stableCount = 0;
            lastSize = size;
          }
        } catch (e) {}
      } else {
        stableCount = 0;
      }
    }, POLL_MS);
  });
}

/**
 * Downloads a file using Free Download Manager (FDM).
 * Resolves the direct URL first (for 1fichier via API, for datanodes via flow),
 * then launches FDM and polls until the file is complete.
 *
 * @param {string} fileUrl Original URL (1fichier or datanodes)
 * @param {string} destDir Download destination directory
 * @param {function} onStatus Status callback (string)
 * @param {boolean} is1fichier True if the URL is a 1fichier link
 * @returns {Promise<{destPath: string, filename: string, size: number, skipped?: boolean}>}
 */
async function downloadWithFdm(fileUrl, destDir, onStatus, is1fichier = false) {
  if (!fs.existsSync(FDM_EXE)) {
    throw new Error(`Free Download Manager not found at: ${FDM_EXE}`);
  }

  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const sessions = parseInt(process.env.DOWNLOADER_SESSION || '3', 10);

  if (onStatus) onStatus('Resolving direct download URL...');

  let directUrl, filename;
  if (is1fichier) {
    ({ directUrl, filename } = await get1fichierDirectUrlAndFilename(fileUrl));
  } else {
    if (onStatus) onStatus('Resolving datanodes URL (may take a moment)...');
    ({ directUrl, filename } = await resolveDatanodesDirectUrl(fileUrl));
  }

  filename = filename.replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!filename) filename = 'downloaded_file';

  const destFilePath = path.join(destDir, filename);

  if (fs.existsSync(destFilePath)) {
    return { destPath: destFilePath, filename, size: fs.statSync(destFilePath).size, skipped: true };
  }

  if (onStatus) onStatus(`Launching FDM: ${filename}`);

  const cmd = `"${FDM_EXE}" /add "${directUrl}" /s /saveto "${destDir}" /filename "${filename}" /n ${sessions}`;
  logger.info(`FDM command: fdm.exe /add [url] /s /saveto "${destDir}" /filename "${filename}" /n ${sessions}`);
  execSync(cmd, { stdio: 'ignore' });

  if (onStatus) onStatus(`FDM downloading: ${filename} (0 MB)`);

  const result = await pollForFile(destFilePath, (size) => {
    if (onStatus) {
      const mb = (size / 1024 / 1024).toFixed(1);
      onStatus(`FDM downloading: ${filename} (${mb} MB)`);
    }
  });

  return result;
}

module.exports = { downloadWithFdm };
