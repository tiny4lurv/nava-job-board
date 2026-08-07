/**
 * bootstrap.js — One-shot script that processes all active jobs through
 * Dusk using a hybrid approach:
 *   - Node does the web search + fetch via Brave adapter
 *   - For each job, it builds the prompt and writes it to a per-job file
 *   - A separate invocation of Dusk (me) reads each prompt file, runs the
 *     reasoning, and writes the result
 */

const fs = require('fs');
const path = require('path');
const { getActiveJobs } = require('./fetchSheetData');
const { loadCache, saveCache, generateJobId, generateJobSignature } = require('./jobCache');
const { processOneJob, buildSearchQueries } = require('./duskInterface');
const brave = require('./braveAdapter');

const SHEET_ID = '1Bsm2ceTy3lBq7t7JMOXOEtEBp_gUxkL0d78ZXnGKocs';
const PROMPTS_DIR = path.join(__dirname, '..', '.dusk', 'prompts');
const RESULTS_DIR = path.join(__dirname, '..', '.dusk', 'results');

async function main() {
    if (!fs.existsSync(PROMPTS_DIR)) fs.mkdirSync(PROMPTS_DIR, { recursive: true });
    if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

    console.log('--- Fetching active jobs from Google Sheets ---');
    const allActiveJobs = await getActiveJobs(SHEET_ID, '');
    console.log(`[Google Sheets] Found ${allActiveJobs.length} active roles.`);

    const cache = loadCache();
    const newOrUpdatedJobs = [];
    const finalActiveJobsToPublish = [];
    const activeJobIds = new Set();

    for (const job of allActiveJobs) {
        const id = generateJobId(job);
        const signature = generateJobSignature(job);
        job.id = id;
        job.signature = signature;
        activeJobIds.add(id);

        if (cache[id] && cache[id].signature === signature && cache[id].finalJson) {
            finalActiveJobsToPublish.push(cache[id].finalJson);
        } else {
            newOrUpdatedJobs.push(job);
        }
    }

    console.log(`[Sync] ${newOrUpdatedJobs.length} new/modified jobs to process.`);
    console.log(`[Sync] ${finalActiveJobsToPublish.length} jobs hit cache.`);

    let processed = 0;
    for (const job of newOrUpdatedJobs) {
        const promptFile = path.join(PROMPTS_DIR, `${job.id}.prompt.json`);
        const resultFile = path.join(RESULTS_DIR, `${job.id}.result.json`);

        if (fs.existsSync(resultFile)) {
            continue;
        }

        console.log(`[bootstrap] ${++processed}/${newOrUpdatedJobs.length} — ${job.position} at ${job.facility}...`);

        const queries = buildSearchQueries(job);

        const searchResults = [];
        for (const q of queries) {
            try {
                const hits = await brave.search(q, { count: 5 });
                searchResults.push(...hits.map(h => ({
                    title: h.title,
                    url: h.url,
                    description: h.description,
                })));
            } catch (e) {
                continue;
            }
        }

        const fetchedContent = [];
        for (const hit of searchResults.slice(0, 5)) {
            if (fetchedContent.length >= 2) break;
            if (!hit.url || hit.url.includes('ziprecruiter.com') || hit.url.includes('indeed.com')) {
                continue;
            }
            try {
                const content = await brave.fetchPage(hit.url, { maxChars: 4000 });
                fetchedContent.push({ url: hit.url, content });
            } catch (e) {}
        }

        const promptPayload = {
            job,
            searchResults: searchResults.slice(0, 15),
            fetchedContent,
            preparedAt: new Date().toISOString(),
        };
        fs.writeFileSync(promptFile, JSON.stringify(promptPayload, null, 2));
    }

    console.log(`\n[bootstrap] Done. ${processed} prompts written to ${PROMPTS_DIR}`);
}

main().catch(e => {
    console.error('Bootstrap error:', e);
    process.exit(1);
});
