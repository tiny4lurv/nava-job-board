/**
 * dryRun.js — Test helper: fetch active jobs, identify new/modified ones,
 * write the delta to new_jobs_for_dusk.json. Does NOT process them.
 *
 * Usage: node src/dryRun.js
 */

const fs = require('fs');
const path = require('path');
const { getActiveJobs } = require('./fetchSheetData');
const { loadCache, saveCache, generateJobId, generateJobSignature } = require('./jobCache');

const SHEET_ID = '1Bsm2ceTy3lBq7t7JMOXOEtEBp_gUxkL0d78ZXnGKocs';
const OUTPUT_FILE = path.join(__dirname, '..', 'new_jobs_for_dusk.json');

async function main() {
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

    console.log(`[Sync] ${newOrUpdatedJobs.length} new/modified jobs.`);
    console.log(`[Sync] ${finalActiveJobsToPublish.length} cached.`);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(newOrUpdatedJobs, null, 2));
    console.log(`Wrote delta to ${OUTPUT_FILE}`);
}

main().catch(e => {
    console.error('Error:', e);
    process.exit(1);
});
