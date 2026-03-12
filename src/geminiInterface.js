const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Ensure the API key is available
if (!process.env.GEMINI_API_KEY) {
    console.error("CRITICAL ERROR: GEMINI_API_KEY environment variable is missing.");
    console.error("Please create a .env file in the job_board_automation folder and add your key.");
    process.exit(1);
}

// Initialize the Gemini API client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// We are defining a strict JSON schema so Gemini ALWAYS returns the exact object we need.
// This prevents it from returning conversational text like "Here is your job description:"
const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    roleTitle: {
      type: SchemaType.STRING,
      description: "A clean, professional job title extracted or inferred from the provided details."
    },
    location: {
      type: SchemaType.STRING,
      description: "The city and state of the job."
    },
    facilityType: {
      type: SchemaType.STRING,
      description: "The type of facility (e.g., Rehab Center, Hospital, Skilled Nursing Facility)."
    },
    description: {
      type: SchemaType.STRING,
      description: "A compelling, 2-3 paragraph job description written for a candidate. Emphasize any perks, shifts, or urgency mentioned."
    },
    contractType: {
      type: SchemaType.STRING,
      description: "The type of contract. Examples: 'Full-time', 'Part-time', 'Contract', 'PRN', 'Interim'. If no other specification like Part-Time, PRN, or Interim is found, always default to 'Full-time'."
    },
    salaryShort: {
      type: SchemaType.STRING,
      description: "The exact pay rate for the card header. E.g., '$160,000 per year' or '$38.00 - $48.00/hr'. If none found, leave empty string."
    },
    requirements: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "A bulleted list of 3-5 key requirements for the role (e.g., certifications, experience)."
    },
    salaryOrBonusInfo: {
      type: SchemaType.STRING,
      description: "Any deeper salary, hourly rate, or sign-on bonus information found. If none, return 'Compensation based on experience'."
    },
    applyLink: {
      type: SchemaType.STRING,
      description: "Always return exact string 'https://navahc.com/candidates/'"
    }
  },
  required: ["roleTitle", "location", "facilityType", "description", "contractType", "salaryShort", "requirements", "salaryOrBonusInfo", "applyLink"]
};

// We use the gemini-2.5-flash model
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: responseSchema,
    temperature: 0.1, // Very low temperature to prevent hallucination
  }
});

/**
 * Sends job details to Gemini and gets a structured JSON response back.
 */
async function generateJobDetails(job) {
    console.log(`Asking Gemini to generate description for: ${job.position} at ${job.facility}...`);
    
    const prompt = `
    You are an expert healthcare technical recruiter and data researcher. Your job is to take brief internal spreadsheet data for an open role and turn it into a short, purely factual job posting.
    
    CRITICAL ANTI-HALLUCINATION INSTRUCTION: You MUST prioritize brevity and facts. DO NOT invent, hallucinate, or assume any responsibilities, perks, or requirements that are not explicitly stated in the provided data or found in your live web search. A short, accurate description is always better than a long, made-up one.

    Here is the raw data from the internal spreadsheet for the open role:
    - Internal Title / Shift Info: ${job.position}
    - Facility Name: ${job.facility}
    - Location: ${job.location}
    - Hiring Manager Notes / Requirements: ${job.notes}
    - Primary Responsibilities / Contact: ${job.responsibility}

    Please generate a professional, brief job posting according to the required JSON schema. 
    
    CRITICAL RULES & WORKFLOW:
    1. Research: BEFORE writing anything, rely on your extensive internal knowledge about standard job postings on Indeed/ZipRecruiter/LinkedIn for "${job.position}" roles at facilities similar to "${job.facility}" to understand standard responsibilities and requirements.
    2. Prioritize Spreadsheet Data: If the salary, urgency, contract type, or requirements found on the web search contradict the internal spreadsheet data, YOU MUST ALWAYS USE THE INTERNAL SPREADSHEET DATA. The spreadsheet data (Columns C and G) is the absolute final source of truth.
    3. Zero Hallucination: Base your description ONLY on the spreadsheet data and the real facts you find online. Do not use generic filler text.
    4. ANONYMITY REQUIRED: You MUST NOT mention the specific Facility Name (${job.facility}) or the Client Name (${job.client}) ANYWHERE in your output (not in the description, title, or requirements). Use generic terms like "a premier health and rehabilitation center" or "a skilled nursing facility."
    5. Contract Type: Default to "Full-time" unless the data or your search specifically mentions Part-Time, PRN, Contract, or Interim. Always prioritize what is written in the spreadsheet if there is a conflict.
    6. Salary Short: Extract the exact pay rate for the card header (e.g., "$160,000 per year" or "$38.00 - $48.00/hr"). If not found, leave it blank. Always prioritize the spreadsheet's notes if there is a conflict.
    7. Apply Link: Must ALWAYS be exactly "https://navahc.com/candidates/".
    8. Requirements: Extract specific requirements (like WCB certification, RN preferred, etc.) from the 'Notes', 'Title' fields, or your live web search into the bulleted list. Always prioritize the spreadsheet's notes.
    `;

    try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        
        // Gemini returns the exact JSON string because we used responseSchema
        const formattedJob = JSON.parse(responseText);
        
        // Add our internal ID back into the object so we can use it in the UI later
        formattedJob.id = job.id;
        console.log(`Successfully generated details for: ${formattedJob.roleTitle}`);
        return formattedJob;
    } catch (error) {
        console.error(`Error generating content for job ${job.position}:`);
        console.error("Full Error Object:", JSON.stringify(error, null, 2));
        if (error.status) console.error("Status:", error.status);
        if (error.statusText) console.error("Status Text:", error.statusText);
        return null;
    }
}

/**
 * Processes a list of new jobs through Gemini sequentially.
 */
async function processNewJobsWithGemini(newJobs) {
    const processedJobs = [];
    
    // We process sequentially rather than in parallel (Promise.all)
    // to avoid hitting rate limits on the free Gemini tier.
    for (let i = 0; i < newJobs.length; i++) {
        const job = newJobs[i];
        console.log(`Processing ${i + 1} of ${newJobs.length}...`);
        
        const enhancedJob = await generateJobDetails(job);
        if (enhancedJob) {
            processedJobs.push(enhancedJob);
        }
        
        // Add a small 1-second delay between requests to be gentle on the API
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return processedJobs;
}

module.exports = {
    processNewJobsWithGemini
};
