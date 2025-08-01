import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthUser } from "../security/AuthContext";
import "../style/home.css";

export default function Home() {
  const { isAuthenticated } = useAuthUser();
  const navigate = useNavigate();
  const [marketData, setMarketData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMarketOverview = async () => {
      try {
        const response = await fetch('http://localhost:8000/market-overview', {
          credentials: 'include'
        });
        
        if (response.ok) {
          const data = await response.json();
          setMarketData(data);
        }
      } catch (error) {
        console.error('Error fetching market overview:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMarketOverview();
  }, []);

  return (
    <div className="home-container">
      <main className="hero-section">
        <div className="hero-content">
          <h1>
            CONNECT
            <br />
            ANALYZE
            <br />
            GROW
          </h1>
          <p className="hero-subtitle">
            Real-time investment dashboard with live market data and portfolio tracking
          </p>
          <button className="start-now-btn" onClick={() => navigate("/login")}>
            Start Now
          </button>
        </div>
      </main>

      {/* Market Overview Section */}
      {!loading && marketData && (
        <div className="market-overview-section">
          <div className="trending-stocks">
            <h2>Trending Stocks</h2>
            <div className="stocks-grid">
              {marketData.trendingStocks?.map((stock, index) => (
                <div key={index} className="stock-card" onClick={() => navigate(`/stock/${stock.stockName}`)}>
                  <h3>{stock.stockName}</h3>
                  <p className="stock-price">${parseFloat(stock.closePrice).toFixed(2)}</p>
                  <p className="stock-change">
                    Open: ${parseFloat(stock.openPrice).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="latest-news">
            <h2>Latest Market News</h2>
            <div className="news-grid">
              {marketData.latestNews?.slice(0, 3).map((news, index) => (
                <div key={index} className="news-card">
                  <a href={news.news_url} target="_blank" rel="noopener noreferrer">
                    <h3>{news.title}</h3>
                    <p className="news-source">{news.source}</p>
                    <p className="news-date">
                      {new Date(news.date).toLocaleDateString()}
                    </p>
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Features Section */}
      <div className="features-section">
        <h2>Why Choose InvestNexus?</h2>
        <div className="features-grid">
          <div className="feature-card">
            <h3>Real-Time Updates</h3>
            <p>Live stock price updates every 30 seconds via WebSocket connections</p>
          </div>
          <div className="feature-card">
            <h3>Portfolio Tracking</h3>
            <p>Track your holdings with real-time P&L calculations and performance metrics</p>
          </div>
          <div className="feature-card">
            <h3>Market Intelligence</h3>
            <p>Access trending stocks, market news, and industry-specific financial updates</p>
          </div>
          <div className="feature-card">
            <h3>Interactive Analysis</h3>
            <p>Dynamic price charts with multiple timeframes for comprehensive analysis</p>
          </div>
        </div>
      </div>
    </div>
  );
}
