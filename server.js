const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const helmet = require('helmet');
const robotsParser = require('robots-parser');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const AUDIT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const AI_USER_AGENTS = [
  'Googlebot',
  'Google-Extended',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Perplexity-User',
  'ClaudeBot',
  'Claude-User',
  'Bingbot'
];

app.get('/health', (req, res) => {
  res.json({ ok: true, app: 'SEO AEO GEO Live Checker' });
});

app.post('/audit', async (req, res) => {
  try {
    const input = normalizeInput(req.body);
    validateUrl(input.url);

    const pageResponse = await fetchPage(input.url);
    const html = pageResponse.data;
    const finalUrl = pageResponse.request?.res?.responseUrl || input.url;
    const parsed = parseHtml(html, finalUrl);
    const robots = await analyzeRobots(finalUrl);
    const scores = runAudit(parsed, input, pageResponse.status, robots);

    res.json({
      input,
      url: input.url,
      finalUrl,
      fetchedAt: new Date().toISOString(),
      statusCode: pageResponse.status,
      extracted: parsed,
      robots,
      scores: scores.scores,
      statuses: scores.statuses,
      checks: scores.checks,
      recommendations: scores.recommendations,
      summary: scores.summary
    });
  } catch (error) {
    res.status(500).json({
      error: 'Unable to audit this URL.',
      details: error.message
    });
  }
});

function normalizeInput(body) {
  return {
    url: normalizeUrl(String(body.url || '').trim()),
    targetKeyword: String(body.targetKeyword || '').trim(),
    businessName: String(body.businessName || '').trim(),
    city: String(body.city || '').trim(),
    pageType: String(body.pageType || 'service').trim().toLowerCase()
  };
}

function normalizeUrl(rawUrl) {
  if (!rawUrl) return '';
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  return url;
}

function validateUrl(url) {
  if (!url) throw new Error('Page URL is required.');
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error('Please enter a valid URL, for example https://example.com/');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }
}

async function fetchPage(url) {
  const options = {
    timeout: 30000,
    maxRedirects: 8,
    responseType: 'text',
    maxContentLength: 8 * 1024 * 1024,
    validateStatus: status => status >= 200 && status < 500,
    headers: {
      'User-Agent': AUDIT_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache'
    }
  };

  try {
    const response = await axios.get(url, options);
    if (response.status >= 400) {
      throw new Error(`The page returned HTTP ${response.status}. The URL may be blocked, private, or unavailable.`);
    }
    return response;
  } catch (error) {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') {
      const httpUrl = url.replace(/^https:/i, 'http:');
      try {
        const fallback = await axios.get(httpUrl, options);
        if (fallback.status >= 400) {
          throw new Error(`The page returned HTTP ${fallback.status}.`);
        }
        return fallback;
      } catch (fallbackError) {
        throw explainFetchError(error, url);
      }
    }
    throw explainFetchError(error, url);
  }
}

function explainFetchError(error, url) {
  const code = error.code || '';
  const message = error.message || '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new Error(`Could not reach the domain for ${url}. Check spelling, internet connection, or try with https:// at the beginning.`);
  }
  if (code === 'ECONNABORTED') {
    return new Error('The page took too long to respond. Try again or test a smaller/faster page.');
  }
  if (/403|forbidden/i.test(message)) {
    return new Error('The website blocked the crawler with a 403 Forbidden response. Try another URL or deploy with a browser-based crawler later.');
  }
  if (/certificate|SSL/i.test(message)) {
    return new Error('The website has an SSL/certificate issue, so the page could not be fetched securely.');
  }
  return new Error(`Fetch failed: ${message}`);
}

function parseHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const title = cleanText($('title').first().text());
  const metaDescription = cleanText($('meta[name="description"]').attr('content') || '');
  const canonical = cleanText($('link[rel="canonical"]').attr('href') || '');
  const robotsMeta = cleanText($('meta[name="robots"]').attr('content') || '');
  const viewport = cleanText($('meta[name="viewport"]').attr('content') || '');

  const h1 = $('h1').map((i, el) => cleanText($(el).text())).get().filter(Boolean);
  const h2 = $('h2').map((i, el) => cleanText($(el).text())).get().filter(Boolean);
  const h3 = $('h3').map((i, el) => cleanText($(el).text())).get().filter(Boolean);

  const schemaRaw = $('script[type="application/ld+json"]').map((i, el) => $(el).html()).get().filter(Boolean);
  const schemas = schemaRaw.map(raw => parseSchema(raw));
  const schemaTypes = extractSchemaTypes(schemas);

  const imageItems = $('img').map((i, el) => ({
    src: cleanText($(el).attr('src') || ''),
    alt: cleanText($(el).attr('alt') || '')
  })).get();

  const links = $('a').map((i, el) => cleanText($(el).attr('href') || '')).get().filter(Boolean);
  const pageOrigin = new URL(pageUrl).origin;
  const internalLinks = links.filter(link => isInternalLink(link, pageOrigin));
  const externalLinks = links.filter(link => !isInternalLink(link, pageOrigin) && !link.startsWith('#') && !link.startsWith('tel:') && !link.startsWith('mailto:'));

  $('script, style, noscript, svg, iframe').remove();
  const bodyText = cleanText($('body').text());
  const firstParagraph = cleanText($('p').first().text()) || bodyText.substring(0, 350);

  const visibleFaqSignals = findFaqSignals($, bodyText, h2, h3);
  const socialLinks = links.filter(link => /facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|yelp|healthgrades|zocdoc|google\.com\/maps/i.test(link));

  return {
    title,
    metaDescription,
    canonical,
    robotsMeta,
    viewport,
    h1,
    h2,
    h3,
    wordCount: countWords(bodyText),
    bodyTextSample: bodyText.substring(0, 1200),
    firstParagraph,
    images: {
      total: imageItems.length,
      withAlt: imageItems.filter(img => img.alt.length > 0).length,
      missingAlt: imageItems.filter(img => img.alt.length === 0).slice(0, 20)
    },
    links: {
      total: links.length,
      internal: internalLinks.length,
      external: externalLinks.length,
      social: socialLinks.length
    },
    schema: {
      count: schemaRaw.length,
      types: schemaTypes,
      validCount: schemas.filter(s => s.valid).length,
      invalidCount: schemas.filter(s => !s.valid).length,
      rawSample: schemaRaw.join('\n').substring(0, 2000)
    },
    faqSignals: visibleFaqSignals,
    pageSignals: detectPageSignals(bodyText, links, schemaRaw.join(' '))
  };
}

function parseSchema(raw) {
  try {
    return { valid: true, data: JSON.parse(raw), error: '' };
  } catch (error) {
    return { valid: false, data: null, error: error.message };
  }
}

function extractSchemaTypes(schemas) {
  const types = new Set();
  schemas.forEach(schema => {
    if (!schema.valid || !schema.data) return;
    collectTypes(schema.data, types);
  });
  return Array.from(types);
}

function collectTypes(value, types) {
  if (Array.isArray(value)) {
    value.forEach(item => collectTypes(item, types));
    return;
  }
  if (value && typeof value === 'object') {
    if (value['@type']) {
      if (Array.isArray(value['@type'])) value['@type'].forEach(t => types.add(String(t)));
      else types.add(String(value['@type']));
    }
    if (value['@graph']) collectTypes(value['@graph'], types);
    Object.keys(value).forEach(key => {
      if (key !== '@graph') collectTypes(value[key], types);
    });
  }
}

function isInternalLink(link, origin) {
  if (!link) return false;
  if (link.startsWith('#') || link.startsWith('tel:') || link.startsWith('mailto:')) return true;
  try {
    const u = new URL(link, origin);
    return u.origin === origin;
  } catch {
    return false;
  }
}

async function analyzeRobots(pageUrl) {
  const parsedUrl = new URL(pageUrl);
  const robotsUrl = `${parsedUrl.origin}/robots.txt`;
  const result = {
    robotsUrl,
    available: false,
    sitemapMentions: [],
    userAgents: [],
    error: ''
  };

  try {
    const response = await axios.get(robotsUrl, {
      timeout: 10000,
      headers: { 'User-Agent': AUDIT_USER_AGENT },
      validateStatus: status => status >= 200 && status < 500
    });

    if (response.status !== 200) {
      result.error = `robots.txt returned ${response.status}`;
      return result;
    }

    result.available = true;
    const robotsTxt = String(response.data || '');
    const parser = robotsParser(robotsUrl, robotsTxt);
    result.sitemapMentions = robotsTxt.split('\n')
      .filter(line => /^sitemap:/i.test(line.trim()))
      .map(line => line.replace(/^sitemap:/i, '').trim());

    result.userAgents = AI_USER_AGENTS.map(agent => ({
      agent,
      allowed: parser.isAllowed(pageUrl, agent) !== false
    }));
  } catch (error) {
    result.error = error.message;
  }

  return result;
}

