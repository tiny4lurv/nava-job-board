const fs = require('fs');
const path = require('path');

const FINAL_OUTPUT_FILE = path.join(__dirname, '..', 'jobs.json');

/**
 * Completely overwrites the final output file to exactly match the active jobs.
 * This guarantees any jobs that went missing/white on the spreadsheet disappear from the site.
 */
function overwriteFinalOutput(finalJobs) {
    try {
        fs.writeFileSync(FINAL_OUTPUT_FILE, JSON.stringify(finalJobs, null, 2));
        console.log(`Synced exactly ${finalJobs.length} active jobs to jobs.json`);
    } catch (err) {
        console.error("Failed to write final output:", err);
    }
}

module.exports = {
   overwriteFinalOutput
};
