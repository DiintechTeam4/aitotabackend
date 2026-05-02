const axios = require('axios');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function tryUrl(label, url, headers = {}) {
  try {
    const r = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9',
        'Referer': 'https://www.tradeindia.com/',
        ...headers
      },
      timeout: 15000,
      responseType: 'text'
    });
    const html = r.data;
    const hasND = html.includes('__NEXT_DATA__');
    const hasCompany = html.includes('company_name') || html.includes('companyName') || html.includes('CompanyName');
    const hasMobile = html.includes('mobile') || html.includes('phone') || html.includes('contact');
    console.log(`[${label}] status:${r.status} len:${html.length} NEXT_DATA:${hasND} company:${hasCompany} mobile:${hasMobile}`);

    if (hasND) {
      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
      if (m) {
        try {
          const d = JSON.parse(m[1]);
          const pp = d?.props?.pageProps || {};
          console.log('  pageProps keys:', Object.keys(pp).join(' | '));
        } catch(e) { console.log('  JSON parse err:', e.message); }
      }
    }

    if (!hasND && html.length > 1000) {
      console.log('  HTML sample:', html.substring(0, 300));
    }
  } catch (e) {
    console.log(`[${label}] ERR: ${e.response?.status || ''} ${e.message.substring(0, 80)}`);
  }
}

(async () => {
  await tryUrl('homepage', 'https://www.tradeindia.com/');
  await tryUrl('search_plumber', 'https://www.tradeindia.com/search/?search_string=plumber&city=Mumbai');
  await tryUrl('search_api', 'https://www.tradeindia.com/api/search?q=plumber&city=Mumbai');
  await tryUrl('search_path', 'https://www.tradeindia.com/search/plumber-in-mumbai.html');
  await tryUrl('sellers', 'https://www.tradeindia.com/sellers/plumber/mumbai/');
  await tryUrl('search_q', 'https://www.tradeindia.com/search/?q=plumber&location=Mumbai');
})();
