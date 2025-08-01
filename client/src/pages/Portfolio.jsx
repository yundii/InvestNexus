import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthUser } from '../security/AuthContext';
import '../style/portfolio.css';
import PortfolioSearchContainer from '../components/PortfolioSearchContainer';
import { FaTrash } from 'react-icons/fa';

export default function Portfolio() {
  const [portfolioData, setPortfolioData] = useState({ portfolio: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stockNews, setStockNews] = useState([]);
  const [currentNewsIndex, setCurrentNewsIndex] = useState(0);
  const [selectedStocks, setSelectedStocks] = useState([]);
  const navigate = useNavigate();
  const { socket } = useAuthUser();

  const fetchPortfolio = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/portfolio', {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch portfolio data');
      }
      
      const data = await response.json();
      setPortfolioData(data);
    } catch (err) {
      console.error('Error fetching portfolio:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Listen for real-time stock price updates
  useEffect(() => {
    if (socket) {
      socket.on('stock-price-update', (data) => {
        setPortfolioData(prevData => {
          const updatedPortfolio = prevData.portfolio.map(item => {
            if (item.stock.stockName === data.symbol) {
              const currentPrice = parseFloat(data.price);
              const cost = parseFloat(item.purchasedPrice);
              const shares = item.number;
              
              const currentValue = currentPrice * shares;
              const totalCostForStock = cost * shares;
              const profitLoss = currentValue - totalCostForStock;
              const profitLossPercent = ((profitLoss / totalCostForStock) * 100);
              
              return {
                ...item,
                latestPrice: currentPrice,
                currentValue,
                totalCost: totalCostForStock,
                profitLoss,
                profitLossPercent
              };
            }
            return item;
          });
          
          // Recalculate summary
          const totalValue = updatedPortfolio.reduce((sum, item) => sum + item.currentValue, 0);
          const totalCost = updatedPortfolio.reduce((sum, item) => sum + item.totalCost, 0);
          const totalProfitLoss = totalValue - totalCost;
          const totalProfitLossPercent = totalCost > 0 ? ((totalProfitLoss / totalCost) * 100) : 0;
          
          return {
            portfolio: updatedPortfolio,
            summary: {
              totalValue,
              totalCost,
              totalProfitLoss,
              totalProfitLossPercent
            }
          };
        });
      });
    }

    return () => {
      if (socket) {
        socket.off('stock-price-update');
      }
    };
  }, [socket]);

  const fetchStockNews = useCallback(async () => {
    try {
      const stockSymbols = portfolioData.portfolio.map(ps => ps.stock.stockName);
      const allNews = [];

      for (const symbol of stockSymbols) {
        try {
          const response = await fetch(`http://localhost:8000/stock-news/${symbol}`, {
            credentials: 'include'
          });

          if (!response.ok) {
            throw new Error(`Failed to fetch news for ${symbol}`);
          }

          const newsData = await response.json();
          allNews.push(...newsData);
        } catch (err) {
          console.error(`Error fetching news for ${symbol}:`, err);
        }
      }

      const sortedNews = allNews.sort((a, b) => 
        new Date(b.date) - new Date(a.date)
      );

      setStockNews(sortedNews);
    } catch (err) {
      console.error('Error fetching stock news:', err);
    }
  }, [portfolioData.portfolio]);

  useEffect(() => {
    const init = async () => {
      await fetchPortfolio();
    };
    init();
  }, []);

  useEffect(() => {
    const fetchNews = async () => {
      if (portfolioData.portfolio.length > 0) {
        await fetchStockNews();
      }
    };
    fetchNews();
  }, [portfolioData.portfolio, fetchStockNews]);

  const handleSymbolClick = (symbol) => {
    navigate(`/stock/${symbol}`);
  };

  const calculateGains = (purchasedPrice, latestPrice, number) => {
    purchasedPrice = parseFloat(purchasedPrice);
    latestPrice = parseFloat(latestPrice);
    number = parseInt(number);
    
    const totalCost = purchasedPrice * number;
    const currentValue = latestPrice * number;
    const totalGain = currentValue - totalCost;
    const totalGainPercent = ((latestPrice - purchasedPrice) / purchasedPrice) * 100;
    
    return {
      totalGain,
      totalGainPercent
    };
  };

  const handleDelete = async (ids) => {
    try {
      const response = await fetch('http://localhost:8000/purchased-stocks', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [ids] })
      });

      if (!response.ok) {
        throw new Error('Failed to delete stocks');
      }

      fetchPortfolio();
      setSelectedStocks([]);
    } catch (err) {
      console.error('Error deleting stocks:', err);
      setError(err.message);
    }
  };

  const handleSelect = (id) => {
    setSelectedStocks(prev => 
      prev.includes(id) 
        ? prev.filter(stockId => stockId !== id)
        : [...prev, id]
    );
  };

  const handleRenewNews = () => {
    setCurrentNewsIndex(prevIndex => {
      if (prevIndex + 8 >= stockNews.length) {
        return 0;
      }
      return prevIndex + 8;
    });
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <div className="portfolio-section">
        <div className="section-header">
          <h2 className="text-2xl font-bold text-gray-800">
            My Portfolio
          </h2>
          <PortfolioSearchContainer onStockAdded={fetchPortfolio} />
        </div>

        {selectedStocks.length > 0 && (
          <button
            onClick={() => handleDelete(selectedStocks)}
            className="delete-selected-btn"
          >
            Delete Selected ({selectedStocks.length})
          </button>
        )}

        {/* Portfolio Summary */}
        {portfolioData.summary && Object.keys(portfolioData.summary).length > 0 && (
          <div className="portfolio-summary">
            <div className="summary-card">
              <h3>Total Value</h3>
              <p className="summary-value">${portfolioData.summary.totalValue?.toFixed(2) || '0.00'}</p>
            </div>
            <div className="summary-card">
              <h3>Total Cost</h3>
              <p className="summary-value">${portfolioData.summary.totalCost?.toFixed(2) || '0.00'}</p>
            </div>
            <div className="summary-card">
              <h3>Total P&L</h3>
              <p className={`summary-value ${portfolioData.summary.totalProfitLoss >= 0 ? 'positive' : 'negative'}`}>
                ${portfolioData.summary.totalProfitLoss?.toFixed(2) || '0.00'}
              </p>
            </div>
            <div className="summary-card">
              <h3>Total P&L %</h3>
              <p className={`summary-value ${portfolioData.summary.totalProfitLossPercent >= 0 ? 'positive' : 'negative'}`}>
                {portfolioData.summary.totalProfitLossPercent?.toFixed(2) || '0.00'}%
              </p>
            </div>
          </div>
        )}

        <div className="market-table-container">
          <table className="market-table">
            <thead>
              <tr>
                <th>Select</th>
                <th>Stock Name</th>
                <th>Purchase Date</th>
                <th>Purchase Price ($)</th>
                <th>Latest Price ($)</th>
                <th>Number of Shares</th>
                <th>Total Gain (%)</th>
                <th>Total Gain ($)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {portfolioData.portfolio.map((record) => {
                return (
                  <tr key={record.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedStocks.includes(record.id)}
                        onChange={() => handleSelect(record.id)}
                      />
                    </td>
                    <td 
                      className="symbol-cell"
                      onClick={() => handleSymbolClick(record.stock.stockName)}
                    >
                      {record.stock.stockName}
                    </td>
                    <td>
                      {new Date(record.purchasedDate).toLocaleDateString()}
                    </td>
                    <td>
                      {parseFloat(record.purchasedPrice).toFixed(2)}
                    </td>
                    <td>
                      {parseFloat(record.latestPrice).toFixed(2)}
                    </td>
                    <td>{record.number}</td>
                    <td className={record.profitLossPercent >= 0 ? 'positive' : 'negative'}>
                      {record.profitLossPercent.toFixed(2)}%
                    </td>
                    <td className={record.profitLoss >= 0 ? 'positive' : 'negative'}>
                      ${Math.abs(record.profitLoss).toFixed(2)}
                    </td>
                    <td>
                      <button
                        onClick={() => handleDelete(record.id)}
                        className="delete-btn"
                      >
                        <FaTrash />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="news-section">
        <div className="news-header">
          <h2 className="text-2xl font-bold text-gray-800 mb-8">Portfolio News</h2>
          {stockNews.length > 0 && (
            <button 
              onClick={handleRenewNews}
              className="renew-button"
            >
              Renew News
            </button>
          )}
        </div>
        {stockNews.length === 0 ? (
          <div className="text-center py-4">
            Loading news... Please wait as we fetch data for your stocks.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-8">
            {stockNews
              .slice(currentNewsIndex, currentNewsIndex + 8)
              .map((newsItem, index) => (
                <div key={index} className="bg-white rounded-lg shadow-lg overflow-hidden">
                  <a href={newsItem.news_url} target="_blank" rel="noopener noreferrer">
                    <img 
                      src={newsItem.banner_url || 'https://placehold.co/600x400?text=No+Image'}
                      alt={newsItem.title}
                      className="w-full h-48 object-cover"
                      onError={(e) => {
                        e.target.src = 'https://placehold.co/600x400?text=No+Image';
                      }}
                    />
                    <div className="p-4">
                      <h3 className="text-lg font-medium text-gray-900 hover:text-blue-600 line-clamp-2">
                        {newsItem.title}
                      </h3>
                      <p className="mt-2 text-sm text-gray-600">
                        Source: {newsItem.source}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {new Date(newsItem.date).toLocaleDateString()}
                      </p>
                    </div>
                  </a>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
