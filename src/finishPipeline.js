/**
 * finishPipeline.js — Assembles jobs.json from cache + results, commits, pushes.
 *
 * Run after Dusk has written result files to .dusk/results/.
 * Reads job_cache.json (existing cache), reads .dusk/results/*.result.json,
 * updates cache with new entries, writes jobs.json, commits, pushes.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RESULTS_DIR = path.join(ROOT, '.dusk', 'results');
const CACHE_FILE = path.join(ROOT, 'job_cache.json');
const JOBS_FILE = path.join(ROOT, 'jobs.json');

function loadCache() {
    if (!fs.existsSync(CACHE_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch (e) {
        console.error('Error reading cache:', e.message);
        return {};
    }
}

function saveCache(cache) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function main() {
    if (!fs.existsSync(RESULTS_DIR)) {
        console.log('[finish] No results directory. Nothing to do.');
        return;
    }

    const resultFiles = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.result.json'));
    if (resultFiles.length === 0) {
        console.log('[finish] No new results. Cache is current.');
        return;
    }

    console.log(`[finish] Found ${resultFiles.length} new result files.`);

    const cache = loadCache();
    const now = new Date().toISOString();

    let updated = 0;
    for (const fname of resultFiles) {
        const result = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, fname), 'utf8'));
        const jid = result.id;
        // We don't have the signature from the result alone; the bootstrap should have left
        // the original prompt files with signatures. Read from there if present.
        const promptFile = path.join(ROOT, '.dusk', 'prompts', `${jid}.prompt.json`);
        let signature = null;
        if (fs.existsSync(promptFile)) {
            const promptData = JSON.parse(fs.readFileSync(promptFile, 'utf8'));
            signature = promptData.job && promptData.job.signature;
        }

        if (!signature) {
            // Fallback: md5 of position+facility+location+client+contact+responsibility+notes+"_v2"
            // (matches jobCache.js format). Without the original raw job we can't compute this.
            console.warn(`[finish] No signature for ${jid}; skipping cache update.`);
            continue;
        }

        cache[jid] = {
            signature,
            addedAt: now,
            finalJson: result,
        };
        updated++;
    }

    if (updated === 0) {
        console.log('[finish] No cache updates possible.');
        return;
    }

    saveCache(cache);
    console.log(`[finish] Cache updated: ${updated} new entries.`);

    // Assemble jobs.json from all cache entries (in id-sorted order for stability)
    const jobs = Object.entries(cache)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([_, entry]) => entry.finalJson);

    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
    console.log(`[finish] jobs.json written: ${jobs.length} entries.`);

    // Git commit + push
    try {
        execSync('git add jobs.json job_cache.json', { cwd: ROOT, stdio: 'inherit' });

        // Only commit if there are staged changes
        const status = execSync('git diff --cached --name-only', { cwd: ROOT, encoding: 'utf8' }).trim();
        if (!status) {
            console.log('[finish] No changes to commit.');
            return;
        }

        const ts = new Date().toISOString();
        execSync(`git commit -m "Automated job board update (Dusk) ${ts}"`, { cwd: ROOT, stdio: 'inherit' });
        execSync('git push origin main', { cwd: ROOT, stdio: 'inherit' });
        console.log('[finish] Pushed to origin/main.');
    } catch (e) {
        console.error('[finish] Git error:', e.message);
        process.exit(1);
    }

    // Clean up: remove processed prompts and results to keep .dusk/ lean for next run
    for (const fname of resultFiles) {
        const jid = fname.replace('.result.json', '');
        const promptFile = path.join(ROOT, '.dusk', 'prompts', `${jid}.prompt.json`);
        try { fs.unlinkSync(promptFile); } catch (e) {}
        try { fs.unlinkSync(path.join(RESULTS_DIR, fname)); } catch (e) {}
    }
    console.log('[finish] Cleanup done.');
}

main();
