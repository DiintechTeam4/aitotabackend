const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');

puppeteer.use(StealthPlugin());

const delay = (ms) => new Promise(r => setTimeout(r, ms));

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1366,768'];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const scrapeJustDial = async ({ query, location, page = 1 }) => {
  const axios = require('axios');
  try {
    const loc = (location || 'India').trim();
    const locSlug = loc.toLowerCase().replace(/\s+/g, '-');

    // Step 1: Get real session cookies from JustDial homepage
    let sessionCookie = `jdloc=${loc}; jdlang=en`;
    try {
      const homeResp = await axios.get('https://www.justdial.com/', {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-IN,en;q=0.9'
        },
        timeout: 10000,
        maxRedirects: 3
      });
      const setCookies = homeResp.headers['set-cookie'] || [];
      if (setCookies.length > 0) {
        sessionCookie = setCookies.map(c => c.split(';')[0]).join('; ');
      }
    } catch (_) {}

    // Step 2: Hit AJAX search endpoint with real session
    const url = `https://www.justdial.com/functions/ajaxsearch.php?national_search=0&what=${encodeURIComponent(query)}&where=${encodeURIComponent(locSlug)}&catid=0&type=0&lang=1&pagecount=${page}`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'en-IN,en;q=0.9',
        'Referer': 'https://www.justdial.com/',
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': sessionCookie
      },
      timeout: 20000,
      responseType: 'text'
    });

    const html = response.data;
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
    if (!nextDataMatch) throw new Error('JustDial did not return expected data.');

    const nextData = JSON.parse(nextDataMatch[1]);
    const pp = nextData?.props?.pageProps || {};
    const resultsObj = pp.results || {};
    const dataObj = resultsObj.data || {};
    const pageInfo = resultsObj.pageInfo || {};
    const totalCount = pp.count || '';

    // Collect all sections
    const allSections = [];
    Object.values(dataObj).forEach(arr => {
      if (Array.isArray(arr)) allSections.push(...arr);
    });

    // Find listing sections (disptype === 'listing')
    const listingSections = allSections.filter(s => s.disptype === 'listing');
    const leads = [];

    listingSections.forEach(section => {
      const items = Array.isArray(section.data) ? section.data : [];
      items.forEach((item, i) => {
        const name = (item.company_name || item.title || item.name || '').trim();
        if (!name) return;

        let phone = (item.mobile_no || item.phone_no || item.phone || item.contact_no || '').toString().trim();
        phone = phone.replace(/[^0-9+\-\s]/g, '').trim();

        const address = (item.address || item.area || item.locality || '').toString().replace(/\n/g, ', ').trim();
        const category = Array.isArray(item.category) ? item.category.join(', ') : (item.category || item.cat_name || '').toString().trim();
        const rating = (item.rating || item.star_rating || '').toString().replace(/[^0-9.]/g, '').trim();
        const reviews = (item.review_count || item.reviews || '').toString().trim();
        const website = (item.website || item.web_url || '').toString().trim();

        leads.push({
          id: `jd_${i}_${Date.now()}`,
          name,
          phone,
          email: (item.email || '').toString().trim(),
          address,
          city: item.city || loc,
          pincode: (item.pincode || '').toString().trim(),
          category,
          rating,
          reviews,
          website: website.startsWith('http') ? website : '',
          source: 'justdial'
        });
      });
    });

    // JustDial is blocking bot requests via Akamai - no listing sections returned
    if (listingSections.length === 0) {
      throw new Error('JustDial is currently blocking automated requests (Akamai Bot Protection). Please use IndiaMart instead, or try again later.');
    }

    const totalNum = parseInt((totalCount || '').replace(/[^0-9]/g, '')) || leads.length;

    return {
      success: true,
      leads,
      total: totalNum,
      page,
      totalPages: pageInfo.next ? page + 1 : page,
      source: 'justdial',
      url
    };

  } catch (error) {
    console.error('JustDial scrape error:', error.message);
    throw new Error(error.message.includes('blocking') ? error.message : `JustDial scraping failed: ${error.message}`);
  }
};

const scrapeIndiaMart = async ({ query, location, page = 1 }) => {
  let browser;
  try {
    const searchQuery = encodeURIComponent(query);
    const searchLocation = encodeURIComponent(location || '');
    const url = `https://dir.indiamart.com/search.mp?ss=${searchQuery}&src=SEARCHAPP&city=${searchLocation}`;

    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: CHROME_PATH,
      args: LAUNCH_ARGS
    });

    const pg = await browser.newPage();
    await pg.setViewport({ width: 1366, height: 768 });
    await pg.setUserAgent(USER_AGENT);
    await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(3000);

    const html = await pg.content();

    // Extract from __NEXT_DATA__ JSON
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
    if (!nextDataMatch) throw new Error('Could not find __NEXT_DATA__ in page');

    const nextData = JSON.parse(nextDataMatch[1]);
    const searchResponse = nextData?.props?.pageProps?.searchResponse;
    const searchResults = searchResponse?.results || [];
    const total = searchResponse?.total_results || searchResponse?.total_matches || 0;

    const pageSize = 10;
    const start = (page - 1) * pageSize;
    const pageResults = searchResults.slice(start, start + pageSize);

    const leads = [];
    const seen = new Set();

    for (const item of pageResults) {
      const f = item.fields || {};
      const name = (f.companyname || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);

      let phone = '';
      if (f.pns) phone = f.pns.split(',')[0].trim();

      const city = f.city || location || '';
      const state = f.state || '';
      const category = Array.isArray(f.mcatname) ? f.mcatname.join(', ') : '';
      const website = f.catalog_url || f.fcpurl || '';
      const description = f.smalldescorg ? f.smalldescorg.replace(/<[^>]+>/g, '').trim() : '';
      const rating = f.rating_count ? String(f.rating_count) : '';
      const productTitle = f.title || f.original_title || '';
      const memberSince = f.memberSinceDisplay || '';

      leads.push({
        id: `im_${f.displayid || Date.now()}`,
        name,
        phone: phone.replace(/[^0-9+\-\s]/g, '').trim(),
        email: '',
        address: [city, state].filter(Boolean).join(', '),
        city: city.trim(),
        category: category.trim(),
        rating,
        reviews: rating,
        website: website.startsWith('http') ? website : '',
        description: description.substring(0, 200),
        productTitle,
        memberSince,
        source: 'indiamart'
      });
    }

    return {
      success: true,
      leads,
      total,
      page,
      totalPages: Math.ceil(total / pageSize),
      source: 'indiamart',
      url
    };

  } catch (error) {
    console.error('IndiaMart scrape error:', error.message);
    throw new Error(`IndiaMart scraping failed: ${error.message}`);
  } finally {
    if (browser) await browser.close();
  }
};

module.exports = { scrapeJustDial, scrapeIndiaMart };
