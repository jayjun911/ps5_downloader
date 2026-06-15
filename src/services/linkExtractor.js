const cheerio = require('cheerio');
const { resolveReroute } = require('./rerouteResolver');

const EXCLUDED_DOMAINS = [
  'downloadgameps3.com',  // Guide/Tool links
];

const REROUTE_DOMAIN = 'downloadgameps3.net';

/**
 * Calculates region priority. Lower number represents higher priority.
 * USA (exFAT) -> USA -> KOR -> EUR -> other
 * But user specified: "KOR가 보이면 따로 무조건 high priority로 download"
 * Thus, KOR gets top priority (0), exFAT gets 1, USA gets 2, EUR gets 3, others get 4.
 */
function getRegionPriority(regionName) {
  const region = regionName.toUpperCase();
  if (region.includes('KOR')) return 0;
  if (region.includes('EXFAT')) return 1;
  if (region.includes('USA')) return 2;
  if (region.includes('EUR') || region.includes('EURO')) return 3;
  return 4; // Other
}

// Download host priority. Lower index represents higher priority.
const HOST_PRIORITY_PATTERNS = [
  /1fichier\.com|1file/i,
  /mediafire\.com/i,
  /akirabox\.com|akia/i,
  /vikingfile\.com|viki/i,
  /mega\.nz|mega\.co\.nz/i,
  /rootz\.so/i
];

function getHostPriority(url) {
  for (let i = 0; i < HOST_PRIORITY_PATTERNS.length; i++) {
    if (HOST_PRIORITY_PATTERNS[i].test(url)) return i;
  }
  return HOST_PRIORITY_PATTERNS.length; // lowest priority
}

function getHostNameFromUrl(url) {
  if (/1fichier\.com|1file/i.test(url)) return '1fichier';
  if (/mediafire\.com/i.test(url)) return 'Mediafire';
  if (/akirabox\.com|akia/i.test(url)) return 'Akia';
  if (/vikingfile\.com|viki/i.test(url)) return 'Viki';
  if (/mega\.nz|mega\.co\.nz/i.test(url)) return 'Mega';
  if (/rootz\.so/i.test(url)) return 'Rootz';
  return 'Other';
}

/**
 * Decodes base64 payload and extracts password and direct/reroute links.
 * 
 * @param {string} base64Payload 
 * @returns {{directLinks: Array<{label: string, url: string}>, rerouteLinks: Array<{label: string, url: string}>, password: string}}
 */
function decodeAndExtractLinks(base64Payload) {
  const decoded = Buffer.from(base64Payload, 'base64').toString('utf-8');
  
  // Try to parse as JSON first (used in newer game pages)
  try {
    const data = JSON.parse(decoded);
    if (data && (Array.isArray(data.URLS) || Array.isArray(data.urls))) {
      const urls = data.URLS || data.urls || [];
      const password = data.Password || data.password || '';
      
      const directLinks = [];
      const rerouteLinks = [];
      
      for (const url of urls) {
        let trimmedUrl = (url || '').trim();
        // Decode shorteners / click bypasses (e.g. clk.sh) containing base64 URL param
        if (trimmedUrl.includes('url=')) {
          const urlMatch = trimmedUrl.match(/[?&]url=([^&]+)/);
          if (urlMatch) {
            try {
              const decodedUrl = Buffer.from(decodeURIComponent(urlMatch[1]), 'base64').toString('utf-8');
              if (decodedUrl.startsWith('http')) {
                trimmedUrl = decodedUrl;
              }
            } catch (e) {
              // ignore
            }
          }
        }
        
        if (trimmedUrl && !EXCLUDED_DOMAINS.some(domain => trimmedUrl.includes(domain))) {
          if (trimmedUrl.includes(REROUTE_DOMAIN)) {
            rerouteLinks.push({ label: 'Link', url: trimmedUrl });
          } else {
            directLinks.push({ label: 'Link', url: trimmedUrl });
          }
        }
      }
      
      return { directLinks, rerouteLinks, password };
    }
  } catch (err) {
    // Parsing failed, proceed with Cheerio HTML parsing
  }

  const $ = cheerio.load(decoded);

  // Extract password (usually written like "Password: DLPSGAME.COM")
  const passwordMatch = $.text().match(/Password:\s*([^\s<]+)/i);
  const password = passwordMatch ? passwordMatch[1].trim() : '';

  const links = [];
  $('a[href]').each((_, el) => {
    let url = ($(el).attr('href') || '').trim();
    const label = $(el).text().trim() || 'Link';
    
    // Decode shorteners / click bypasses (e.g. clk.sh) containing base64 URL param
    if (url.includes('url=')) {
      const urlMatch = url.match(/[?&]url=([^&]+)/);
      if (urlMatch) {
        try {
          const decodedUrl = Buffer.from(decodeURIComponent(urlMatch[1]), 'base64').toString('utf-8');
          if (decodedUrl.startsWith('http')) {
            url = decodedUrl;
          }
        } catch (e) {
          // ignore
        }
      }
    }

    // Filter out help guides and tools
    if (url && !EXCLUDED_DOMAINS.some(domain => url.includes(domain))) {
      links.push({ label, url });
    }
  });

  const rerouteLinks = links.filter(l => l.url.includes(REROUTE_DOMAIN));
  const directLinks = links.filter(l => !l.url.includes(REROUTE_DOMAIN));

  return { directLinks, rerouteLinks, password };
}