function runAudit(parsed, input, statusCode, robots) {
  const checks = {
    seo: [],
    aeo: [],
    geo: [],
    local: [],
    schema: [],
    technical: []
  };
  const recommendations = [];
  const fullText = [parsed.title, parsed.metaDescription, ...parsed.h1, ...parsed.h2, ...parsed.h3, parsed.bodyTextSample].join(' ').toLowerCase();
  const keyword = input.targetKeyword.toLowerCase();
  const businessName = input.businessName.toLowerCase();
  const city = input.city.toLowerCase();
  const schemaTypes = parsed.schema.types.map(t => t.toLowerCase());

  let seo = 0;
  let aeo = 0;
  let geo = 0;
  let local = 0;
  let schema = 0;
  let technical = 0;

  // SEO - 25
  seo += addCheck(checks.seo, recommendations, lengthCheck(parsed.title.length, 40, 60), 3, 'Meta title length', `Title length is ${parsed.title.length} characters.`, 'Rewrite the meta title to 40-60 characters.', 'high');
  seo += addCheck(checks.seo, recommendations, lengthCheck(parsed.metaDescription.length, 140, 160), 3, 'Meta description length', `Description length is ${parsed.metaDescription.length} characters.`, 'Rewrite the meta description to 140-160 characters.', 'high');
  seo += addCheck(checks.seo, recommendations, exactOne(parsed.h1.length), 3, 'H1 tag usage', `${parsed.h1.length} H1 tag(s) found.`, parsed.h1.length === 0 ? 'Add one clear H1 tag.' : 'Use only one main H1 tag on the page.', 'high');
  seo += addCheck(checks.seo, recommendations, parsed.h2.length >= 2 ? 'pass' : parsed.h2.length === 1 ? 'warning' : 'fail', 3, 'Heading structure', `${parsed.h2.length} H2 tag(s) found.`, 'Add useful H2 headings to cover important subtopics and questions.', 'medium');
  seo += addCheck(checks.seo, recommendations, keywordMatch(fullText, keyword), 3, 'Keyword intent match', keyword ? `Target keyword: ${input.targetKeyword}` : 'No target keyword entered.', 'Use the target keyword or a natural variation in the title, H1, introduction, and body.', 'high');
  seo += addCheck(checks.seo, recommendations, wordDepth(parsed.wordCount, input.pageType), 3, 'Content depth', `Word count is ${parsed.wordCount}.`, 'Expand the page with original, useful, intent-matched content.', 'high');
  seo += addCheck(checks.seo, recommendations, parsed.links.internal >= 5 ? 'pass' : parsed.links.internal >= 2 ? 'warning' : 'fail', 2, 'Internal links', `${parsed.links.internal} internal link(s) found.`, 'Add internal links to related services, locations, FAQs, and contact pages.', 'medium');
  const altRatio = parsed.images.total === 0 ? 1 : parsed.images.withAlt / parsed.images.total;
  seo += addCheck(checks.seo, recommendations, altRatio >= 0.7 ? 'pass' : altRatio >= 0.4 ? 'warning' : 'fail', 2, 'Image alt text', `${parsed.images.withAlt}/${parsed.images.total} images have alt text.`, 'Add descriptive alt text to important images.', 'low');
  seo += addCheck(checks.seo, recommendations, cleanUrlCheck(input.url), 2, 'URL structure', 'URL is checked for readability and excessive parameters.', 'Use a short, readable, topic-relevant URL slug.', 'low');
  seo += addCheck(checks.seo, recommendations, hasAny(fullText, ['lorem ipsum', 'dummy text', 'placeholder']) ? 'fail' : 'pass', 1, 'Placeholder content', 'Checked for obvious placeholder text.', 'Remove placeholder content and replace it with original copy.', 'high');

  // AEO - 20
  aeo += addCheck(checks.aeo, recommendations, directAnswerCheck(parsed.firstParagraph), 4, 'Direct answer opening', `Opening paragraph length is ${parsed.firstParagraph.length} characters.`, 'Add a direct answer in the first 1-2 paragraphs.', 'high');
  const questionSignals = countQuestions([...parsed.h2, ...parsed.h3].join(' ') + ' ' + parsed.bodyTextSample);
  aeo += addCheck(checks.aeo, recommendations, questionSignals >= 3 ? 'pass' : questionSignals >= 1 ? 'warning' : 'fail', 3, 'Question-based content', `${questionSignals} question signal(s) found.`, 'Add question-based headings such as What, How, When, Why, Is, or Can.', 'medium');
  aeo += addCheck(checks.aeo, recommendations, parsed.faqSignals.hasFaq ? 'pass' : 'fail', 3, 'FAQ section', parsed.faqSignals.hasFaq ? 'FAQ signals found.' : 'No clear FAQ section found.', 'Add 4-6 helpful FAQs based on real user questions.', 'high');
  aeo += addCheck(checks.aeo, recommendations, averageSentenceLength(parsed.bodyTextSample) <= 24 ? 'pass' : averageSentenceLength(parsed.bodyTextSample) <= 32 ? 'warning' : 'fail', 3, 'Concise answer style', `Average sentence length is ${Math.round(averageSentenceLength(parsed.bodyTextSample))} words.`, 'Use shorter sentences and direct answer-style paragraphs.', 'medium');
  aeo += addCheck(checks.aeo, recommendations, intentCoverageCheck(fullText), 3, 'Search intent coverage', 'Checked for informational, service, and next-step language.', 'Cover what the service is, who needs it, how it works, and when to act.', 'medium');
  aeo += addCheck(checks.aeo, recommendations, snippetFormattingCheck(parsed.bodyTextSample, parsed.h2.length, parsed.h3.length), 2, 'Snippet-friendly formatting', 'Checked headings, lists, and answer structure.', 'Add lists, short summaries, tables, or step-style sections where helpful.', 'low');
  aeo += addCheck(checks.aeo, recommendations, hasAny(fullText, ['best ever', 'guaranteed', 'cheap', 'number one', '#1']) ? 'warning' : 'pass', 2, 'Helpful tone', 'Checked for obvious over-promotional language.', 'Replace promotional wording with helpful, factual explanations.', 'medium');

  // GEO / AI - 20
  geo += addCheck(checks.geo, recommendations, businessName ? keywordMatch(fullText, businessName) : 'warning', 4, 'Business entity clarity', businessName ? `Business name: ${input.businessName}` : 'No business name entered.', 'Mention the business name naturally where appropriate.', 'medium');
  geo += addCheck(checks.geo, recommendations, keyword ? keywordMatch(fullText, keyword) : 'warning', 3, 'Service or topic entity', keyword ? `Topic/keyword: ${input.targetKeyword}` : 'No target keyword entered.', 'Make the main service, topic, or entity easier for AI systems to identify.', 'high');
  geo += addCheck(checks.geo, recommendations, hasAny(fullText, ['summary', 'overview', 'explained', 'includes', 'means', 'in short']) ? 'pass' : 'warning', 3, 'AI summary readiness', 'Checked for summary-style language.', 'Add short summary paragraphs that clearly explain the page topic.', 'medium');
  geo += addCheck(checks.geo, recommendations, trustSignalCheck(fullText), 3, 'Trust and E-E-A-T signals', 'Checked for team, provider, patient, review, and experience signals.', 'Add provider, team, patient care, review, or experience signals.', 'medium');
  geo += addCheck(checks.geo, recommendations, hasAny(fullText, ['copy and paste', 'same content', 'template', 'lorem ipsum']) ? 'fail' : 'pass', 2, 'Originality signal', 'Checked for obvious template or duplicate wording signals.', 'Rewrite generic sections with page-specific details.', 'high');
  geo += addCheck(checks.geo, recommendations, keywordStuffingCheck(fullText, keyword) ? 'warning' : 'pass', 2, 'Natural language', 'Checked rough keyword repetition density.', 'Reduce repeated keyword usage and use natural variations.', 'high');
  const aiBlocked = robots.userAgents.filter(item => item.allowed === false);
  geo += addCheck(checks.geo, recommendations, aiBlocked.length === 0 ? 'pass' : 'warning', 2, 'AI and search crawler access', aiBlocked.length ? `${aiBlocked.map(i => i.agent).join(', ')} appear blocked.` : 'No checked AI/search bots appear blocked.', 'Review robots.txt rules for Googlebot, GPTBot, OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot, and Google-Extended.', 'medium');
  geo += addCheck(checks.geo, recommendations, city ? keywordMatch(fullText, city) : 'warning', 1, 'Location context', city ? `City: ${input.city}` : 'No city entered.', 'Add natural city or service area context where relevant.', 'low');

  // Local - 15
  local += addCheck(checks.local, recommendations, city ? textIncludes(parsed.title, city) : 'warning', 2, 'City in meta title', city ? `City: ${input.city}` : 'No city entered.', 'Use the primary city in the meta title if this is a local page.', 'medium');
  local += addCheck(checks.local, recommendations, city ? textIncludes(parsed.h1.join(' '), city) : 'warning', 2, 'City in H1', city ? `City: ${input.city}` : 'No city entered.', 'Use the primary city in the H1 when relevant.', 'medium');
  local += addCheck(checks.local, recommendations, parsed.pageSignals.hasNap ? 'pass' : 'fail', 2, 'NAP signals', 'Checked for address, phone, street, postal, and location words.', 'Add consistent business name, address, and phone number details.', 'high');
  local += addCheck(checks.local, recommendations, parsed.pageSignals.hasMap ? 'pass' : 'warning', 2, 'Map or GBP signal', 'Checked for map, directions, GBP, and Google Maps signals.', 'Add a map, directions, or Google Business Profile link where appropriate.', 'medium');
  local += addCheck(checks.local, recommendations, schemaTypes.some(t => ['localbusiness', 'dentist', 'medicalbusiness', 'postaladdress'].includes(t)) ? 'pass' : 'fail', 2, 'LocalBusiness schema', schemaTypes.join(', ') || 'No schema type detected.', 'Add LocalBusiness or Dentist schema with address, phone, hours, URL, and sameAs links.', 'high');
  local += addCheck(checks.local, recommendations, parsed.pageSignals.hasReviews ? 'pass' : 'warning', 1, 'Review signals', 'Checked review, rating, testimonial, and patient trust language.', 'Add visible review or testimonial references if accurate and allowed.', 'low');
  local += addCheck(checks.local, recommendations, parsed.pageSignals.hasVisitDetails ? 'pass' : 'warning', 1, 'Local visit details', 'Checked for parking, nearby, located, directions, neighborhood, and community details.', 'Add useful local details such as nearby areas, parking, directions, or neighborhood context.', 'low');
  local += addCheck(checks.local, recommendations, city && fullText.includes(city) && parsed.wordCount >= 500 ? 'pass' : 'warning', 2, 'Location-specific content', `Word count is ${parsed.wordCount}.`, 'Add unique local details instead of generic city-swap content.', 'medium');
  local += addCheck(checks.local, recommendations, parsed.pageSignals.hasServiceAreas ? 'pass' : 'warning', 1, 'Service area/internal local signal', 'Checked nearby areas, service areas, locations, and neighborhoods.', 'Add links or text references to related service area or location pages.', 'low');

  // Schema - 10
  schema += addCheck(checks.schema, recommendations, parsed.schema.count > 0 ? 'pass' : 'fail', 2, 'Schema present', `${parsed.schema.count} JSON-LD block(s) found.`, 'Add relevant JSON-LD schema based on page type.', 'high');
  schema += addCheck(checks.schema, recommendations, parsed.schema.validCount === parsed.schema.count && parsed.schema.count > 0 ? 'pass' : parsed.schema.count > 0 ? 'warning' : 'fail', 2, 'Valid schema format', `${parsed.schema.validCount}/${parsed.schema.count} schema block(s) parsed successfully.`, 'Fix invalid JSON-LD and include @context and @type.', 'high');
  schema += addCheck(checks.schema, recommendations, schemaTypeMatches(input.pageType, schemaTypes) ? 'pass' : 'warning', 2, 'Correct schema type', schemaTypes.join(', ') || 'No schema types found.', 'Use schema that matches the page type: Service, FAQPage, BlogPosting, BreadcrumbList, Organization, LocalBusiness, or Dentist.', 'medium');
  schema += addCheck(checks.schema, recommendations, schemaRequiredFieldsCheck(parsed.schema.rawSample) ? 'pass' : 'warning', 2, 'Important schema fields', 'Checked for name, URL, image, telephone, address, and description fields.', 'Add important schema fields such as name, URL, image, description, telephone, and address.', 'medium');
  schema += addCheck(checks.schema, recommendations, schemaTypes.includes('faqpage') && parsed.faqSignals.hasFaq ? 'pass' : schemaTypes.includes('faqpage') ? 'warning' : 'warning', 1, 'FAQ schema match', schemaTypes.includes('faqpage') ? 'FAQPage schema detected.' : 'FAQPage schema not detected.', schemaTypes.includes('faqpage') ? 'Make sure FAQ schema matches visible page FAQs.' : 'Add FAQPage schema when visible FAQs are present.', schemaTypes.includes('faqpage') ? 'high' : 'low');
  schema += addCheck(checks.schema, recommendations, schemaTypes.includes('breadcrumblist') ? 'pass' : 'warning', 1, 'Breadcrumb schema', schemaTypes.includes('breadcrumblist') ? 'BreadcrumbList found.' : 'BreadcrumbList not found.', 'Add BreadcrumbList schema to support page hierarchy.', 'low');

  // Technical - 10
  technical += addCheck(checks.technical, recommendations, statusCode === 200 ? 'pass' : 'fail', 2, 'HTTP status code', `Status code is ${statusCode}.`, 'Fix the page so it returns a 200 OK status code.', 'high');
  technical += addCheck(checks.technical, recommendations, parsed.canonical ? 'pass' : 'warning', 1, 'Canonical tag', parsed.canonical || 'No canonical tag found.', 'Add a correct self-referencing canonical tag.', 'low');
  const noindex = /noindex/i.test(parsed.robotsMeta);
  technical += addCheck(checks.technical, recommendations, noindex ? 'fail' : 'pass', 2, 'Indexability', parsed.robotsMeta || 'No robots meta noindex found.', 'Remove noindex if this page should rank in search results.', 'high');
  const googleAllowed = robots.userAgents.find(item => item.agent === 'Googlebot')?.allowed !== false;
  technical += addCheck(checks.technical, recommendations, googleAllowed ? 'pass' : 'fail', 2, 'Robots.txt search crawlability', googleAllowed ? 'Googlebot appears allowed.' : 'Googlebot appears blocked.', 'Review robots.txt rules to ensure important pages are crawlable.', 'high');
  technical += addCheck(checks.technical, recommendations, robots.sitemapMentions.length > 0 ? 'pass' : 'warning', 1, 'XML sitemap signal', robots.sitemapMentions.length ? `${robots.sitemapMentions.length} sitemap mention(s) found.` : 'No sitemap mention found in robots.txt.', 'Make sure the page is included in the XML sitemap.', 'low');
  technical += addCheck(checks.technical, recommendations, parsed.viewport ? 'pass' : 'warning', 1, 'Mobile viewport', parsed.viewport || 'No viewport tag found.', 'Add a mobile viewport tag and confirm responsive rendering.', 'low');
  technical += addCheck(checks.technical, recommendations, input.url.startsWith('https://') ? 'pass' : 'fail', 1, 'HTTPS', input.url.startsWith('https://') ? 'HTTPS is used.' : 'HTTP is used.', 'Use HTTPS for the page.', 'high');

  const scores = {
    seo: Math.round(seo),
    aeo: Math.round(aeo),
    geo: Math.round(geo),
    local: Math.round(local),
    schema: Math.round(schema),
    technical: Math.round(technical)
  };
  scores.total = scores.seo + scores.aeo + scores.geo + scores.local + scores.schema + scores.technical;

  return {
    scores,
    statuses: {
      seo: statusByPercent(scores.seo / 25 * 100),
      aeo: statusByPercent(scores.aeo / 20 * 100),
      geo: statusByPercent(scores.geo / 20 * 100),
      local: statusByPercent(scores.local / 15 * 100),
      schema: statusByPercent(scores.schema / 10 * 100),
      technical: statusByPercent(scores.technical / 10 * 100),
      total: statusByPercent(scores.total)
    },
    checks,
    recommendations: uniqueRecommendations(recommendations),
    summary: summaryText(scores.total)
  };
}

