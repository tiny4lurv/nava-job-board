const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_FILE = path.join(__dirname, '..', 'job_cache.json');

/**
 * Generates a consistent unique ID for a job for the UI.
 */
function generateJobId(job) {
    const rawString = `${job.position}_${job.facility}_${job.location}`;
    return rawString.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

/**
 * Generates a signature of ALL fields to detect when a row has been modified.
 * Even a small payload change (like $30 to $35) will change this signature.
 */
function generateJobSignature(job) {
    const rawString = `${job.position}_${job.facility}_${job.location}_${job.client}_${job.contact}_${job.responsibility}_${job.notes}`;
    return crypto.createHash('md5').update(rawString).digest('hex');
}

/**
 * Loads the cache of previously processed jobs.
 */
function loadCache() {
    if (!fs.existsSync(CACHE_FILE)) {
        return {};
    }
    try {
        const data = fs.readFileSync(CACHE_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error("Error reading job cache, starting fresh:", err);
        return {};
    }
}

/**
 * Saves the cache to disk.
 */
function saveCache(cache) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    } catch (err) {
        console.error("Error writing job cache:", err);
    }
}

module.exports = {
    loadCache,
    saveCache,
    generateJobId,
    generateJobSignature
};
