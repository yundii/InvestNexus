import { useState, useEffect } from 'react';
import { useAuthUser } from '../security/AuthContext';
import { FaFilter } from 'react-icons/fa';
import '../style/news.css';

export default function News() {
  const { user } = useAuthUser();
  const [stockNews, setStockNews] = useState([]);
  const [topicNews, setTopicNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentStockNewsIndex, setCurrentStockNewsIndex] = useState(0);
  const [currentTopicNewsIndex, setCurrentTopicNewsIndex] = useState(0);
  const [selectedTopics, setSelectedTopics] = useState([]);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [tempSelectedTopics, setTempSelectedTopics] = useState([]);

  const topics = [
    'blockchain', 'earnings', 'ipo', 'mergers_and_acquisitions',
    'financial_markets', 'economy_fiscal', 'economy_monetary',
    'economy_macro', 'energy_transportation', 'finance',
    'life_sciences', 'manufacturing', 'real_estate',
    'retail_wholesale', 'technology'
  ];

  // get stock related news
  useEffect(() => {
    const fetchStockNews = async () => {
      try {
        if (!user || !user.likeList) {
          setStockNews([]);
          setLoading(false);
          return;
        }

        const stockSymbols = user.likeList.split(',').filter(symbol => symbol !== '');
        const allNews = [];
        
        for (const symbol of stockSymbols) {
          try {
            const response = await fetch(
              `http://localhost:8000/stock-news/${symbol}`,
              { credentials: 'include' }
            );
            
            if (!response.ok) throw new Error(`Failed to fetch news for ${symbol}`);
            const data = await response.json();
            allNews.push(...data);
          } catch (err) {
            console.error(`Error fetching news for ${symbol}:`, err);
          }
        }

        setStockNews(allNews.sort((a, b) => new Date(b.date) - new Date(a.date)));
        setLoading(false);
      } catch (err) {
        console.error('Error:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    fetchStockNews();
  }, [user]);

  // get topic related news
  useEffect(() => {
    const fetchTopicNews = async () => {
      if (selectedTopics.length === 0) {
        setTopicNews([]);
        return;
      }

      try {
        setLoading(true);
        // get news first
        const response = await fetch('http://localhost:8000/topic-news', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ topics: selectedTopics })
        });

        if (!response.ok) throw new Error('Failed to fetch topic news');

        // then get stored news
        const allTopicNews = [];
        for (const topic of selectedTopics) {
          const newsResponse = await fetch(
            `http://localhost:8000/topic-news/${topic}`,
            { credentials: 'include' }
          );
          if (!newsResponse.ok) continue;
          const newsData = await newsResponse.json();
          allTopicNews.push(...newsData);
        }

        setTopicNews(allTopicNews.sort((a, b) => new Date(b.date) - new Date(a.date)));
      } catch (err) {
        console.error('Error fetching topic news:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchTopicNews();
  }, [selectedTopics]);

  const handleTopicChange = (topic) => {
    setSelectedTopics(prev => 
      prev.includes(topic)
        ? prev.filter(t => t !== topic)
        : [...prev, topic]
    );
  };

  const handleRenewStockNews = () => {
    setCurrentStockNewsIndex(prevIndex => 
      prevIndex + 4 >= stockNews.length ? 0 : prevIndex + 4
    );
  };

  const handleRenewTopicNews = () => {
    setCurrentTopicNewsIndex(prevIndex => 
      prevIndex + 8 >= topicNews.length ? 0 : prevIndex + 8
    );
  };

  const openFilterModal = () => {
    setTempSelectedTopics(selectedTopics);
    setIsFilterModalOpen(true);
  };

  const closeFilterModal = () => {
    setIsFilterModalOpen(false);
  };

  const handleConfirmTopics = () => {
    setSelectedTopics(tempSelectedTopics);
    setIsFilterModalOpen(false);
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error-message">Error: {error}</div>;

  return (
    <div>
      {/* Stock News Section */}
      <div className="news-section">
        <div className="news-header">
          <h2>You may like</h2>
          {stockNews.length > 0 && (
            <button onClick={handleRenewStockNews} className="renew-button">
              Renew News
            </button>
          )}
        </div>
        
        {stockNews.length === 0 ? (
          <div className="error-message">
            No news available. Try adding some stocks to your watchlist!
          </div>
        ) : (
          <div className="grid">
            {stockNews
              .slice(currentStockNewsIndex, currentStockNewsIndex + 4)
              .map((newsItem, index) => (
                <NewsCard key={index} newsItem={newsItem} />
              ))}
          </div>
        )}
      </div>

      {/* Topic News Section */}
      <div className="news-section section-gap">
        <div className="news-header">
          <h2>Topic News</h2>
          <button onClick={openFilterModal} className="filter-button">
            <FaFilter />
            Filter Topics
          </button>
        </div>

        {/* show selected topics */}
        {selectedTopics.length > 0 && (
          <div className="selected-topics">
            {selectedTopics.map(topic => (
              <span key={topic} className="selected-topic-tag">
                {topic.replace('_', ' ')}
              </span>
            ))}
          </div>
        )}

        {/* topic news content */}
        {selectedTopics.length === 0 ? (
          <div className="error-message">
            Please select topics to see related news.
          </div>
        ) : topicNews.length === 0 ? (
          <div className="error-message">
            No news available for selected topics.
          </div>
        ) : (
          <>
            <div className="news-controls">
              <button onClick={handleRenewTopicNews} className="renew-button">
                Renew News
              </button>
            </div>
            <div className="grid">
              {topicNews
                .slice(currentTopicNewsIndex, currentTopicNewsIndex + 8)
                .map((newsItem, index) => (
                  <NewsCard key={index} newsItem={newsItem} />
                ))}
            </div>
          </>
        )}
      </div>

      {/* Filter Modal */}
      {isFilterModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">Select Topics</h3>
            </div>
            <div className="topic-checkbox-group">
              {topics.map(topic => (
                <label key={topic} className="topic-checkbox-item">
                  <input
                    type="checkbox"
                    checked={tempSelectedTopics.includes(topic)}
                    onChange={() => {
                      setTempSelectedTopics(prev =>
                        prev.includes(topic)
                          ? prev.filter(t => t !== topic)
                          : [...prev, topic]
                      );
                    }}
                  />
                  {topic.replace('_', ' ')}
                </label>
              ))}
            </div>
            <div className="modal-footer">
              <button onClick={closeFilterModal} className="modal-button cancel-button">
                Cancel
              </button>
              <button onClick={handleConfirmTopics} className="modal-button confirm-button">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// NewsCard Component
function NewsCard({ newsItem }) {
  return (
    <div className="news-card">
      <a href={newsItem.news_url} target="_blank" rel="noopener noreferrer">
        <img 
          src={newsItem.banner_url || 'https://placehold.co/600x400?text=No+Image'}
          alt={newsItem.title}
          className="news-image"
          onError={(e) => {
            e.target.src = 'https://placehold.co/600x400?text=No+Image';
          }}
        />
        <div className="news-content">
          <h3 className="news-title">{newsItem.title}</h3>
          <p className="news-source">Source: {newsItem.source}</p>
          <p className="news-date">
            {new Date(newsItem.date).toLocaleDateString()}
          </p>
          {newsItem.sentiment_label && (
            <span className={`sentiment-label sentiment-${newsItem.sentiment_label.toLowerCase()}`}>
              {newsItem.sentiment_label}
            </span>
          )}
        </div>
      </a>
    </div>
  );
}