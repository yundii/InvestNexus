import * as dotenv from "dotenv";
dotenv.config();
import express from "express";
import pkg from "@prisma/client";
import morgan from "morgan";
import cors from "cors";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import bcrypt from "bcrypt";
import {searchStock, fetchAndStoreStockNews, fetchTopicNews} from './services/stockService.js';
import multer from 'multer';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Redis from 'redis';
import cron from 'node-cron';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    credentials: true
  }
});

// Redis client setup
const redisClient = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect().catch(console.error);

app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan("dev"));
app.use(cookieParser());

const { PrismaClient } = pkg;
const prisma = new PrismaClient();

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join-portfolio', (userId) => {
    socket.join(`portfolio-${userId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Background job to update stock prices every 30 seconds
cron.schedule('*/30 * * * * *', async () => {
  try {
    // Get all stocks from database
    const stocks = await prisma.stock.findMany();
    
    for (const stock of stocks) {
      try {
        const stockData = await searchStock(stock.stockName);
        
        // Update stock prices in database
        await prisma.stock.update({
          where: { id: stock.id },
          data: {
            openPrice: stockData.openPrice,
            closePrice: stockData.closePrice
          }
        });
        
        // Cache the updated price in Redis for 30 seconds
        await redisClient.setEx(`stock:${stock.stockName}`, 30, JSON.stringify(stockData));
        
        // Broadcast price update to all connected clients
        io.emit('stock-price-update', {
          symbol: stock.stockName,
          price: stockData.closePrice,
          openPrice: stockData.openPrice
        });
        
      } catch (error) {
        console.error(`Error updating ${stock.stockName}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in stock price update job:', error);
  }
});

// Middleware to verify JWT token
function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

// Test endpoint
app.get("/ping", (req, res) => {
  res.send("pong");
});

// Stock search endpoint
app.get("/stocks/search", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: "Search query is required" });
    }
    
    const stockData = await searchStock(q);
    res.json(stockData);
  } catch (error) {
    console.error('Error searching stock:', error);
    res.status(404).json({ error: "Stock not found" });
  }
});

// Stock details endpoint
app.get("/stocks/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    
    // Check Redis cache first
    const cachedData = await redisClient.get(`stock:${symbol}`);
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }
    
    const stockData = await searchStock(symbol);
    
    // Cache the result for 30 seconds
    await redisClient.setEx(`stock:${symbol}`, 30, JSON.stringify(stockData));
    
    res.json(stockData);
  } catch (error) {
    console.error('Error fetching stock details:', error);
    res.status(404).json({ error: "Stock not found" });
  }
});

// Register endpoint
app.post("/register", async (req, res) => {
  const { email, password, userName, phoneNumber } = req.body;
  
  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: { 
        email, 
        password: hashedPassword, 
        userName,
        phoneNumber,
        userPhoto: "",  // Optional: Set default value
        likeList: ""    // Optional: Set default value
      },
      select: { 
        id: true, 
        email: true, 
        userName: true,
        phoneNumber: true 
      },
    });

    res.json(newUser);
  } catch (error) {
    res.status(400).json({ error: "Failed to create user" });
  }
});

// Login endpoint
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const payload = { userId: user.id };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "15m" });
    res.cookie("token", token, { httpOnly: true, maxAge: 15 * 60 * 1000 });

    const userData = {
      id: user.id,
      email: user.email,
      userName: user.userName,
      phoneNumber: user.phoneNumber,
      likeList: user.likeList,
      purchasedStock: user.purchasedStock,
      userPhoto: user.userPhoto
    };

    res.json(userData);
  } catch (error) {
    res.status(400).json({ error: "Login failed" });
  }
});

// Logout endpoint
app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out successfully" });
});

