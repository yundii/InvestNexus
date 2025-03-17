# CS 5610 Final Project - Wealth Management 

## Project Description 
The website we intended to create is a stock management website “Wealth Management”. It allows users to create an account or log in to an existing one, providing a streamlined interface with sections for the homepage, explore, purchased stocks, finance news, and stock analysis. 

## Demo 🎬
[Demo Video](https://drive.google.com/file/d/14Xg-BQrA_z4vJOJH_D911VgNJ42Cf3ZM/view?usp=sharing)

## Website Functionality ✨
- **Homepage:** Users can navigate to explore, portfolio, finance news, profile, and stock analysis pages.
- **Explore:** Users can search for stocks by name or symbol, navigate to the stock details page. they can also view the market trends, hot stocks, and news.
- **Stock Details:** Users can view the details of a stock, including the price chart in different time intervals (1D,5D,1M,3M,6M,1Y,5Y,YTD). they can also like or add purchase record to their portfolio.
- **Portfolio:** Users can view their purchased stocks and their purchase details. and the news related to their purchased stocks.
- **News:** Users can view the news related to their liked stocks. they can also view the news by industry category.
- **Stock Analysis:** Users can view the analysis of their purchased stocks.
- **Profile:** Users can update their profile information, including name, password, and profile picture.

## Database📊
Our application uses MySQL as the database system, managed through Prisma ORM. Below are the detailed specifications for each table:

### User
- **Description:** Stores user account and authentication information
- **Fields:**
  - `id`: Unique identifier (Primary Key, Auto-increment)
  - `userName`: User's display name
  - `password`: Encrypted password string
  - `email`: Unique email address
  - `phoneNumber`: Contact number
  - `userPhoto`: Profile picture URL (Optional)
  - `likeList`: List of liked stocks (Optional)
- **CRUD Operations:**
  - **Create**: Register new user
  - **Read**: Retrieve user profile
  - **Update**: Modify user information
  - **Delete**: Remove user account

### Stock
- **Description:** Contains stock market information and pricing data
- **Fields:**
  - `id`: Unique identifier (Primary Key, Auto-increment)
  - `stockName`: Name of the stock
  - `openPrice`: Opening price
  - `closePrice`: Closing price
- **CRUD Operations:**
  - **Create**: Add new stock
  - **Read**: Get stock information


### PurchasedStock
- **Description:** Tracks user stock purchases and portfolio
- **Fields:**
  - `id`: Unique identifier (Primary Key, Auto-increment)
  - `userId`: Reference to User table
  - `stockId`: Reference to Stock table
  - `purchasedDate`: Date of purchase
  - `purchasedPrice`: Price at purchase
  - `latestPrice`: Current market price
  - `number`: Quantity purchased
- **CRUD Operations:**
  - **Create**: Record new stock purchase
  - **Read**: View purchase history
  - **Update**: Update stock quantities
  - **Delete**: Remove purchase record

### FinanceNews
- **Description:** Stores financial news articles related to stocks
- **Fields:**
  - `id`: Unique identifier (Primary Key, Auto-increment)
  - `stockId`: Reference to Stock table
  - `title`: News article title
  - `date`: Publication date
  - `topic`: News category/topic
  - `source`: News source
  - `news_url`: Link to full article
  - `banner_url`: News image URL (Optional)
- **CRUD Operations:**
  - **Create**: Add new news article
  - **Read**: Retrieve news articles


## Endpoints 📡
### Authentication
- **POST /register**
  - Register a new user
  - Body: `{ email, password, userName, phoneNumber }`
  - Returns: User object without sensitive data

- **POST /login**
  - Login user
  - Body: `{ email, password }`
  - Returns: User data and sets HTTP-only cookie with JWT

- **POST /logout**
  - Logout user
  - Clears authentication cookie

### User Profile Management
- **PUT /update-username**
  - Update user's username
  - Authentication required
  - Body: `{ username }`
  - Returns: Updated user object

- **PUT /update-password**
  - Update user's password
  - Authentication required
  - Body: `{ currentPassword, newPassword }`
  - Returns: Success message and updated user object

- **PUT /update-photo**
  - Update user's profile photo
  - Authentication required
  - Body: Form data with photo file
  - Returns: Updated user object with photo URL

### Stock Management
- **GET /purchased-stocks**
  - Get all purchased stocks for logged-in user
  - Authentication required
  - Returns: Array of purchased stocks with details

- **POST /purchased-stocks**
  - Add new stock purchase record
  - Authentication required
  - Body: `{ stockName, purchasedPrice, number }`
  - Returns: Created purchase record

- **DELETE /purchased-stocks**
  - Delete one or multiple purchased stocks
  - Authentication required
  - Body: `{ ids: [purchaseIds] }`
  - Returns: Deletion confirmation

### Stock Interactions
- **POST /like-stock**
  - Add stock to user's like list
  - Authentication required
  - Body: `{ symbol }`
  - Returns: Updated user object

- **DELETE /like-stock**
  - Remove stock from user's like list
  - Authentication required
  - Body: `{ symbol }`
  - Returns: Updated user object

### News
- **GET /stock-news/:symbol**
  - Get news articles for a specific stock
  - Authentication required
  - Returns: Array of news articles related to the stock

- **POST /topic-news**
  - Store news articles based on provided topics
  - Authentication required
  - Body: `{ topics: [topic1, topic2, ...] }`
  - Returns: Success message and count of stored articles

- **GET /topic-news/:topic**
  - Get news articles related to a specific topic
  - Authentication required
  - Returns: Array of news articles related to the topic

## External APIs 🌐
Our application integrates with several external APIs to provide real-time financial data:

### Alpha Vantage API (via RapidAPI)
- **Purpose:** Stock data and time series information
- **Endpoints Used:**
  - Time Series Daily: `/query?function=TIME_SERIES_DAILY`
  - Features:
    - Daily stock prices
    - Opening and closing prices
    - Stock symbol validation
    - Historical price data

### Real-Time Finance Data API (via RapidAPI)
- **Purpose:** Market trends and stock news
- **Endpoints Used:**
  - Market Trends: `/market-trends`
    - Features:
      - Most active stocks
      - Top gainers and losers
      - Price changes and percentages
      - Exchange information
  - Stock News: `/stock-news`
    - Features:
      - Company-specific news articles
      - Article titles and sources
      - News images
      - Publication dates

### Seeking Alpha API (via RapidAPI)
- **Purpose:** Detailed stock charts and historical data
- **Endpoints Used:**
  - Get Chart: `/symbols/get-chart`
  - Features:
    - Historical price data
    - Multiple time periods (1D, 5D, 1M, 6M, YTD, 1Y, 3Y, 5Y, 10Y)
    - Closing prices
    - Timestamp data

### Alpha Vantage News API
- **Purpose:** Topic-based financial news
- **Endpoints Used:**
  - News Sentiment: `/query?function=NEWS_SENTIMENT`
  - Features:
    - Industry-specific news
    - Multiple topic categories
    - News sentiment analysis
    - Publication timestamps
    - News sources and URLs


## Version Control and Collaboration
All team members have equal access to the project repository, created branches for different features, and can push their changes to the main branch after review. Each member is responsible for creating separate branches for individual features or bug fixes, following the GitHub Flow workflow. Regular commits and pulls are made to ensure that the main branch stays up-to-date and conflicts are minimized.

### Note on Contributions
If any contributions were not directly recorded in GitHub commits (e.g., discussions on project design, feature planning, or debugging sessions), these contributions are documented here along with the names of the responsible team members. This ensures that all work, including collaborative planning and problem-solving, is acknowledged.