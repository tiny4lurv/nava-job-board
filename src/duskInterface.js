/**
 * duskInterface.js
 *
 * Replacement for geminiInterface.js. Processes new/changed jobs through
 * Dusk (the assistant) using live web search + spreadsheet data.
 *
 * Contract (matches the Gemini version this replaces):
 *   Input:  array of raw row objects from fetchSheetData.js, each with:
 *            { rowIndex, client, contact, position, facility, location,
 *              responsibility, notes, isConfidential, id, signature }
 *   Output: array of structured job objects ready for jobs.json, each with:
 *            { roleTitle, roleType, location, facilityType, description,
 *              contractType, salaryShort, requirements,
 *              salaryOrBonusInfo, applyLink, id }
 *
 * Invocation: this module does NOT auto-run. It is invoked by:
 *   - The cron-driven me (Dusk) when the OpenClaw cron fires
 *   - You (Tiny) when you want to process a delta interactively
 *   - Any future automated trigger
 *
 * Rules (see .dusk/RULES.md for the full list):
 *   1. Never invent compensation. If spreadsheet has none → "Compensation based on experience".
 *   2. Spreadsheet wins on every conflict with web search.
 *   3. Web search fills gaps; internal knowledge is last resort.
 *   4. Confidentiality enforced: county-only location, no facility/client/contact names.
 *   5. Apply link hardcoded to https://navahc.com/candidates/.
 *   6. Anonymization mandatory; personality signals translated to professional language.
 */

const COUNTY_MAP = {
    'AL': {
        'Mobile': 'Mobile County', 'Birmingham': 'Jefferson County', 'Montgomery': 'Montgomery County',
        'Phenix City': 'Russell County', 'Selma': 'Dallas County', 'Vernon': 'Lamar County',
        'Butler': 'Choctaw County', 'Red Bay': 'Franklin County', 'Grand Bay': 'Mobile County',
        'Russellville': 'Franklin County', 'Arab': 'Marshall County',
    },
    'FL': {
        'Venice': 'Sarasota County', 'Inverness': 'Citrus County',
        'Pompano Beach': 'Broward County', 'Hialeah': 'Miami-Dade County',
        'Miami': 'Miami-Dade County', 'Orlando': 'Orange County', 'Tampa': 'Hillsborough County',
        'Jacksonville': 'Duval County', 'Pensacola': 'Escambia County',
    },
    'MD': {
        'Oakland': 'Garrett County', 'Baltimore': 'Baltimore County',
        'Bethesda': 'Montgomery County', 'Rockville': 'Montgomery County',
    },
    'NY': {
        'Brooklyn': 'Kings County', 'Queens': 'Queens County',
        'Manhattan': 'New York County', 'Bronx': 'Bronx County',
        'Staten Island': 'Richmond County',
    },
    'CA': {
        'Los Angeles': 'Los Angeles County', 'San Francisco': 'San Francisco County',
        'San Diego': 'San Diego County',
    },
};

function countyOnlyLocation(location) {
    if (!location || !location.includes(',')) {
        return location ? `${location} area` : 'Location withheld';
    }
    const [city, stateAbbr] = location.split(',').map(s => s.trim());
    const state = stateAbbr.toUpperCase();
    if (COUNTY_MAP[state] && COUNTY_MAP[state][city]) {
        return `${COUNTY_MAP[state][city]}, ${stateAbbr}`;
    }
    return `${city} area, ${stateAbbr}`;
}

function buildSearchQueries(job) {
    const queries = [];
    if (job.facility && job.location) {
        queries.push(`"${job.position}" "${job.facility}" "${job.location}"`);
    }
    if (job.position && job.location) {
        const [city, state] = job.location.split(',').map(s => s.trim());
        queries.push(`"${job.position}" site:indeed.com "${city}"`);
    }
    if (job.position) {
        queries.push(`${job.position} skilled nursing facility requirements responsibilities 2026`);
    }
    return queries;
}

