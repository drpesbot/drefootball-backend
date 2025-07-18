const express = require('express');
const cors = require('cors');
const AWS = require('aws-sdk');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();

// دالة لتحويل قيم Decimal من DynamoDB
function sanitize(data) {
    if (Array.isArray(data)) {
        return data.map(sanitize);
    } else if (data !== null && typeof data === 'object') {
        if (data.constructor && data.constructor.name === 'Decimal') {
            return data % 1 === 0 ? parseInt(data.toString()) : parseFloat(data.toString());
        }
        const result = {};
        for (const key in data) {
            result[key] = sanitize(data[key]);
        }
        return result;
    }
    return data;
}

// Enable CORS for all origins
app.use(cors());
app.use(express.json());

// Configure AWS using environment variables
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const dynamodb = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

const TABLE_NAME = 'drefotball_players';
const BUCKET_NAME = 'drefotball-player-images';

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Authentication endpoint
app.post('/api/auth', async (req, res) => {
  try {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'killer8speed';
    
    if (password === adminPassword) {
      res.json({ success: true, message: 'Authentication successful' });
    } else {
      res.status(401).json({ success: false, message: 'Invalid password' });
    }
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all players
app.get('/api/players', async (req, res) => {
    try {
        const params = {
            TableName: TABLE_NAME
        };
        
        const result = await dynamodb.scan(params).promise();
        const sanitizedPlayers = sanitize(result.Items);
        res.json(sanitizedPlayers);
    } catch (error) {
        console.error('Error fetching players:', error);
        res.status(500).json({ error: 'Failed to fetch players' });
    }
});

// Add new player
app.post('/api/players', async (req, res) => {
  try {
    const { password, player } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'killer8speed';
    
    if (password !== adminPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const playerId = Date.now().toString();
    const playerData = {
      id: playerId,
      ...player,
      createdAt: new Date().toISOString()
    };

    const params = {
      TableName: TABLE_NAME,
      Item: playerData
    };

    await dynamodb.put(params).promise();
    const sanitizedPlayer = sanitize(playerData);
    res.json({ success: true, player: sanitizedPlayer });
  } catch (error) {
    console.error('Error adding player:', error);
    res.status(500).json({ error: 'Failed to add player' });
  }
});

// Update player
app.put('/api/players/:id', async (req, res) => {
  try {
    const { password, player } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'killer8speed';
    
    if (password !== adminPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const playerData = {
      ...player,
      id,
      updatedAt: new Date().toISOString()
    };

    const params = {
      TableName: TABLE_NAME,
      Item: playerData
    };

    await dynamodb.put(params).promise();
    const sanitizedPlayer = sanitize(playerData);
    res.json({ success: true, player: sanitizedPlayer });
  } catch (error) {
    console.error('Error updating player:', error);
    res.status(500).json({ error: 'Failed to update player' });
  }
});

// Delete player
app.delete('/api/players/:id', async (req, res) => {
  try {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'killer8speed';
    
    if (password !== adminPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;

    const params = {
      TableName: TABLE_NAME,
      Key: { id }
    };

    await dynamodb.delete(params).promise();
    res.json({ success: true, message: 'Player deleted successfully' });
  } catch (error) {
    console.error('Error deleting player:', error);
    res.status(500).json({ error: 'Failed to delete player' });
  }
});

// Upload image
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'killer8speed';
    
    if (password !== adminPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileName = `${uuidv4()}-${req.file.originalname}`;
    
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype
    };

    const result = await s3.upload(uploadParams).promise();
    res.json({ success: true, imageUrl: result.Location });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Export the Express app
module.exports = app;

