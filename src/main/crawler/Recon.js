'use strict';

/**
 * Recon — passive intelligence & security analysis of a fetched page.
 *
 * This is the "white-hat" layer: it never sends extra requests or attacks
 * anything. It only inspects content that was already retrieved, surfacing data
 * useful for authorized reconnaissance, attack-surface mapping, and defensive
 * audits:
 *
 *   - extractIntel()    : emails, phones, secrets/API keys, social links,
 *                         API endpoints, and noteworthy HTML comments.
 *   - auditSecurity()   : missing security headers + cookie-flag issues.
 *   - fingerprintTech() : server / framework / CMS detection.
 *
 * Findings are passive observations, not exploits. Use only on targets you are
 * authorized to assess (see GRAND_RULES.md / DISCLAIMER.md).
 */

const { URL } = require('url');

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}\b/g;
const EMAIL_REJECT = /\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ttf)$/i;
const PHONE_RE = /(?:tel:)?\+\d[\d\s().-]{6,16}\d/g;
const COMMENT_RE = /<!--([\s\S]*?)-->/g;
const COMMENT_INTEREST = /(todo|fixme|hack|password|passwd|secret|api[_-]?key|token|bug|debug|deprecated|note:|http:\/\/|https:\/\/|username|credential)/i;
const ENDPOINT_RE = /["'`](https?:\/\/[^"'`\s]{6,200}|\/(?:api|v\d+|graphql|rest|wp-json|oauth|auth|admin)[^"'`\s]{0,200})["'`]/gi;

