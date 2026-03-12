const { createObjectCsvWriter } = require('csv-writer');
const path = require('path');
const fs = require('fs');

const { filterNewJobs, markJobsAsProcessed } = require('./jobCache');

const NEW_JOBS_CSV = path.join(__dirname, '..', 'new_jobs.csv');

/**
 * Creates a CSV file containing only the new jobs that need processing
 * by the Custom GPT.
 */
async function exportNewJobsToCsv(activeJobs) {
    const newJobs = filterNewJobs(activeJobs);

    // If there are no new jobs, don't generate the file
    if (newJobs.length === 0) {
        console.log("No new jobs found. Skipping CSV export.");
        if (fs.existsSync(NEW_JOBS_CSV)) {
             // Optional: clean up the old file so they don't accidentally re-run it
             // fs.unlinkSync(NEW_JOBS_CSV);
        }
        return [];
    }

    console.log(`Found ${newJobs.length} new jobs to process.`);

    const csvWriter = createObjectCsvWriter({
        path: NEW_JOBS_CSV,
        header: [
            { id: 'client', title: 'Client' },
            { id: 'contact', title: 'Contact' },
            { id: 'position', title: 'Position' },
            { id: 'facility', title: 'Facility' },
            { id: 'location', title: 'Location' },
            { id: 'responsibility', title: 'Responsibility' },
            { id: 'notes', title: 'Notes' },
            { id: 'rowIndex', title: 'Sheet Row (For Reference)' },
            { id: 'id', title: 'Internal ID' } // Keeping our ID so we know what they are when re-imported
        ]
    });

    try {
        await csvWriter.writeRecords(newJobs);
        console.log(`Successfully exported new jobs to: ${NEW_JOBS_CSV}`);
        console.log(`\n*** ACTION REQUIRED ***`);
        console.log(`Please upload 'new_jobs.csv' to your Custom GPT.`);
        return newJobs;
    } catch (err) {
        console.error("Error writing CSV file:", err);
        throw err;
    }
}

module.exports = {
    exportNewJobsToCsv
};
