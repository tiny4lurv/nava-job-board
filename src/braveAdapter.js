/**
 * braveAdapter.js — Thin Node wrapper around Brave Search API.
 *
 * Reads BRAVE_API_KEY from .env. Exposes search(query, opts) and fetchPage(url).
 * Names are deliberately different (search/fetchPage) to avoid shadowing Node's
 * built-in global fetch.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

async function search(query, opts = {}) {
    const count = opts.count || 5;
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
        throw new Error('BRAVE_API_KEY not set in .env');
    }
    const url = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}&count=${count}`;
    const res = await globalThis.fetch(url, {
        headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': apiKey,
        },
    });
    if (!res.ok) {
        throw new Error(`Brave search ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    return (data.web && data.web.results) || [];
}

async function fetchPage(url, opts = {}) {
    const maxChars = opts.maxChars || 5000;
    const res = await globalThis.fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
    });
    if (!res.ok) {
        throw new Error(`Fetch ${res.status}: ${url}`);
    }
    const text = await res.text();
    return text.length > maxChars ? text.substring(0, maxChars) : text;
}

module.exports = { search, fetchPage };
