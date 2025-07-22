const mongoose = require("mongoose");
const Settings = require("../models/Settings");

const express = require("express");
const cors = require("cors");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, PutCommand, UpdateCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const app = express();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error("MongoDB connection error:", err));

// التحقق من وجود متغير البيئة ADMIN_PASSWORD
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD environment variable is not set. Application cannot start without it.");
  process.exit(1);
}

// دالة لتحويل قيم Decimal من DynamoDB (قد لا تكون ضرورية بنفس الشكل مع v3)
function sanitize(data) {
    if (Array.isArray(data)) {
        return data.map(sanitize);
    } else if (data !== null && typeof data === "object") {
        // في v3، DynamoDBDocumentClient يتعامل مع الأرقام بشكل أفضل، قد لا نحتاج لهذا التحويل
        // إذا كانت هناك مشكلة في الأرقام العشرية، يمكن إعادة النظر في هذا الجزء
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

// Configure AWS SDK v3 clients
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const dynamodb = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = "drefotball_players";
const BUCKET_NAME = "drefotball-player-images";

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Authentication endpoint
app.post("/api/auth", async (req, res) => {
  try {
    const { password } = req.body;
    
    if (password === ADMIN_PASSWORD) {
      res.json({ success: true, message: "Authentication successful" });
    } else {
      res.status(401).json({ success: false, message: "Invalid password" });
    }
  } catch (error) {
    console.error("Auth error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get all players
app.get("/api/players", async (req, res) => {
    try {
        const params = {
            TableName: TABLE_NAME
        };
        
        const result = await dynamodb.send(new ScanCommand(params));
        const sanitizedPlayers = sanitize(result.Items);
        res.json(sanitizedPlayers);
    } catch (error) {
        console.error("Error fetching players:", error);
        res.status(500).json({ error: "Failed to fetch players" });
    }
});

// Add new player
app.post("/api/players", async (req, res) => {
  try {
    console.log("Request Body:", req.body);
    const { player } = req.body;

    const playerId = Date.now().toString();
    const playerData = {
      id: playerId,
      ...player,
      image: player.image, // إضافة حقل الصورة
      createdAt: new Date().toISOString()
    };

    const params = {
      TableName: TABLE_NAME,
      Item: playerData
    };

    await dynamodb.send(new PutCommand(params));
    const sanitizedPlayer = sanitize(playerData);
    res.json({ success: true, player: sanitizedPlayer });
  } catch (error) {
    console.error("Error adding player:", error);
    res.status(500).json({ message: "Error saving player", error });
  }
});

// Update player
app.put("/api/players/:id", async (req, res) => {
  try {
    const { player } = req.body;

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

    await dynamodb.send(new PutCommand(params));
    const sanitizedPlayer = sanitize(playerData);
    res.json({ success: true, player: sanitizedPlayer });
  } catch (error) {
    console.error("Error updating player:", error);
    res.status(500).json({ error: "Failed to update player" });
  }
});

// Delete player
app.delete("/api/players/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const params = {
      TableName: TABLE_NAME,
      Key: { id }
    };

    await dynamodb.send(new DeleteCommand(params));
    res.json({ success: true, message: "Player deleted successfully" });
  } catch (error) {
    console.error("Error deleting player:", error);
    res.status(500).json({ error: "Failed to delete player" });
  }
});

// Upload image
app.post("/api/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileName = `${uuidv4()}-${req.file.originalname}`;
    
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype
    };

    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);
    
    const imageUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com/${fileName}`;
    res.json({ success: true, imageUrl: imageUrl });
  } catch (error) {
    console.error("Error uploading image:", error);
    res.status(500).json({ error: "Failed to upload image" });
  }
});

// Settings API
app.get("/api/settings", async (req, res) => {
  try {
    const settings = await Settings.findOne();
    res.json(settings || {});
  } catch (error) {
    console.error("Error fetching settings:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.put("/api/settings", async (req, res) => {
  try {
    const { welcomeScreen, contactUsButton } = req.body;
    let settings = await Settings.findOne();

    if (!settings) {
      settings = new Settings({ welcomeScreen, contactUsButton });
    } else {
      settings.welcomeScreen = welcomeScreen;
      settings.contactUsButton = contactUsButton;
    }
    await settings.save();
    res.json({ message: "Settings updated successfully", settings });
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Export the Express app
module.exports = app;

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


