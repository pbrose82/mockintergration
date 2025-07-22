// server.js — Refactored to use Alchemy V2 API
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
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
    cookie: { secure: false }
}));

// Cache auth token
let authTokenCache = {
    token: null,
    expiry: null
};

// Config
let appConfig = {
    email: process.env.ALCHEMY_EMAIL || '',
    password: process.env.ALCHEMY_PASSWORD || '',
    tenant: process.env.ALCHEMY_TENANT || 'productcaseelnlims',
    materialType: parseInt(process.env.ALCHEMY_MATERIAL_TYPE || '982'),
    producedBy: '700',
    externalCodeFormat: 'SHORT_UUID'
};

// Mock DB
let mockMaterials = [
    { id: 'MOCK-001', tradeName: 'Demo Polymer A-100', category: 'Raw material', materialStatus: 'Research', transferStatus: 'Pending', alchemyCode: null, alchemyUrl: null },
    { id: 'MOCK-002', tradeName: 'Test Compound XY-50', category: 'Intermediate', materialStatus: 'Experimental', transferStatus: 'Pending', alchemyCode: null, alchemyUrl: null }
];

// Helpers
function shortUUID() {
    return crypto.randomUUID().split('-')[0];
}

async function getAlchemyToken() {
    if (authTokenCache.token && authTokenCache.expiry && new Date(authTokenCache.expiry) > new Date()) {
        return authTokenCache.token;
    }
    const { email, password, tenant } = appConfig;
    if (!email || !password) throw new Error('Alchemy credentials are missing');

    const response = await axios.post('https://core-production.alchemy.cloud/core/api/v2/sign-in', { email, password });
    const tokens = response.data.tokens || [];
    const token = tokens.find(t => t.tenant === tenant)?.accessToken;

    if (!token) throw new Error('No access token found for tenant: ' + tenant);

    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    authTokenCache = { token, expiry: new Date(payload.exp * 1000) };

    return token;
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
            tenant: appConfig.tenant,
            materialType: appConfig.materialType,
            apiUrl: 'https://core-production.alchemy.cloud/core/api/v2',
            hasPassword: !!appConfig.password
        },
        message: req.session.adminMessage || null
    });
    req.session.adminMessage = null;
});

app.post('/api/transfer', async (req, res) => {
    const { materialId } = req.body;
    const material = mockMaterials.find(m => m.id === materialId);
    if (!material) return res.status(404).json({ success: false, message: 'Material not found' });

    try {
        const token = await getAlchemyToken();
        const externalCode = shortUUID();
        const payload = {
            materialType: appConfig.materialType,
            calculatedPropertiesTable: [],
            formulationTable: [],
            measuredPropertiesList: [],
            fields: [
                { identifier: 'TradeName', rows: [{ row: 0, values: [{ value: material.tradeName }] }] },
                { identifier: 'Category', rows: [{ row: 0, values: [{ value: material.category }] }] },
                { identifier: 'MaterialStatus', rows: [{ row: 0, values: [{ value: material.materialStatus }] }] },
                { identifier: 'ProducedBy', rows: [{ row: 0, values: [{ value: appConfig.producedBy }] }] },
                { identifier: 'ExternalCode', rows: [{ row: 0, values: [{ value: externalCode }] }] }
            ]
        };

        const createRes = await axios.post('https://core-production.alchemy.cloud/core/api/v2/create-material', payload, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const materialId = createRes.data.materialId;
        await new Promise(resolve => setTimeout(resolve, 1500));
        console.log(`Waiting before fetching Code for material ID ${materialId}`);
        if (!materialId) throw new Error('Alchemy did not return a materialId');

        // Read Code field
        const readRes = await axios.get(`https://core-production.alchemy.cloud/core/api/v2/read-record?id=${materialId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const codeField = readRes.data.fields?.find(f => f.identifier === 'Code');
        const code = codeField?.rows[0]?.values[0]?.value || 'N/A';

        material.transferStatus = 'Transferred';
        material.alchemyCode = code;
        material.alchemyId = materialId;
        material.alchemyUrl = `https://app.alchemy.cloud/${appConfig.tenant}/record/${materialId}`;
        material.lastModified = new Date().toISOString();

        res.json({ success: true, alchemyCode: code, alchemyUrl: material.alchemyUrl });
    } catch (error) {
        console.error('Transfer error:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/save-credentials', (req, res) => {
    const { email, password, tenant, materialType } = req.body;
    if (email) appConfig.email = email;
    if (password) appConfig.password = password;
    if (tenant) appConfig.tenant = tenant;
    if (materialType) appConfig.materialType = parseInt(materialType);
    authTokenCache = { token: null, expiry: null };
    req.session.adminMessage = 'Configuration saved successfully!';
    res.redirect('/admin');
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

app.delete('/api/delete-material/:id', (req, res) => {
    const { id } = req.params;
    const index = mockMaterials.findIndex(m => m.id === id);
    if (index === -1) {
        return res.status(404).json({ error: 'Material not found' });
    }
    mockMaterials.splice(index, 1);
    res.json({ success: true, message: 'Material deleted successfully' });
});



app.post('/api/clear-token', (req, res) => {
    authTokenCache = { token: null, expiry: null };
    res.json({ success: true, message: 'Authentication token cleared. Next API call will re-authenticate.' });
});

app.post('/api/clear-credentials', (req, res) => {
    appConfig = {
        email: '',
        password: '',
        tenant: 'productcaseelnlims',
        materialType: 982,
        producedBy: '700',
        externalCodeFormat: 'SHORT_UUID'
    };
    authTokenCache = { token: null, expiry: null };
    res.json({ success: true, message: 'Credentials and token cleared.' });
});

    authTokenCache = { token: null, expiry: null };
    res.json({ success: true, message: 'Authentication token cleared. Next API call will re-authenticate.' });
});

app.post('/api/test-connection', async (req, res) => {
    try {
        await getAlchemyToken();
        res.json({ success: true, message: 'Connection successful!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
