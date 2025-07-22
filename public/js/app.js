// Load environment variables from a .env file
require('dotenv').config();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid'); // To generate unique IDs

// --- CONFIGURATION ---
const { ALCHEMY_EMAIL, ALCHEMY_PASSWORD } = process.env;
const ALCHEMY_TENANT = process.env.ALCHEMY_TENANT || 'productcaseelnlims'; // Default tenant
const BASE_URL_V3 = 'https://core-production.alchemy.cloud/core/api/v3';
const BASE_URL_V2_SIGNIN = 'https://core-production.alchemy.cloud/core/api/v2/sign-in';

// This is the ID for the Material Type you are creating (e.g., Raw Material).
// This was '982' in your original Apps Script. Update if this has changed.
const MATERIAL_TYPE_ID = 982;

// --- END CONFIGURATION ---

/**
 * A simple helper function to pause execution.
 * @param {number} ms - The number of milliseconds to wait.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Authenticates with Alchemy and returns a bearer token.
 */
async function getAuthToken() {
  console.log(`Authenticating for user ${ALCHEMY_EMAIL} on tenant ${ALCHEMY_TENANT}...`);
  const payload = { email: ALCHEMY_EMAIL, password: ALCHEMY_PASSWORD };

  try {
    const response = await axios.post(BASE_URL_V2_SIGNIN, payload);
    const authData = response.data;

    // Find the correct token for the specified tenant
    let token;
    if (authData.tenant === ALCHEMY_TENANT) {
      token = authData.accessToken;
    } else {
      const tenantTokenInfo = authData.tokens.find(t => t.tenant === ALCHEMY_TENANT);
      token = tenantTokenInfo ? tenantTokenInfo.accessToken : null;
    }

    if (!token) {
      throw new Error(`Could not find a token for tenant '${ALCHEMY_TENANT}'. Please check your access rights.`);
    }

    console.log('✅ Authentication successful.');
    return token;
  } catch (error) {
    const errorMsg = error.response ? `${error.response.status} - ${JSON.stringify(error.response.data)}` : error.message;
    console.error(`❌ Authentication failed: ${errorMsg}`);
    throw error; // Stop the script if authentication fails
  }
}

/**
 * STEP 1: Creates a new material in Alchemy WITHOUT a code.
 * @param {string} token - The authentication token.
 * @param {object} materialData - The data for the new material.
 * @returns {string} The new record's ID.
 */
async function createMaterial(token, materialData) {
  console.log(`Attempting to create material: '${materialData.TradeName}'...`);
  const createUrl = `${BASE_URL_V3}/records`;
  const headers = { 'Authorization': `Bearer ${token}` };

  // Generate a unique external code to prevent accidental duplicate submissions
  const externalCode = `MOCK-${uuidv4().split('-')[0].toUpperCase()}`;

  // Build the payload. NOTICE: We do NOT include the 'Code' field.
  // The system will generate it for us.
  const fieldsPayload = [
    { identifier: "TradeName", value: materialData.TradeName },
    { identifier: "Category", value: materialData.Category },
    { identifier: "MaterialStatus", value: materialData.MaterialStatus },
    { identifier: "ExternalCode", value: externalCode },
  ].filter(field => field.value != null); // Filter out any fields that are not set

  const payload = {
    recordTemplateId: MATERIAL_TYPE_ID,
    fields: fieldsPayload,
  };

  try {
    const response = await axios.post(createUrl, payload, { headers });
    const recordId = response.data.id;

    if (!recordId) {
      throw new Error("API response did not include a record ID.");
    }

    console.log(`✅ Successfully created record with ID: ${recordId}`);
    return recordId;
  } catch (error) {
    const errorMsg = error.response ? `${error.response.status} - ${JSON.stringify(error.response.data)}` : error.message;
    console.error(`❌ Failed to create material: ${errorMsg}`);
    // Provide a helpful hint if the error is about the template ID
    if (error.response?.data?.message?.includes('record template')) {
        console.error(`💡 HINT: The Material Type ID (${MATERIAL_TYPE_ID}) might be incorrect for this tenant.`);
    }
    throw error;
  }
}

/**
 * STEP 2: Reads the record to get the server-generated 'Code'.
 * @param {string} token - The authentication token.
 * @param {string} recordId - The ID of the record to read.
 * @returns {string|null} The generated code, or null if not found.
 */
async function getRecordCode(token, recordId) {
  // Wait a couple of seconds to ensure the record is fully indexed before we read it
  await sleep(2000);

  console.log(`Reading back the generated code for record ID: ${recordId}...`);
  const readUrl = `${BASE_URL_V3}/records/${recordId}/fields`;
  const headers = { 'Authorization': `Bearer ${token}` };

  try {
    const response = await axios.get(readUrl, { headers });
    const fields = response.data.fields || [];
    const codeField = fields.find(f => f.identifier === 'Code');

    if (codeField?.rows?.[0]?.values?.[0]?.value) {
      const generatedCode = codeField.rows[0].values[0].value;
      console.log(`✅ Found generated code: ${generatedCode}`);
      return generatedCode;
    } else {
      console.warn("⚠️ Could not find 'Code' field in the response. The record might still be processing.");
      return null;
    }
  } catch (error) {
    const errorMsg = error.response ? `${error.response.status} - ${JSON.stringify(error.response.data)}` : error.message;
    console.error(`❌ Failed to read record code: ${errorMsg}`);
    throw error;
  }
}

/**
 * Main function to run the entire integration process.
 */
async function main() {
  console.log("--- Starting Alchemy Material Creation Script ---");

  // Example data to be transferred. You can modify this or load it from a file.
  const materialsToCreate = [
    { TradeName: "Demo Polymer A-100", Category: "Raw material", MaterialStatus: "Research" },
    { TradeName: "Finished Product B-200", Category: "Finished good", MaterialStatus: "Production Approved" },
  ];

  let authToken;
  try {
    // 1. Get the authentication token once for the whole session
    authToken = await getAuthToken();
  } catch (error) {
    console.error("\n🛑 A critical error stopped the script at authentication. Cannot proceed.");
    return; // Exit if we can't authenticate
  }

  // 2. Loop through your data and process each material
  for (const material of materialsToCreate) {
    console.log("-".repeat(50)); // Separator for clarity
    try {
      // STEP 1: Create the material and get its ID
      const newRecordId = await createMaterial(authToken, material);

      // STEP 2: Use the ID to read the generated code
      if (newRecordId) {
        const generatedCode = await getRecordCode(authToken, newRecordId);

        if (generatedCode) {
          console.log(`🎉 SUCCESS! Material '${material.TradeName}' created with Code: ${generatedCode}`);
        } else {
          console.warn(`⚠️ Creation seemed to work (ID: ${newRecordId}), but could not retrieve the final code.`);
        }
      }
    } catch (error) {
      // This catches errors for a single material, allowing the loop to continue to the next one
      console.error(`Skipping material '${material.TradeName}' due to an error during its processing.`);
    }
  }

  console.log("\n--- Script finished. ---");
}

// Run the main function
main();
