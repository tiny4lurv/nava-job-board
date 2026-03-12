const { getActiveJobs } = require('./src/fetchSheetData');
const { loadCache, saveCache, generateJobId, generateJobSignature } = require('./src/jobCache');
const { processNewJobsWithGemini } = require('./src/geminiInterface');
const { overwriteFinalOutput } = require('./src/outputJson');

const SHEET_ID = '1Bsm2ceTy3lBq7t7JMOXOEtEBp_gUxkL0d78ZXnGKocs';

async function main() {
  console.log('--- Starting Job Board Sync ---');
  try {
      // 1. Fetch active jobs from Google Sheets
      const allActiveJobs = await getActiveJobs(SHEET_ID, ''); 
      console.log(`[Google Sheets] Found ${allActiveJobs.length} active roles.`);

      // 2. Identify new, updated, and existing jobs
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

          // Check if this exact job signature is already processed and cached
          if (cache[id] && cache[id].signature === signature && cache[id].finalJson) {
              // It's unchanged. Keep the existing generated JSON.
              finalActiveJobsToPublish.push(cache[id].finalJson);
          } else {
              // It's new or modified. Send to Gemini.
              newOrUpdatedJobs.push(job);
          }
      }
      
      // Cleanup old cache entries that are no longer on the sheet
      for (const cachedId of Object.keys(cache)) {
          if (!activeJobIds.has(cachedId)) {
              delete cache[cachedId];
          }
      }

      if (newOrUpdatedJobs.length === 0) {
          console.log(`[Sync] No changes detected. All ${finalActiveJobsToPublish.length} jobs are up to date.`);
      } else {
          console.log(`[Sync] Found ${newOrUpdatedJobs.length} new or modified jobs to process with Gemini.`);
          // 3. Process new/updated jobs with Gemini
          const processedJobs = await processNewJobsWithGemini(newOrUpdatedJobs);
          
          for (const pJob of processedJobs) {
              if (!pJob) continue; // Skip if Gemini errored
              finalActiveJobsToPublish.push(pJob);
              
              const originalJob = newOrUpdatedJobs.find(j => j.id === pJob.id);
              if (originalJob) {
                  cache[pJob.id] = {
                      signature: originalJob.signature,
                      addedAt: new Date().toISOString(),
                      finalJson: pJob
                  };
              }
          }
          saveCache(cache);
      }
      
      // 4. Overwrite jobs.json so it EXACTLY matches the Google Sheet (removes inactive jobs)
      overwriteFinalOutput(finalActiveJobsToPublish);
      console.log(`\n--- Success: Job Board is fully synced! ---`);

  } catch (err) {
      console.error('Error in execution:', err);
  }
}

main();
