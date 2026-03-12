const { google } = require('googleapis');
const path = require('path');

// Google Sheets API configuration
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const CREDENTIALS_PATH = path.join(__dirname, '..', 'google-credentials.json');

// Initialize the Google Auth Client
const auth = new google.auth.GoogleAuth({
  keyFile: CREDENTIALS_PATH,
  scopes: SCOPES,
});

/**
 * Check if a cell has a non-white background color.
 */
function isCellActiveColor(cellData) {
  if (!cellData || !cellData.effectiveFormat || !cellData.effectiveFormat.backgroundColor) {
      return false;
  }
  
  const bg = cellData.effectiveFormat.backgroundColor;
  
  // Google Sheets API returns colors as RGB values ranging from 0.0 to 1.0. 
  // White is 1, 1, 1. Empty/default might come back without values or as 1,1,1.
  
  // Default values if they are undefined is 0
  const r = bg.red || 0;
  const green = bg.green || 0;
  const blue = bg.blue || 0;

  // If all are very close to 1, it's white (inactive).
  // Some padding for float imprecision
  if (r > 0.99 && green > 0.99 && blue > 0.99) {
      return false; 
  }

  // Any other combination means it has a color, hence it is active.
  return true;
}

/**
 * Fetch data and formatting from the spreadsheet and identify active roles.
 */
async function getActiveJobs(spreadsheetId, rangeName) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  // We need to use spreadsheet.get with includeGridData=true to get formatting
  try {
    const requestOptions = {
      spreadsheetId,
      includeGridData: true,
    };
    
    if (rangeName) {
        requestOptions.ranges = [rangeName];
    }

    const response = await sheets.spreadsheets.get(requestOptions);

    const sheet = response.data.sheets[0];
    
    if (!sheet.data || sheet.data.length === 0 || !sheet.data[0].rowData) {
        console.log("No data found in sheet.");
        return [];
    }

    const rows = sheet.data[0].rowData;
    const activeJobs = [];

    // The data we care about is columns A-G (indices 0-6)
    // Assuming row 1 is headers, we'll start parsing from index 1 (row 2)
    // But we might need to be robust and just skip empty title rows
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        // Skip empty rows entirely
        if (!row.values) continue;

        // Position/Title is Column C (index 2)
        const positionCell = row.values[2];
        
        // Check if there is a position title
        if (!positionCell || !positionCell.effectiveValue || !positionCell.effectiveValue.stringValue) {
            continue;
        }

        const title = positionCell.effectiveValue.stringValue.trim();
        if (!title) continue;

        // Check if the role is active using cell background color
        if (isCellActiveColor(positionCell)) {
            // Extract text from columns A through G
            const getStrVal = (colIndex) => {
                const cell = row.values[colIndex];
                if (cell && cell.effectiveValue) {
                   return cell.effectiveValue.stringValue || cell.effectiveValue.numberValue?.toString() || "";
                }
                return "";
            };

            activeJobs.push({
               rowIndex: i + 1, // 1-indexed for logging/debugging
               client: getStrVal(0),
               contact: getStrVal(1),
               position: title,
               facility: getStrVal(3),
               location: getStrVal(4),
               responsibility: getStrVal(5),
               notes: getStrVal(6)
            });
        }
    }
    
    return activeJobs;

  } catch (err) {
    console.error('The API returned an error: ' + err);
    throw err;
  }
}

module.exports = {
  getActiveJobs
};
