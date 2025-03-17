import { useState, useEffect } from 'react';
import { useAuthUser } from '../security/AuthContext';
import '../style/likeButton.css';

export default function LikeButton({ symbol }) {
  const { user, isAuthenticated, updateUser } = useAuthUser();
  const [isLiked, setIsLiked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const checkLikeStatus = () => {
      if (isAuthenticated && user && user.likeList) {
        const likeList = user.likeList.split(',').filter(item => item !== '');
        setIsLiked(likeList.includes(symbol));
      }
    };
    
    checkLikeStatus();
  }, [user, symbol, isAuthenticated]);

  const handleLikeClick = async () => {
    if (!isAuthenticated) {
      alert('Please login first to like stocks');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:8000/like-stock', {
        method: isLiked ? 'DELETE' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ symbol })
      });

      if (response.ok) {
        const updatedUser = await response.json();
        updateUser(updatedUser);
        setIsLiked(!isLiked);
      } else {
        const error = await response.json();
        throw new Error(error.error);
      }
    } catch (error) {
      console.error('Error updating like status:', error);
      alert(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="like-button-container">
      <button 
        className={`like-button ${isLiked ? 'liked' : ''} ${isLoading ? 'loading' : ''}`}
        onClick={handleLikeClick}
        disabled={isLoading}
        aria-label={isLiked ? 'Remove from favorites' : 'Add to favorites'}
      >
        {isLoading ? (
          <span className="loading-indicator">•••</span>
        ) : (
          <>
            <svg 
              className="heart-icon" 
              viewBox="0 0 24 24" 
              width="20" 
              height="20"
            >
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
            <span className="like-text">{isLiked ? 'Liked' : 'Like'}</span>
          </>
        )}
      </button>
    </div>
  );
}