# SEO AEO GEO Live Checker

A ready-to-run live URL audit tool for checking:

- SEO Audit
- AEO Readiness
- GEO / AI Visibility
- Local SEO Signals
- Schema Check
- Technical / Crawlability
- Priority Recommendations
- AI and search crawler access from robots.txt

## What the tool does

Users enter:

- Page URL
- Target keyword
- Business name
- Primary city
- Page type

The tool crawls the live page, extracts page data, scores each section, and returns recommendations.

## Included checks

### SEO Audit

- Meta title length
- Meta description length
- H1 usage
- H2 structure
- Keyword intent match
- Content depth
- Internal links
- Image alt text
- URL structure
- Placeholder content

### AEO Readiness

- Direct answer opening
- Question-based content
- FAQ section
- Concise answer style
- Search intent coverage
- Snippet-friendly formatting
- Helpful tone

### GEO / AI Visibility

- Business entity clarity
- Service/topic entity clarity
- AI summary readiness
- Trust and E-E-A-T signals
- Originality signals
- Natural language
- AI crawler access
- Location context

### Local SEO Signals

- City in meta title
- City in H1
- NAP signals
- Map/GBP signals
- LocalBusiness or Dentist schema
- Review signals
- Local visit details
- Location-specific content
- Service area signals

### Schema Check

- Schema present
- Valid JSON-LD format
- Correct schema type by page type
- Important schema fields
- FAQ schema match
- BreadcrumbList schema

### Technical / Crawlability

- HTTP status code
- Canonical tag
- Robots meta noindex
- Googlebot crawlability from robots.txt
- Sitemap mention in robots.txt
- Mobile viewport tag
- HTTPS

## Local setup

### 1. Install Node.js

Install Node.js from the official Node.js website.

### 2. Install dependencies

Open terminal inside this project folder and run:

```bash
npm install
```

### 3. Start the tool

```bash
npm start
```

### 4. Open in browser

```text
http://localhost:3000
```

## How to use

1. Enter the page URL.
2. Enter the target keyword.
3. Enter the business name.
4. Enter the primary city.
5. Select page type.
6. Click **Audit Page**.

The tool will show:

- Overall score
- SEO score
- AEO score
- GEO / AI visibility score
- Local SEO score
- Schema score
- Technical score
- Extracted page data
- Priority recommendations
- Detailed checks
- AI/search crawler access

## Deploy on Render

1. Upload this folder to a GitHub repository.
2. Go to Render.
3. Create a new **Web Service**.
4. Connect the GitHub repository.
5. Use these settings:

```text
Build Command: npm install
Start Command: npm start
```

6. Deploy.

Your live URL will look similar to:

```text
https://your-tool-name.onrender.com
```

## Deploy on cPanel Node.js App

1. Upload the folder to your hosting account.
2. Open **Setup Node.js App** in cPanel.
3. Create a new app.
4. Set app root to the uploaded project folder.
5. Set startup file to:

```text
server.js
```

6. Run:

```bash
npm install
```

7. Start the app.

## Important notes

Some websites may block crawlers, return bot protection pages, or rely heavily on JavaScript rendering. This tool uses standard HTML crawling. If you need JavaScript-rendered content, ask your developer to add Puppeteer or Playwright.

This tool is designed for SEO audit assistance. It should not replace manual expert review.
