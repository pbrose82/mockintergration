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

// Mock database for materials (in production, use real database)
let mockMaterials = [
  {
    id: 'MOCK-001',
    tradeName: 'Demo Polymer A-100',
    category: 'Raw material',
    materialStatus: 'Research',
    transferStatus: 'Pending',
    lastModified: new Date().toISOString()
  },
  {
    id: 'MOCK-002',
    tradeName: 'Test Compound XY-50',
    category: 'Intermediate',
    materialStatus: 'Experimental',
    transferStatus: 'Pending',
    lastModified: new Date().toISOString()
  }
];

// Helper function to get Alchemy auth token
async function getAlchemyToken() {
  if (authTokenCache.token && authTokenCache.expiry && new Date(authTokenCache.expiry) > new Date()) {
    return authTokenCache.token;
  }

  try {
    const response = await axios.post(`${process.env.ALCHEMY_API_BASE_URL}/sign-in`, {
      email: process.env.ALCHEMY_EMAIL,
      password: process.env.ALCHEMY_PASSWORD
    });

    const authData = response.data;
    let token = null;

    if (authData.tenant === process.env.ALCHEMY_TENANT) {
      token = authData.accessToken;
    } else {
      const tenantData = authData.tokens.find(t => t.tenant === process.env.ALCHEMY_TENANT);
      if (tenantData) token = tenantData.accessToken;
    }

    if (!token) throw new Error(`No access token found for tenant: ${process.env.ALCHEMY_TENANT}`);

    // Parse JWT to get expiry
    const tokenParts = token.split('.');
    const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
    const expiryTime = new Date(payload.exp * 1000);

    authTokenCache = { token, expiry: expiryTime };
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
      tenant: process.env.ALCHEMY_TENANT,
      configured: !!(process.env.ALCHEMY_EMAIL && process.env.ALCHEMY_PASSWORD)
    }
  });
  req.session.message = null;
});

app.get('/admin', (req, res) => {
  res.render('admin', {
    config: {
      email: process.env.ALCHEMY_EMAIL || '',
      tenant: process.env.ALCHEMY_TENANT || 'productcaseelnlims',
      materialType: process.env.ALCHEMY_MATERIAL_TYPE || '982',
      apiUrl: process.env.ALCHEMY_API_BASE_URL
    }
  });
});

app.post('/api/transfer', async (req, res) => {
  const { materialId } = req.body;
  const material = mockMaterials.find(m => m.id === materialId);

  if (!material) {
    return res.status(404).json({ error: 'Material not found' });
  }

  try {
    const token = await getAlchemyToken();
    
    // Generate external code
    const externalCode = `MOCK-${Date.now().toString(36).toUpperCase()}`;
    
    // Prepare Alchemy payload
    const payload = {
      fields: [
        { identifier: "TradeName", rows: [{ row: 0, values: [{ value: material.tradeName }] }] },
        { identifier: "Category", rows: [{ row: 0, values: [{ value: material.category }] }] },
        { identifier: "MaterialStatus", rows: [{ row: 0, values: [{ value: material.materialStatus }] }] },
        { identifier: "ExternalCode", rows: [{ row: 0, values: [{ value: externalCode }] }] },
        { identifier: "ProducedBy", rows: [{ row: 0, values: [{ value: "700" }] }] }
      ],
      materialType: parseInt(process.env.ALCHEMY_MATERIAL_TYPE),
      calculatedPropertiesTable: [],
      formulationTable: [],
      measuredPropertiesList: []
    };

    const createResponse = await axios.post(
      `${process.env.ALCHEMY_API_BASE_URL}/create-material`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const alchemyMaterialId = createResponse.data.materialId;

    // Get the Alchemy code
    const readResponse = await axios.get(
      `${process.env.ALCHEMY_API_BASE_URL}/read-record?id=${alchemyMaterialId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    const codeField = readResponse.data.fields.find(field => field.identifier === 'Code');
    const alchemyCode = codeField?.rows[0]?.values[0]?.value || 'N/A';

    // Update local material
    material.transferStatus = 'Transferred';
    material.alchemyCode = alchemyCode;
    material.alchemyId = alchemyMaterialId;
    material.alchemyUrl = `https://app.alchemy.cloud/${process.env.ALCHEMY_TENANT}/record/${alchemyMaterialId}`;
    material.lastModified = new Date().toISOString();

    res.json({
      success: true,
      alchemyCode,
      alchemyUrl: material.alchemyUrl
    });

  } catch (error) {
    console.error('Transfer error:', error.message);
    res.status(500).json({ 
      error: 'Transfer failed', 
      message: error.response?.data?.message || error.message 
    });
  }
});

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

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong!');
});

app.listen(PORT, () => {
  console.log(`Mock Integration App running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to view the demo`);
});