function addCheck(group, recommendations, status, points, title, detail, recommendation, priority) {
  let earned = 0;
  if (status === 'pass') earned = points;
  else if (status === 'warning') earned = points * 0.5;
  group.push({ status, title, detail, points: Math.round(earned * 10) / 10, maxPoints: points, recommendation });
  if (status !== 'pass' && recommendation) recommendations.push({ priority, recommendation });
  return earned;
}

function lengthCheck(length, min, max) {
  if (length >= min && length <= max) return 'pass';
  if ((length >= min - 20 && length < min) || (length > max && length <= max + 15)) return 'warning';
  return 'fail';
}

function exactOne(count) {
  if (count === 1) return 'pass';
  if (count > 1) return 'warning';
  return 'fail';
}

function keywordMatch(text, keyword) {
  if (!keyword) return 'warning';
  if (text.includes(keyword)) return 'pass';
  const parts = keyword.split(/\s+/).filter(w => w.length > 2);
  const found = parts.filter(w => text.includes(w)).length;
  if (found >= Math.ceil(parts.length / 2)) return 'warning';
  return 'fail';
}

function wordDepth(wordCount, pageType) {
  const required = requiredWords(pageType);
  if (wordCount >= required) return 'pass';
  if (wordCount >= required * 0.7) return 'warning';
  return 'fail';
}

