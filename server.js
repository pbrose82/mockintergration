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

// Mock Products DB
let mockProducts = [];

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
        message: req.session.materialMessage || null,
        config: {
            tenant: appConfig.tenant,
            configured: !!(appConfig.email && appConfig.password)
        }
    });
    req.session.materialMessage = null;
});

app.get('/products', (req, res) => {
    res.render('products', {
        products: mockProducts,
        message: req.session.productMessage || null,
        config: {
            tenant: appConfig.tenant,
            configured: !!(appConfig.email && appConfig.password)
        }
    });
    req.session.productMessage = null;
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
        await new Promise(resolve => setTimeout(resolve, 2000));
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

// New API endpoint to receive product data from Alchemy
app.post('/api/products/receive', (req, res) => {
    try {
        const productData = req.body;
        
        // Validate required fields
        const requiredFields = ['Code', 'ProductName', 'RecordID'];
        for (const field of requiredFields) {
            if (!productData[field]) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Missing required field: ${field}` 
                });
            }
        }
        
        // Check if product already exists (by RecordID)
        const existingIndex = mockProducts.findIndex(p => p.RecordID === productData.RecordID);
        
        // Use tenant from request data if provided, otherwise use default
        const tenant = productData.Tenant || appConfig.tenant;
        
        const product = {
            Code: productData.Code,
            ProductName: productData.ProductName,
            Family: productData.Family || '-',
            Subfamily: productData.Subfamily || '-',
            SKU: productData.SKU || '-',
            CreatedOn: productData.CreatedOn || new Date().toISOString(),
            ProductStatus: productData.ProductStatus || 'Active',
            RecordID: productData.RecordID,
            AlchemyURL: `https://app.alchemy.cloud/${tenant}/record/${productData.RecordID}`,
            ReceivedAt: new Date().toISOString(),
            Tenant: tenant
        };
        
        if (existingIndex !== -1) {
            // Update existing product
            mockProducts[existingIndex] = product;
            console.log(`Updated product: ${product.Code}`);
        } else {
            // Add new product
            mockProducts.unshift(product);
            console.log(`Added new product: ${product.Code}`);
        }
        
        res.json({ 
            success: true, 
            message: `Product ${product.Code} received successfully`,
            product: product
        });
    } catch (error) {
        console.error('Error receiving product:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to process product data: ' + error.message 
        });
    }
});

// Add material
app.post('/api/add-material', (req, res) => {
    const { tradeName, category, materialStatus } = req.body;
    
    // Generate a new mock ID
    const newId = 'MOCK-' + String(mockMaterials.length + 1).padStart(3, '0');
    
    const newMaterial = {
        id: newId,
        tradeName,
        category,
        materialStatus,
        transferStatus: 'Pending',
        alchemyCode: null,
        alchemyUrl: null
    };
    
    mockMaterials.push(newMaterial);
    req.session.materialMessage = `Material "${tradeName}" added successfully!`;
    res.redirect('/');
});

// Delete product
app.delete('/api/delete-product/:recordId', (req, res) => {
    const { recordId } = req.params;
    console.log('Delete request for product with RecordID:', recordId);
    console.log('Current products:', mockProducts.map(p => ({ RecordID: p.RecordID, Code: p.Code, type: typeof p.RecordID })));
    
    // Convert recordId to both string and number for comparison
    const index = mockProducts.findIndex(p => 
        p.RecordID === recordId || 
        p.RecordID === parseInt(recordId) || 
        String(p.RecordID) === recordId
    );
    
    if (index === -1) {
        console.log('Product not found with RecordID:', recordId);
        return res.status(404).json({ 
            success: false, 
            message: 'Product not found' 
        });
    }
    
    const deletedProduct = mockProducts[index];
    mockProducts.splice(index, 1);
    console.log('Deleted product:', deletedProduct.Code);
    
    res.json({ success: true, message: 'Product deleted successfully' });
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
        return res.status(404).json({ 
            success: false, 
            message: 'Material not found' 
        });
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
        return res.status(404).json({ 
            success: false, 
            message: 'Material not found' 
        });
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

app.post('/api/change-tenant', (req, res) => {
    const { tenant } = req.body;
    if (!tenant || !tenant.trim()) {
        return res.status(400).json({ 
            success: false, 
            message: 'Tenant name is required' 
        });
    }
    
    appConfig.tenant = tenant.trim();
    authTokenCache = { token: null, expiry: null };
    
    res.json({ 
        success: true, 
        message: `Tenant changed to: ${appConfig.tenant}` 
    });
});

app.post('/api/test-connection', async (req, res) => {
    try {
        await getAlchemyToken();
        res.json({ success: true, message: 'Connection successful!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/guide', (req, res) => {
    res.render('guide', {
        config: {
            email: appConfig.email || '',
            hasPassword: !!appConfig.password
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
