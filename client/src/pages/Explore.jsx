import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import '../style/explore.css';
import SearchContainer from '../components/SearchContainer';

export default function Explore() {
  const [searchParams] = useSearchParams();
  const type = searchParams.get('type') || 'MOST_ACTIVE';
  const [trends, setTrends] = useState([]);
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchTrends = async () => {
      setLoading(true);
      const url = `https://real-time-finance-data.p.rapidapi.com/market-trends?trend_type=${type}&country=us&language=en`;
      const options = {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': '8c9cc817fdmsh6a614faa01d8977p1612edjsn3cf267975307',
          'X-RapidAPI-Host': 'real-time-finance-data.p.rapidapi.com'
        }
      };

      try {
        const response = await fetch(url, options);
        const data = await response.json();
        if (data && data.data) {
          setTrends(data.data.trends || []);
          setNews(data.data.news || []);
        } else {
          setError('Invalid data format received');
        }
      } catch (err) {
        console.error('API Error:', err);
        setError('Failed to fetch market trends');
      } finally {
        setLoading(false);
      }
    };

    fetchTrends();
  }, [type]);

  const getTrendTitle = () => {
    switch(type) {
      case 'GAINERS':
        return 'Day Gainers';
      case 'LOSERS':
        return 'Day Losers';
      case 'MOST_ACTIVE':
        return 'Most Actives';
      default:
        return 'Market Trends';
    }
  };

  const handleSymbolClick = (symbol) => {
    navigate(`/stock/${symbol}`);
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>{error}</div>;

  return (
    <div>

      {/* Stock Section */}
      <div className="stock-section">
        <div className="section-header">
          <h2 className="text-2xl font-bold text-gray-800">
            {getTrendTitle()}
          </h2>
          <SearchContainer />
        </div>

        <div className="market-table-container">
          <table className="market-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Name</th>
                <th>Price</th>
                <th>Change</th>
                <th>%Change</th>
                <th>Previous Close</th>
                <th>Currency</th>
                <th>Exchange</th>
              </tr>
            </thead>
            <tbody>
              {trends.map((trend, index) => (
                <tr key={index}>
                  <td 
                    className="symbol-cell"
                    onClick={() => handleSymbolClick(trend.symbol)}
                    style={{ cursor: 'pointer', color: '#0066cc' }}
                  >
                    {trend.symbol}
                  </td>
                  <td>{trend.name}</td>
                  <td>{trend.price}</td>
                  <td className={trend.change > 0 ? 'positive' : 'negative'}>
                    {trend.change}
                  </td>
                  <td className={trend.change_percent > 0 ? 'positive' : 'negative'}>
                    {trend.change_percent}%
                  </td>
                  <td>{trend.previous_close}</td>
                  <td>{trend.currency}</td>
                  <td>{trend.exchange}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* News Section */}
      <div className="news-section">
        <h2 className="text-2xl font-bold text-gray-800 mb-8">Latest Market News</h2>
        <div className="grid grid-cols-10 gap-4">
          {news.map((newsItem, index) => (
            <div key={index} className="bg-white rounded-lg shadow-lg overflow-hidden">
              <a href={newsItem.article_url} target="_blank" rel="noopener noreferrer">
                <img 
                  src={newsItem.article_photo_url} 
                  alt={newsItem.article_title}
                  className="w-full h-48 object-cover"
                />
                <div className="p-4">
                  <h3 className="text-lg font-medium text-gray-900 hover:text-blue-600 line-clamp-2">
                    {newsItem.article_title}
                  </h3>
                  <p className="mt-2 text-sm text-gray-600">
                    Source: {newsItem.source}
                  </p>
                </div>
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