// (label, regex) pairs. Group 1 is captured when present, else the whole match.
const SECRET_PATTERNS = [
  ['AWS Access Key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['AWS Secret', /\baws_secret_access_key["'\s:=]{1,4}["']([0-9A-Za-z/+=]{40})["']/gi],
  ['Google API Key', /\bAIza[0-9A-Za-z\-_]{35}\b/g],
  ['Slack Token', /\bxox[baprs]-[0-9A-Za-z-]{10,48}\b/g],
  ['GitHub Token', /\bgh[pousr]_[0-9A-Za-z]{36,255}\b/g],
  ['Stripe Key', /\bsk_(?:live|test)_[0-9A-Za-z]{16,99}\b/g],
  ['Twilio SID', /\bAC[0-9a-fA-F]{32}\b/g],
  ['Mailgun Key', /\bkey-[0-9a-zA-Z]{32}\b/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ['Private Key Block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g],
  ['Generic Secret', /(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token|client[_-]?secret|passwd|password)["'\s:=]{1,4}["']([0-9A-Za-z\-_./+=]{12,64})["']/gi],
];

const SOCIAL_HOSTS = new Set([
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'linkedin.com',
  'github.com', 'gitlab.com', 'youtube.com', 'youtu.be', 't.me', 'tiktok.com',
  'reddit.com', 'medium.com', 'discord.gg', 'discord.com', 'mastodon.social',
  'pinterest.com', 'twitch.tv', 'vimeo.com',
]);

const SECURITY_HEADERS = [
  'content-security-policy',
  'strict-transport-security',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
];

const TECH_SIGNATURES = [
  [/wp-content|wp-json|wp-includes/i, 'WordPress'],
  [/\/_next\/|__NEXT_DATA__/i, 'Next.js'],
  [/\/_nuxt\//i, 'Nuxt.js'],
  [/data-reactroot|react(?:-dom)?(?:\.production)?\.min/i, 'React'],
  [/ng-version=/i, 'Angular'],
  [/data-v-[0-9a-f]{8}|vue(?:\.runtime)?(?:\.min)?\.js/i, 'Vue.js'],
  [/sites\/(?:default|all)\/|Drupal\.settings/i, 'Drupal'],
  [/com_content|\/media\/jui\/|Joomla/i, 'Joomla'],
  [/cdn\.shopify\.com|Shopify\.theme/i, 'Shopify'],
  [/gatsby-/i, 'Gatsby'],
  [/jquery(?:-|\.min|\.slim)/i, 'jQuery'],
  [/bootstrap(?:\.min)?\.(?:css|js)/i, 'Bootstrap'],
  [/wixstatic\.com|X-Wix-/i, 'Wix'],
  [/static\.squarespace\.com/i, 'Squarespace'],
  [/cloudflareinsights|__cf/i, 'Cloudflare'],
];

/** Extract passive intelligence from a page's raw HTML and discovered links. */
function extractIntel(html, links = []) {
  const text = html || '';

  const emails = new Set();
  for (const m of text.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase();
    if (e.length < 100 && !EMAIL_REJECT.test(e) && !/@\d/.test(e)) emails.add(e);
  }

  const phones = new Set();
  for (const m of text.matchAll(PHONE_RE)) phones.add(m[0].replace(/^tel:/, '').trim());

  const secrets = [];
  for (const [type, re] of SECRET_PATTERNS) {
    for (const m of text.matchAll(re)) {
      secrets.push({ type, value: m[1] || m[0] });
      if (secrets.length >= 300) break;
    }
  }

  const endpoints = new Set();
  for (const m of text.matchAll(ENDPOINT_RE)) {
    endpoints.add(m[1]);
    if (endpoints.size >= 800) break;
  }

  const comments = [];
  for (const m of text.matchAll(COMMENT_RE)) {
    const c = m[1].trim().replace(/\s+/g, ' ');
    if (c && c.length <= 400 && COMMENT_INTEREST.test(c)) comments.push(c);
    if (comments.length >= 150) break;
  }

  const socials = new Set();
  for (const link of links) {
    try {
      const host = new URL(link).hostname.replace(/^www\./, '');
      if (SOCIAL_HOSTS.has(host)) socials.add(link);
    } catch {
      /* skip */
    }
  }

  return {
    emails: [...emails],
    phones: [...phones],
    secrets,
    endpoints: [...endpoints],
    comments,
    socials: [...socials],
  };
}

/** Detect server / framework / CMS from headers, meta, and HTML signatures. */
function fingerprintTech(headers = {}, meta = {}, html = '') {
  const tech = new Set();
  if (headers.server) tech.add(`Server: ${headers.server}`);
  if (headers['x-powered-by']) tech.add(`X-Powered-By: ${headers['x-powered-by']}`);
  if (headers['x-aspnet-version']) tech.add(`ASP.NET ${headers['x-aspnet-version']}`);
  if (headers['x-generator']) tech.add(headers['x-generator']);
  if (headers['cf-ray']) tech.add('Cloudflare');
  if (meta && meta.generator) tech.add(meta.generator);
  for (const [re, name] of TECH_SIGNATURES) {
    if (re.test(html)) tech.add(name);
  }
  return [...tech];
}

/** Audit response headers + cookies for common security misconfigurations. */
function auditSecurity(headers = {}, meta = {}, finalUrl = '', html = '') {
  const present = {};
  const missing = [];
  for (const h of SECURITY_HEADERS) {
    if (headers[h]) present[h] = headers[h];
    else missing.push(h);
  }

  const cookieIssues = [];
  const setCookie = headers['set-cookie'];
  if (setCookie) {
    if (!/httponly/i.test(setCookie)) cookieIssues.push('Set-Cookie missing HttpOnly');
    if (!/;\s*secure/i.test(setCookie)) cookieIssues.push('Set-Cookie missing Secure');
    if (!/samesite/i.test(setCookie)) cookieIssues.push('Set-Cookie missing SameSite');
  }

  return {
    url: finalUrl,
    https: /^https:/i.test(finalUrl),
    missingHeaders: missing,
    presentHeaders: present,
    cookieIssues,
    tech: fingerprintTech(headers, meta, html),
  };
}

module.exports = { extractIntel, auditSecurity, fingerprintTech };