function requiredWords(pageType) {
  if (pageType === 'blog') return 900;
  if (pageType === 'location') return 600;
  if (pageType === 'homepage') return 500;
  return 700;
}

function cleanUrlCheck(url) {
  try {
    const u = new URL(url);
    if (u.search.length > 80) return 'warning';
    if (u.pathname.length > 90) return 'warning';
    return 'pass';
  } catch {
    return 'warning';
  }
}

function directAnswerCheck(text) {
  if (!text) return 'fail';
  if (text.length >= 80 && text.length <= 400) return 'pass';
  if (text.length >= 50 && text.length <= 550) return 'warning';
  return 'fail';
}

function intentCoverageCheck(text) {
  const groups = [
    ['what', 'means', 'is', 'are'],
    ['how', 'process', 'works', 'treatment'],
    ['when', 'should', 'need', 'signs'],
    ['call', 'schedule', 'contact', 'appointment', 'visit']
  ];
  const hits = groups.filter(group => group.some(term => text.includes(term))).length;
  if (hits >= 3) return 'pass';
  if (hits >= 2) return 'warning';
  return 'fail';
}

function snippetFormattingCheck(text, h2Count, h3Count) {
  const hasList = /\n\s*[-*]|\b1\.|\b2\.|\b3\.|:/.test(text);
  if ((h2Count + h3Count >= 4) && hasList) return 'pass';
  if (h2Count + h3Count >= 2 || hasList) return 'warning';
  return 'fail';
}