/**
 * Evaluates all subpage sections for targetPPSA, sorts by region priority,
 * resolves reroutes if necessary, and returns the best download host and URLs.
 * 
 * @param {Array<{ppsa: string, region: string, base64Payload: string}>} sections
 * @param {string} targetPPSA
 * @returns {Promise<{urls: string[], password: string, region: string, hostName: string}>}
 */
async function getBestDownloadLinks(sections, targetPPSA) {
  // 1. Filter sections matching targetPPSA (if targetPPSA is specified)
  const matchingSections = targetPPSA 
    ? sections.filter(sec => sec.ppsa === targetPPSA)
    : sections;

  if (matchingSections.length === 0) {
    throw new Error(`No sections found matching PPSA: ${targetPPSA}`);
  }

  // 2. Sort by region priority
  matchingSections.sort((a, b) => {
    return getRegionPriority(a.region) - getRegionPriority(b.region);
  });

  // Try each region section in order of priority (in case of failure to extract/resolve)
  for (const section of matchingSections) {
    try {
      const { directLinks, rerouteLinks, password } = decodeAndExtractLinks(section.base64Payload);
      let candidates = [...directLinks];

      // Resolve reroute URLs if present
      if (rerouteLinks.length > 0) {
        for (const reroute of rerouteLinks) {
          try {
            const resolved = await resolveReroute(reroute.url);
            candidates = candidates.concat(resolved);
          } catch (e) {
            // Ignore reroute resolution failure
          }
        }
      }

      if (candidates.length === 0) {
        continue;
      }

      // Group candidates by host name priority
      const groupedByHost = {};
      for (const cand of candidates) {
        const priorityIndex = getHostPriority(cand.url);
        if (!groupedByHost[priorityIndex]) {
          groupedByHost[priorityIndex] = [];
        }
        // Avoid duplicate links
        if (!groupedByHost[priorityIndex].includes(cand.url)) {
          groupedByHost[priorityIndex].push(cand.url);
        }
      }

      // Find highest priority host that has links
      const sortedHostKeys = Object.keys(groupedByHost).map(Number).sort((a, b) => a - b);
      if (sortedHostKeys.length > 0) {
        const bestHostIndex = sortedHostKeys[0];
        const bestUrls = groupedByHost[bestHostIndex];
        const hostName = getHostNameFromUrl(bestUrls[0]);

        return {
          urls: bestUrls,
          password,
          region: section.region,
          hostName,
          ppsa: section.ppsa
        };
      }
    } catch (err) {
      // Try next region section
    }
  }

  throw new Error(`Failed to extract any download links for PPSA: ${targetPPSA}`);
}

module.exports = {
  decodeAndExtractLinks,
  getBestDownloadLinks,
  getRegionPriority
};