// Update username endpoint
app.put('/update-username', requireAuth, async (req, res) => {
  try {
    const { username } = req.body;

    // Validate username exists
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Check if username is already taken
    const existingUser = await prisma.user.findFirst({
      where: {
        userName: username,
        NOT: {
          id: req.userId
        }
      }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    // Update username
    const updatedUser = await prisma.user.update({
      where: { id: req.userId },
      data: { userName: username },
      select: {
        id: true,
        email: true,
        userName: true,
        phoneNumber: true,
        likeList: true,
        userPhoto: true
      }
    });

    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating username:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update password endpoint
app.put('/update-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validate request body
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    // Get user with current password
    const user = await prisma.user.findUnique({
      where: { id: req.userId }
    });

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    const updatedUser = await prisma.user.update({
      where: { id: req.userId },
      data: { password: hashedPassword },
      select: {
        id: true,
        email: true,
        userName: true,
        phoneNumber: true,
        likeList: true,
        userPhoto: true
      }
    });

    res.json({ message: 'Password updated successfully', user: updatedUser });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


const storage = multer.diskStorage({
  destination: './uploads/',  
  filename: function(req, file, cb) {
    cb(null, 'user-' + req.userId + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// add static file server for user photo
app.use('/uploads', express.static('uploads'));

// Update userphoto endpoint
app.put('/update-photo', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const photoUrl = `http://localhost:8000/uploads/${req.file.filename}`;

    const updatedUser = await prisma.user.update({
      where: { id: req.userId },
      data: { userPhoto: photoUrl },
      select: {
        id: true,
        email: true,
        userName: true,
        phoneNumber: true,
        likeList: true,
        userPhoto: true
      }
    });

    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user photo:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Get all purchased stocks for the logged-in user
app.get("/purchased-stocks", requireAuth, async (req, res) => {
  try {
    const purchasedStocks = await prisma.purchasedStock.findMany({
      where: {
        userId: req.userId
      },
      include: {
        stock: true  // Include the related stock details
      }
    });
    
    res.json(purchasedStocks);
  } catch (error) {
    res.status(400).json({ error: "Failed to fetch purchased stocks" });
  }
});

// Add a new stock purchase record
app.post("/purchased-stocks", requireAuth, async (req, res) => {
  const { stockName, purchasedPrice, number } = req.body;
  
  try {

    const stockData = await searchStock(stockName);
    
    let stock = await prisma.stock.findFirst({
      where: { stockName: stockData.stockName }
    });

    if (!stock) {
      stock = await prisma.stock.create({
        data: {
          stockName: stockData.stockName,
          openPrice: stockData.openPrice,
          closePrice: stockData.closePrice
        }
      });
    }


    const newPurchase = await prisma.purchasedStock.create({
      data: {
        userId: req.userId,
        stockId: stock.id,
        purchasedDate: new Date(),
        purchasedPrice: purchasedPrice,
        latestPrice: stockData.closePrice,
        number: number
      },
      include: {
        stock: true
      }
    });

    const existingNews = await prisma.financeNews.findFirst({
      where: {
        stockId: stock.id
      }
    });

    
    if (!existingNews) {
      try {
        await fetchAndStoreStockNews(stock.stockName, prisma);
      } catch (newsError) {
        console.error('Error fetching news for purchased stock:', newsError);
      }
    }

    res.status(201).json(newPurchase);
  } catch (error) {
    console.error('Error in purchased-stocks endpoint:', error);
    res.status(400).json({ error: "Failed to create purchase record" });
  }
});

// Delete one or multiple purchased stocks
app.delete("/purchased-stocks", requireAuth, async (req, res) => {
  const { ids } = req.body;  
  
  try {
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: "ids must be an array" });
    }

    const deleteResult = await prisma.purchasedStock.deleteMany({
      where: {
        AND: [
          { userId: req.userId },
          { id: { in: ids } }  
        ]
      }
    });

    res.json({ 
      message: "Purchase records deleted successfully", 
      deletedCount: deleteResult.count
    });
  } catch (error) {
    console.error('Error in delete purchased-stocks endpoint:', error);
    res.status(500).json({ error: "Failed to delete purchase records" });
  }
});


// Add stock to user's like list
app.post('/like-stock', requireAuth, async (req, res) => {
    try {
        const { symbol } = req.body;
        
        if (!symbol) {
            return res.status(400).json({ error: 'Stock symbol is required' });
        }

        // First get the stock data and ensure it exists in our database
        const stockData = await searchStock(symbol);
        let stock = await prisma.stock.findFirst({
            where: { stockName: stockData.stockName }
        });

        if (!stock) {
            stock = await prisma.stock.create({
                data: {
                    stockName: stockData.stockName,
                    openPrice: stockData.openPrice,
                    closePrice: stockData.closePrice
                }
            });
        }

        // Get current user and their like list
        const user = await prisma.user.findUnique({
            where: { id: req.userId }
        });

        // Parse the existing like list or create empty array if none exists
        const currentLikeList = user.likeList ? user.likeList.split(',').filter(name => name !== '') : [];
        
        // Check if stock is already in like list
        if (currentLikeList.includes(stock.stockName)) {
            return res.status(400).json({ error: 'Stock already in like list' });
        }

        // Add new stock name to like list
        currentLikeList.push(stock.stockName);

        // Update user's like list
        const updatedUser = await prisma.user.update({
            where: { id: req.userId },
            data: {
                likeList: currentLikeList.join(',')
            },
            select: {
                id: true,
                email: true,
                userName: true,
                likeList: true
            }
        });

        const existingNews = await prisma.financeNews.findFirst({
          where: {
              stockId: stock.id
          }
      });

      
      if (!existingNews) {
          try {
              await fetchAndStoreStockNews(stock.stockName, prisma);
          } catch (newsError) {
              console.error('Error fetching news for liked stock:', newsError);
          }
      }

        res.json(updatedUser);
    } catch (error) {
        console.error('Error in like-stock endpoint:', error);
        res.status(500).json({ 
            error: error.message || 'Error adding stock to like list' 
        });
    }
});

// Delete stocks from user's like list
app.delete('/like-stock', requireAuth, async (req, res) => {
    try {
        const { symbol } = req.body;
        
        if (!symbol) {
            return res.status(400).json({ error: 'Stock symbol is required' });
        }

        // Get current user and their like list
        const user = await prisma.user.findUnique({
            where: { id: req.userId }
        });

        // Parse the existing like list
        const currentLikeList = user.likeList ? user.likeList.split(',').filter(name => name !== '') : [];
        
        // Check if stock exists in like list
        if (!currentLikeList.includes(symbol)) {
            return res.status(400).json({ error: 'Stock not found in like list' });
        }

        // Remove the stock from like list
        const updatedLikeList = currentLikeList.filter(stock => stock !== symbol);

        // Update user's like list
        const updatedUser = await prisma.user.update({
            where: { id: req.userId },
            data: {
                likeList: updatedLikeList.join(',')
            },
            select: {
                id: true,
                email: true,
                userName: true,
                likeList: true
            }
        });

        res.json(updatedUser);
    } catch (error) {
        console.error('Error in delete like-stock endpoint:', error);
        res.status(500).json({ 
            error: error.message || 'Error removing stock from like list' 
        });
    }
});

// Get stock news endpoint
app.get('/stock-news/:symbol', requireAuth, async (req, res) => {
    try {
        const { symbol } = req.params;
        
        if (!symbol) {
            return res.status(400).json({ error: 'Stock symbol is required' });
        }

        const stock = await prisma.stock.findFirst({
            where: { stockName: symbol }
        });

        if (!stock) {
            return res.status(404).json({ error: 'Stock not found' });
        }

        
        const news = await prisma.financeNews.findMany({
            where: {
                stockId: stock.id
            },
            orderBy: {
                date: 'desc' 
            }
        });

        res.json(news);
    } catch (error) {
        console.error('Error fetching stock news:', error);
        res.status(500).json({ 
            error: error.message || 'Error fetching stock news' 
        });
    }
});

// post topic news endpoint
app.post('/topic-news', requireAuth, async (req, res) => {
    try {
        const { topics } = req.body;
        
        if (!topics || !Array.isArray(topics)) {
            return res.status(400).json({ 
                error: 'Topics must be provided as an array' 
            });
        }

        // validate topics are valid
        const validTopics = [
            'blockchain', 'earnings', 'ipo', 'mergers_and_acquisitions',
            'financial_markets', 'economy_fiscal', 'economy_monetary',
            'economy_macro', 'energy_transportation', 'finance',
            'life_sciences', 'manufacturing', 'real_estate',
            'retail_wholesale', 'technology'
        ];

        const invalidTopics = topics.filter(topic => !validTopics.includes(topic));
        if (invalidTopics.length > 0) {
            return res.status(400).json({
                error: `Invalid topics: ${invalidTopics.join(', ')}`
            });
        }

        const result = await fetchTopicNews(topics.join(','), prisma);
        
        res.json({
            message: `Successfully stored ${result.count} new articles`,
            count: result.count
        });
    } catch (error) {
        console.error('Error in topic-news endpoint:', error);
        res.status(500).json({ 
            error: error.message || 'Error fetching and storing topic news' 
        });
    }
});

// get topic news endpoint
app.get('/topic-news/:topic', requireAuth, async (req, res) => {
    try {
        const { topic } = req.params;
        
        const news = await prisma.financeNews.findMany({
            where: {
                topic: {
                    contains: topic
                }
            },
            orderBy: {
                date: 'desc'
            }
        });

        res.json(news);
    } catch (error) {
        console.error('Error fetching topic news:', error);
        res.status(500).json({ 
            error: error.message || 'Error fetching topic news' 
        });
    }
});

// Portfolio summary endpoint
app.get("/portfolio", requireAuth, async (req, res) => {
  try {
    const purchasedStocks = await prisma.purchasedStock.findMany({
      where: { userId: req.userId },
      include: { stock: true }
    });
    
    let totalValue = 0;
    let totalCost = 0;
    const portfolio = [];
    
    for (const purchase of purchasedStocks) {
      const currentPrice = parseFloat(purchase.stock.closePrice);
      const cost = parseFloat(purchase.purchasedPrice);
      const shares = purchase.number;
      
      const currentValue = currentPrice * shares;
      const totalCostForStock = cost * shares;
      const profitLoss = currentValue - totalCostForStock;
      const profitLossPercent = ((profitLoss / totalCostForStock) * 100);
      
      portfolio.push({
        ...purchase,
        currentValue,
        totalCost: totalCostForStock,
        profitLoss,
        profitLossPercent
      });
      
      totalValue += currentValue;
      totalCost += totalCostForStock;
    }
    
    const totalProfitLoss = totalValue - totalCost;
    const totalProfitLossPercent = totalCost > 0 ? ((totalProfitLoss / totalCost) * 100) : 0;
    
    res.json({
      portfolio,
      summary: {
        totalValue,
        totalCost,
        totalProfitLoss,
        totalProfitLossPercent
      }
    });
  } catch (error) {
    console.error('Error fetching portfolio:', error);
    res.status(500).json({ error: "Failed to fetch portfolio" });
  }
});

server.listen(8000, () => {
  console.log("Server running on http://localhost:8000 🎉 🚀");
  console.log("WebSocket server ready for real-time updates");
});