function trustSignalCheck(text) {
  const terms = ['experience', 'experienced', 'team', 'doctor', 'dentist', 'provider', 'patients', 'reviews', 'testimonials', 'licensed', 'certified', 'credentials'];
  const count = terms.filter(term => text.includes(term)).length;
  if (count >= 3) return 'pass';
  if (count >= 1) return 'warning';
  return 'fail';
}

function schemaTypeMatches(pageType, schemaTypes) {
  if (pageType === 'blog') return schemaTypes.some(t => ['blogposting', 'article'].includes(t));
  if (pageType === 'service') return schemaTypes.some(t => ['service', 'localbusiness', 'dentist', 'webpage'].includes(t));
  if (pageType === 'location') return schemaTypes.some(t => ['localbusiness', 'dentist', 'medicalbusiness', 'postaladdress'].includes(t));
  if (pageType === 'homepage') return schemaTypes.some(t => ['organization', 'localbusiness', 'website'].includes(t));
  return false;
}

function schemaRequiredFieldsCheck(raw) {
  const lower = String(raw || '').toLowerCase();
  const fields = ['name', 'url', 'image', 'telephone', 'address', 'description'];
  return fields.filter(field => lower.includes(`"${field}"`)).length >= 3;
}

function detectPageSignals(text, links, schemaText) {
  const lower = `${text} ${links.join(' ')} ${schemaText}`.toLowerCase();
  return {
    hasNap: /address|phone|telephone|call|suite|street|road|avenue|blvd|drive|zip|postal|\(\d{3}\)|\d{3}[-.\s]\d{3}[-.\s]\d{4}/i.test(lower),
    hasMap: /google map|maps\.google|map|directions|google business profile|gbp/i.test(lower),
    hasReviews: /review|reviews|testimonial|testimonials|rating|patients say/i.test(lower),
    hasVisitDetails: /parking|nearby|located|directions|neighborhood|community|serving/i.test(lower),
    hasServiceAreas: /nearby areas|service areas|locations|also serving|neighborhoods|serving/i.test(lower)
  };
}

