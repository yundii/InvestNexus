import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../style/searchContainer.css';

export default function SearchContainer() {
  const [keyword, setKeyword] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    
    setIsLoading(true);
    const url = `https://alpha-vantage.p.rapidapi.com/query?datatype=json&keywords=${keyword}&function=SYMBOL_SEARCH`;
    const options = {
      method: 'GET',
      headers: {
        'x-rapidapi-key': 'aaacc836dbmsh2400c2f42378314p1b1bfajsn46996f682663',
        'x-rapidapi-host': 'alpha-vantage.p.rapidapi.com'
      }
    };

    try {
      const response = await fetch(url, options);
      const data = await response.json();
      
      // 只保留 USD 货币的结果
      const usdResults = data.bestMatches.filter(match => match['8. currency'] === 'USD');
      setSuggestions(usdResults);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSymbolClick = (symbol) => {
    navigate(`/stock/${symbol}`);
    setKeyword('');
    setSuggestions([]);
  };

  return (
    <div className="search-container">
      <div className="search-input-container">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Search stock symbol..."
          className="search-input"
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              handleSearch();
            }
          }}
        />
        <button 
          onClick={handleSearch}
          className="search-button"
          disabled={isLoading}
        >
          {isLoading ? (
            <span className="loading-dots">...</span>
          ) : (
            <svg viewBox="0 0 24 24" className="search-icon">
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
          )}
        </button>
      </div>
      
      {suggestions.length > 0 && (
        <div className="suggestions-dropdown">
          {suggestions.map((match, index) => (
            <div 
              key={index}
              className="suggestion-item"
              onClick={() => handleSymbolClick(match['1. symbol'])}
            >
              <span className="symbol">{match['1. symbol']}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}