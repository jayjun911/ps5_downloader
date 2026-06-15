const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// Regular expression to match allowed download host domains
const DOWNLOAD_HOST_REGEX = /^https?:\/\/(?:www\.)?(?:1fichier\.com|mediafire\.com|rootz\.so|akirabox\.com|vikingfile\.com|mega\.nz)\//i;

// Regular expression to find URLs inside plain text
const PLAIN_TEXT_URL_REGEX = /https?:\/\/(?:www\.)?(?:1fichier\.com|mediafire\.com|rootz\.so|akirabox\.com|vikingfile\.com|mega\.nz)\/[^\s"'<>]+/gi;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const { execSync } = require('child_process');

/**
 * Fetches the reroute URL and extracts all valid direct download links.
 * Handing both anchor tags and plain text URLs.
 * 
 * @param {string} rerouteUrl 
 * @returns {Promise<Array<{label: string, url: string}>>}
 */
async function resolveReroute(rerouteUrl) {
  const archiveIdMatch = rerouteUrl.match(/\/archives\/(\d+)/);
  const archiveId = archiveIdMatch ? archiveIdMatch[1] : '';
  const manualRerouteHtmlPath = archiveId 
    ? path.join(__dirname, `../../data/cache/manual_html/reroute-${archiveId}.html`)
    : '';

  try {
    let htmlData;
    if (manualRerouteHtmlPath && fs.existsSync(manualRerouteHtmlPath)) {
      htmlData = fs.readFileSync(manualRerouteHtmlPath, 'utf-8');
    } else {
      // 1. Try WordPress REST API first (since it is Turnstile-free)
      if (archiveId) {
        try {
          const apiRes = await axios.get(`https://downloadgameps3.net/wp-json/wp/v2/posts/${archiveId}`, {
            headers: { 'User-Agent': USER_AGENT }
          });
          if (apiRes.data && apiRes.data.content && apiRes.data.content.rendered) {
            htmlData = apiRes.data.content.rendered;
          }
        } catch (apiErr) {
          // Ignore and fallback
        }
      }

      if (!htmlData) {
        try {
          const res = await axios.get(rerouteUrl, {
            headers: { 'User-Agent': USER_AGENT }
          });
          htmlData = res.data;
          if (htmlData && (htmlData.includes('Just a moment...') || htmlData.includes('challenges.cloudflare.com'))) {
            throw new Error('Cloudflare Turnstile challenge detected.');
          }
        } catch (axiosErr) {
          try {
            const cmd = `curl -s -L -A "${USER_AGENT}" "${rerouteUrl}"`;
            const stdout = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
            if (stdout && stdout.trim().length > 0 && !stdout.includes('Just a moment...') && !stdout.includes('challenges.cloudflare.com')) {
              htmlData = stdout;
            } else {
              throw axiosErr;
            }
          } catch (curlErr) {
            throw axiosErr;
          }
        }
      }
    }

    if (htmlData && (htmlData.includes('Just a moment...') || htmlData.includes('challenges.cloudflare.com'))) {
      throw new Error(`Cloudflare Turnstile challenge blocked resolving reroute URL.
To bypass this block, please follow these steps:
1. Open this URL in your web browser:
   ${rerouteUrl}
2. Right-click anywhere on the page, select "View Page Source" (or save page as HTML).
3. Copy all HTML source code and save it exactly to this file path:
   ${manualRerouteHtmlPath}
4. Re-run your download command!`);
    }

    const $ = cheerio.load(htmlData);
    const linksMap = new Map(); // Use Map to prevent exact URL duplicates

    // 1. Extract from anchor tags
    $('a[href]').each((_, el) => {
      const url = ($(el).attr('href') || '').trim();
      const label = $(el).text().trim() || 'Link';
      if (url && DOWNLOAD_HOST_REGEX.test(url)) {
        linksMap.set(url, label);
      }
    });

    // 2. Extract from plain text content (for text-only list formats)
    const pageText = $('body').text() || '';
    const textUrls = pageText.match(PLAIN_TEXT_URL_REGEX) || [];
    
    for (const url of textUrls) {
      const trimmedUrl = url.trim();
      if (!linksMap.has(trimmedUrl)) {
        // Try to find a labeling context if possible or use default
        linksMap.set(trimmedUrl, 'Text Link');
      }
    }

    // Convert Map back to list of objects
    const resolvedLinks = [];
    linksMap.forEach((label, url) => {
      resolvedLinks.push({ label, url });
    });

    return resolvedLinks;
  } catch (err) {
    throw new Error(`Failed to resolve reroute URL: ${rerouteUrl}. Error: ${err.message}`);
  }
}

module.exports = {
  resolveReroute
};