function findFaqSignals($, bodyText, h2, h3) {
  const headingText = [...h2, ...h3].join(' ').toLowerCase();
  const lower = bodyText.toLowerCase();
  return {
    hasFaq: lower.includes('frequently asked questions') || /\bfaq\b/i.test(lower) || headingText.includes('faq'),
    questionMarks: (bodyText.match(/\?/g) || []).length
  };
}

function hasAny(text, terms) {
  const lower = String(text || '').toLowerCase();
  return terms.some(term => lower.includes(String(term).toLowerCase()));
}

function textIncludes(text, term) {
  return String(text || '').toLowerCase().includes(String(term || '').toLowerCase()) ? 'pass' : 'warning';
}

function countWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

function countQuestions(text) {
  const lower = String(text || '').toLowerCase();
  let count = (lower.match(/\?/g) || []).length;
  ['what', 'how', 'when', 'why', 'where', 'who', 'can', 'should', 'is', 'are', 'do', 'does'].forEach(word => {
    const matches = lower.match(new RegExp(`\\b${word}\\b`, 'g'));
    if (matches) count += matches.length;
  });
  return count;
}

function averageSentenceLength(text) {
  const clean = String(text || '');
  const sentences = clean.split(/[.!?]+/).filter(Boolean);
  const words = countWords(clean);
  return sentences.length ? words / sentences.length : words;
}

