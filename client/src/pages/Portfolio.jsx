import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import '../style/portfolio.css';
import PortfolioSearchContainer from '../components/PortfolioSearchContainer';
import { FaTrash } from 'react-icons/fa';

export default function Portfolio() {
  const [purchasedStocks, setPurchasedStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stockNews, setStockNews] = useState([]);
  const [currentNewsIndex, setCurrentNewsIndex] = useState(0);
  const [selectedStocks, setSelectedStocks] = useState([]);
  const navigate = useNavigate();

  const fetchPurchasedStocks = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/purchased-stocks', {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch portfolio data');
      }
      
      const data = await response.json();
      setPurchasedStocks(data);
    } catch (err) {
      console.error('Error fetching portfolio:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchStockNews = useCallback(async () => {
    try {
      const stockSymbols = purchasedStocks.map(ps => ps.stock.stockName);
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
  }, [purchasedStocks]);

  useEffect(() => {
    const init = async () => {
      await fetchPurchasedStocks();
    };
    init();
  }, []);

  useEffect(() => {
    const fetchNews = async () => {
      if (purchasedStocks.length > 0) {
        await fetchStockNews();
      }
    };
    fetchNews();
  }, [purchasedStocks, fetchStockNews]);

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

      fetchPurchasedStocks();
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
          <PortfolioSearchContainer onStockAdded={fetchPurchasedStocks} />
        </div>

        {selectedStocks.length > 0 && (
          <button
            onClick={() => handleDelete(selectedStocks)}
            className="delete-selected-btn"
          >
            Delete Selected ({selectedStocks.length})
          </button>
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
              {purchasedStocks.map((record) => {
                const { totalGain, totalGainPercent } = calculateGains(
                  record.purchasedPrice,
                  record.latestPrice,
                  record.number
                );

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
                    <td className={totalGainPercent >= 0 ? 'positive' : 'negative'}>
                      {totalGainPercent.toFixed(2)}%
                    </td>
                    <td className={totalGain >= 0 ? 'positive' : 'negative'}>
                      ${Math.abs(totalGain).toFixed(2)}
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