async function processOneJob(job, ctx) {
    if (!ctx || !ctx.webSearch || !ctx.webFetch || !ctx.reason) {
        throw new Error('duskInterface: ctx must provide webSearch, webFetch, reason');
    }

    const queries = buildSearchQueries(job);
    const searchResults = [];
    for (const q of queries) {
        try {
            const hits = await ctx.webSearch(q, { count: 5 });
            searchResults.push(...hits);
        } catch (e) {
            continue;
        }
    }

    const prompt = `You are processing a healthcare job posting for a public-facing careers page.

# Spreadsheet data (source of truth — these fields win on any conflict)
- Title / position: ${job.position}
- Facility: ${job.facility}
- Location: ${job.location}
- Notes: ${job.notes || '(empty)'}
- Responsibility: ${job.responsibility || '(empty)'}
- Is Confidential: ${job.isConfidential ? 'YES' : 'No'}
${job.isConfidential ? `- CONFIDENTIALITY MASK: location output must be county-only. Use this masked value: ${countyOnlyLocation(job.location)}` : ''}

# Web search results (fill gaps only — never override spreadsheet)
${searchResults.slice(0, 15).map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`).join('\n')}

# Output contract (strict JSON, no other text):
{
  "roleTitle": "<clean standardized title>",
  "roleType": "<one of: 'Floor Staff' | 'Leadership' | 'Support' | 'Therapy/Rehabilitation' | 'Other'>",
  "location": "${job.isConfidential ? countyOnlyLocation(job.location) : job.location}",
  "facilityType": "<generic category>",
  "description": "<2-3 paragraph candidate-facing description>",
  "contractType": "<Full-time | Part-time | Contract | PRN | Interim>",
  "salaryShort": "<exact rate from spreadsheet, else empty string>",
  "requirements": ["<3-5 items>"],
  "salaryOrBonusInfo": "<if spreadsheet has salary/bonus, surface verbatim. Else 'Compensation based on experience'. NEVER invent.>",
  "applyLink": "https://navahc.com/candidates/",
  "id": "${job.id}"
}

# Hard rules
- NEVER mention facility or client name in any output field.
- NEVER invent compensation.
- Spreadsheet wins on conflicts.
- Internal references dropped.
- Personality signals translate to professional language.
- Output ONLY JSON, no markdown.`;

    const rawResponse = await ctx.reason(prompt);
    const jsonText = rawResponse.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    } catch (e) {
        console.error(`duskInterface: failed to parse JSON for job ${job.id}`);
        return null;
    }

    parsed.applyLink = 'https://navahc.com/candidates/';
    parsed.id = job.id;

    if (job.isConfidential) {
        parsed.location = countyOnlyLocation(job.location);
    }

    if (!hasSalarySignal(job)) {
        parsed.salaryShort = parsed.salaryShort || '';
        parsed.salaryOrBonusInfo = parsed.salaryOrBonusInfo || 'Compensation based on experience';
    }

    return parsed;
}

function hasSalarySignal(job) {
    const text = `${job.position || ''} ${job.notes || ''} ${job.responsibility || ''}`;
    return /\$\s*\d|\d+\s*k\b|per\s+hour|\/hr|hourly|salary|bonus/i.test(text);
}

async function processNewJobsWithDusk(newJobs, ctx) {
    const processed = [];
    for (let i = 0; i < newJobs.length; i++) {
        const job = newJobs[i];
        console.log(`[dusk] Processing ${i + 1} of ${newJobs.length}: ${job.position}...`);

        let result = null;
        let retries = 0;
        const maxRetries = 3;

        while (!result && retries < maxRetries) {
            try {
                result = await processOneJob(job, ctx);
            } catch (e) {
                retries++;
                if (retries < maxRetries) {
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
        }

        if (result) {
            processed.push(result);
        } else {
            console.error(`[dusk] FAILED after ${maxRetries} attempts: ${job.position}`);
        }

        await new Promise(r => setTimeout(r, 2000));
    }
    return processed;
}

module.exports = {
    processNewJobsWithDusk,
    processOneJob,
    buildSearchQueries,
    countyOnlyLocation,
    hasSalarySignal,
};