function keywordStuffingCheck(text, keyword) {
  if (!keyword) return false;
  const cleanKeyword = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = String(text || '').match(new RegExp(cleanKeyword, 'g')) || [];
  const words = countWords(text);
  return words > 0 && matches.length / words > 0.04;
}

function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function statusByPercent(percent) {
  if (percent >= 90) return { label: 'Excellent', className: 'excellent' };
  if (percent >= 75) return { label: 'Strong', className: 'strong' };
  if (percent >= 60) return { label: 'Needs Improvement', className: 'improve' };
  if (percent >= 40) return { label: 'Weak', className: 'weak' };
  return { label: 'Critical', className: 'critical' };
}

function summaryText(score) {
  if (score >= 90) return 'This page is well optimized for SEO, AEO, GEO, local visibility, schema, and technical crawlability.';
  if (score >= 75) return 'This page has a strong foundation but can improve with better answer formatting, schema, local signals, and AI visibility enhancements.';
  if (score >= 60) return 'This page has several SEO, AEO, GEO, or local SEO gaps that should be improved for stronger visibility.';
  if (score >= 40) return 'This page needs major improvements before it can perform well in traditional search or AI-driven answer results.';
  return 'This page has serious content, crawlability, schema, or local SEO issues that should be fixed first.';
}

function uniqueRecommendations(items) {
  const seen = new Set();
  const order = { high: 1, medium: 2, low: 3 };
  return items
    .filter(item => {
      if (seen.has(item.recommendation)) return false;
      seen.add(item.recommendation);
      return true;
    })
    .sort((a, b) => order[a.priority] - order[b.priority]);
}

app.listen(PORT, () => {
  console.log(`SEO AEO GEO Live Checker running at http://localhost:${PORT}`);
});
