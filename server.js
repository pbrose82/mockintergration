const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'demo-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true in production with HTTPS
}));

// Store for auth tokens
let authTokenCache = {
    token: null,
    expiry: null
};

// Configuration store
let appConfig = {
    email: process.env.ALCHEMY_EMAIL || '',
    password: process.env.ALCHEMY_PASSWORD || '',
    tenant: process.env.ALCHEMY_TENANT || 'productcaseelnlims',
    materialType: process.env.ALCHEMY_MATERIAL_TYPE || '982'
};

// Mock database for materials
let mockMaterials = [
    { id: 'MOCK-001', tradeName: 'Demo Polymer A-100', category: 'Raw material', materialStatus: 'Research', transferStatus: 'Pending', alchemyCode: null, alchemyUrl: null },
    { id: 'MOCK-002', tradeName: 'Test Compound XY-50', category: 'Intermediate', materialStatus: 'Experimental', transferStatus: 'Pending', alchemyCode: null, alchemyUrl: null }
];

// Helper function to get Alchemy auth token
async function getAlchemyToken() {
    if (authTokenCache.token && authTokenCache.expiry && new Date(authTokenCache.expiry) > new Date()) {
        return authTokenCache.token;
    }
    if (!appConfig.email || !appConfig.password) {
        throw new Error('Credentials not configured. Please configure them in the Admin panel.');
    }
    try {
        const V2_SIGNIN_URL = 'https://core-production.alchemy.cloud/core/api/v2/sign-in';
        const response = await axios.post(V2_SIGNIN_URL, { email: appConfig.email, password: appConfig.password });
        const authData = response.data;
        let token = authData.tokens.find(t => t.tenant === appConfig.tenant)?.accessToken;
        if (!token) throw new Error(`No access token found for tenant: ${appConfig.tenant}`);
        const tokenParts = token.split('.');
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
        authTokenCache = { token, expiry: new Date(payload.exp * 1000) };
        return token;
    } catch (error) {
        console.error('Authentication error:', error.message);
        throw error;
    }
}

// --- ROUTES ---

// Main page route
app.get('/', (req, res) => {
    res.render('index', {
        materials: mockMaterials,
        message: req.session.message || null,
        config: { tenant: appConfig.tenant, configured: !!(appConfig.email && appConfig.password) }
    });
    req.session.message = null;
});

// Admin page route
app.get('/admin', (req, res) => {
    res.render('admin', { config: appConfig, message: req.session.adminMessage || null });
    req.session.adminMessage = null;
});


// --- THIS IS THE CORRECTED API ROUTE ---
app.post('/api/transfer', async (req, res) => {
    const { materialId } = req.body;
    const material = mockMaterials.find(m => m.id === materialId);

    if (!material) {
        return res.status(404).json({ success: false, message: 'Material not found in mock database' });
    }
    console.log(`Starting transfer for: ${material.tradeName}`);
    try {
        const token = await getAlchemyToken();
        const V3_API_URL = 'https://core-production.alchemy.cloud/core/api/v3/records';

        // 1. CREATE the material using the V3 endpoint
        console.log('Step 1: Creating material in Alchemy...');
        const createPayload = {
            recordTemplateId: parseInt(appConfig.materialType),
            fields: [
                { identifier: "TradeName", value: material.tradeName },
                { identifier: "Category", value: material.category },
                { identifier: "MaterialStatus", value: material.materialStatus },
            ]
        };
        const createResponse = await axios.post(V3_API_URL, createPayload, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const alchemyMaterialId = createResponse.data.id;
        if (!alchemyMaterialId) throw new Error("Alchemy did not return a material ID after creation.");
        console.log(`✅ Create successful. New Alchemy ID: ${alchemyMaterialId}`);
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 2. READ the record back to get the generated code
        console.log('Step 2: Reading generated code from Alchemy...');
        const readResponse = await axios.get(`${V3_API_URL}/${alchemyMaterialId}/fields`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const fields = readResponse.data.fields || [];
        const codeField = fields.find(field => field.identifier === 'Code');
        const alchemyCode = codeField?.rows[0]?.values[0]?.value || 'N/A';
        if (alchemyCode === 'N/A') console.warn("⚠️ Could not find 'Code' field in the response from Alchemy.");
        else console.log(`✅ Read successful. Found Alchemy Code: ${alchemyCode}`);

        // 3. Update local mock database
        material.transferStatus = 'Transferred';
        material.alchemyCode = alchemyCode;
        material.alchemyUrl = `https://app.alchemy.cloud/${appConfig.tenant}/record/${alchemyMaterialId}`;

        // 4. Send the successful result back to the frontend
        res.json({ success: true, alchemyCode, alchemyUrl: material.alchemyUrl });

    } catch (error) {
        console.error('--- TRANSFER ERROR ---');
        if (error.response) console.error('Data:', JSON.stringify(error.response.data, null, 2));
        else console.error('Error Message:', error.message);
        res.status(500).json({ success: false, message: error.response?.data?.message || error.message });
    }
});
// --- END OF CORRECTED API ROUTE ---

// Other routes for admin, etc.
app.post('/api/add-material', (req, res) => {
    const { tradeName, category, materialStatus } = req.body;
    const newMaterial = {
        id: `MOCK-${String(mockMaterials.length + 1).padStart(3, '0')}`,
        tradeName, category, materialStatus, transferStatus: 'Pending',
    };
    mockMaterials.push(newMaterial);
    req.session.message = 'Material added successfully!';
    res.redirect('/');
});

app.post('/api/save-credentials', (req, res) => {
    const { email, password, tenant, materialType } = req.body;
    if (email) appConfig.email = email;
    if (password) appConfig.password = password;
    if (tenant) appConfig.tenant = tenant;
    if (materialType) appConfig.materialType = materialType;
    authTokenCache = { token: null, expiry: null }; // Clear cache
    req.session.adminMessage = 'Configuration saved successfully!';
    res.redirect('/admin');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Mock Integration App running on http://localhost:${PORT}`);
});
