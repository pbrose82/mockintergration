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

// Store for auth tokens (in production, use Redis or similar)
let authTokenCache = {
    token: null,
    expiry: null
};

// Configuration store (in production, use database)
let appConfig = {
    email: process.env.ALCHEMY_EMAIL || '',
    password: process.env.ALCHEMY_PASSWORD || '',
    tenant: process.env.ALCHEMY_TENANT || 'productcaseelnlims',
    materialType: process.env.ALCHEMY_MATERIAL_TYPE || '982'
};

// Mock database for materials (in production, use real database)
let mockMaterials = [
    { id: 'MOCK-001', tradeName: 'Demo Polymer A-100', category: 'Raw material', materialStatus: 'Research', transferStatus: 'Pending', alchemyCode: null, alchemyUrl: null, lastModified: new Date().toISOString() },
    { id: 'MOCK-002', tradeName: 'Test Compound XY-50', category: 'Intermediate', materialStatus: 'Experimental', transferStatus: 'Pending', alchemyCode: null, alchemyUrl: null, lastModified: new Date().toISOString() }
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

// Routes
app.get('/', (req, res) => {
    res.render('index', {
        materials: mockMaterials,
        message: req.session.message || null,
        config: {
            tenant: appConfig.tenant,
            configured: !!(appConfig.email && appConfig.password)
        }
    });
    req.session.message = null;
});

app.get('/admin', (req, res) => {
    res.render('admin', {
        config: {
            email: appConfig.email || '',
            tenant: appConfig.tenant || 'productcaseelnlims',
            materialType: appConfig.materialType || '982',
            apiUrl: process.env.ALCHEMY_API_BASE_URL,
            hasPassword: !!appConfig.password
        },
        message: req.session.adminMessage || null
    });
    req.session.adminMessage = null;
});


// --- THIS IS THE UPDATED AND CORRECTED API ROUTE ---
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

        // 1. CREATE the material using the correct V3 endpoint and payload
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
        await new Promise(resolve => setTimeout(resolve, 2000)); // Delay for indexing

        // 2. READ the record back using the correct V3 endpoint
        console.log('Step 2: Reading generated code from Alchemy...');
        const readResponse = await axios.get(`${V3_API_URL}/${alchemyMaterialId}/fields`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const fields = readResponse.data.fields || [];
        const codeField = fields.find(field => field.identifier === 'Code');
        const alchemyCode = codeField?.rows[0]?.values[0]?.value || 'N/A';
        
        if (alchemyCode === 'N/A') {
            console.warn("⚠️ Could not find 'Code' field in the response from Alchemy.");
        } else {
            console.log(`✅ Read successful. Found Alchemy Code: ${alchemyCode}`);
        }

        // 3. Update your local mock database
        material.transferStatus = 'Transferred';
        material.alchemyCode = alchemyCode;
        material.alchemyId = alchemyMaterialId;
        material.alchemyUrl = `https://app.alchemy.cloud/${appConfig.tenant}/record/${alchemyMaterialId}`;
        material.lastModified = new Date().toISOString();

        // 4. Send the successful result back to the frontend
        res.json({ success: true, alchemyCode, alchemyUrl: material.alchemyUrl });

    } catch (error) {
        console.error('--- TRANSFER ERROR ---');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error Message:', error.message);
        }
        res.status(500).json({ success: false, message: error.response?.data?.message || error.message });
    }
});
// --- END OF THE CORRECTED API ROUTE ---


app.post('/api/test-connection', async (req, res) => {
    try {
        await getAlchemyToken();
        res.json({ success: true, message: 'Connection successful!' });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.post('/api/add-material', (req, res) => {
    const { tradeName, category, materialStatus } = req.body;
    const newMaterial = {
        id: `MOCK-${String(mockMaterials.length + 1).padStart(3, '0')}`,
        tradeName,
        category,
        materialStatus,
        transferStatus: 'Pending',
        lastModified: new Date().toISOString()
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
    authTokenCache = { token: null, expiry: null };
    req.session.adminMessage = 'Configuration saved successfully!';
    res.redirect('/admin');
});

app.post('/api/change-tenant', (req, res) => {
    const { tenant } = req.body;
    if (tenant) {
        appConfig.tenant = tenant;
        authTokenCache = { token: null, expiry: null };
        res.json({ success: true, message: `Tenant changed to: ${tenant}` });
    } else {
        res.status(400).json({ success: false, message: 'Tenant name is required' });
    }
});

app.post('/api/clear-token', (req, res) => {
    authTokenCache = { token: null, expiry: null };
    res.json({ success: true, message: 'Authentication token cleared. Next API call will re-authenticate.' });
});

app.delete('/api/delete-material/:id', (req, res) => {
    const { id } = req.params;
    const index = mockMaterials.findIndex(m => m.id === id);
    if (index === -1) {
        return res.status(404).json({ error: 'Material not found' });
    }
    mockMaterials.splice(index, 1);
    res.json({ success: true, message: 'Material deleted successfully' });
});

app.post('/api/revert-material/:id', (req, res) => {
    const { id } = req.params;
    const material = mockMaterials.find(m => m.id === id);
    if (!material) {
        return res.status(404).json({ error: 'Material not found' });
    }
    material.transferStatus = 'Pending';
    delete material.alchemyCode;
    delete material.alchemyId;
    delete material.alchemyUrl;
    material.lastModified = new Date().toISOString();
    authTokenCache = { token: null, expiry: null };
    res.json({ success: true, message: 'Material reverted to pending status' });
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong!');
});

app.listen(PORT, () => {
    console.log(`Mock Integration App running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to view the demo`);
});
