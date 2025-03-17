import { useState, useEffect } from 'react';
import { useAuthUser } from '../security/AuthContext';
import '../style/addStockButton.css';

export default function AddStockButton({ symbol, onSuccess }) {
  const { isAuthenticated } = useAuthUser();
  const [isPurchased, setIsPurchased] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    purchasedPrice: '',
    number: '',
    purchasedDate: ''
  });

  useEffect(() => {
    const checkPurchaseStatus = async () => {
      if (!isAuthenticated) return;
      
      try {
        const response = await fetch('http://localhost:8000/purchased-stocks', {
          credentials: 'include'
        });
        
        if (response.ok) {
          const purchasedStocks = await response.json();
          const hasStock = purchasedStocks.some(
            purchase => purchase.stock.stockName === symbol
          );
          setIsPurchased(hasStock);
        }
      } catch (error) {
        console.error('Error checking purchase status:', error);
      }
    };

    checkPurchaseStatus();
  }, [symbol, isAuthenticated]);

  const handleAddClick = () => {
    if (!isAuthenticated) {
      alert('Please login first to add stocks to your portfolio');
      return;
    }

    if (isPurchased) {
      handleDelete();
    } else {
      setShowModal(true);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const response = await fetch('http://localhost:8000/purchased-stocks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          stockName: symbol,
          purchasedPrice: Number(formData.purchasedPrice),
          number: Number(formData.number),
          purchasedDate: formData.purchasedDate || new Date()
        })
      });

      if (response.ok) {
        setIsPurchased(true);
        setShowModal(false);
        onSuccess?.();
      } else {
        const error = await response.json();
        throw new Error(error.error);
      }
    } catch (error) {
      console.error('Error adding stock:', error);
      alert(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:8000/purchased-stocks', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          stockNames: [symbol]
        })
      });

      if (response.ok) {
        setIsPurchased(false);
      } else {
        const error = await response.json();
        throw new Error(error.error);
      }
    } catch (error) {
      console.error('Error removing stock:', error);
      alert(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="add-button-container">
        <button 
          className={`add-button ${isPurchased ? 'purchased' : ''} ${isLoading ? 'loading' : ''}`}
          onClick={handleAddClick}
          disabled={isLoading}
          aria-label={isPurchased ? 'Remove from portfolio' : 'Add to portfolio'}
        >
          {isLoading ? (
            <span className="loading-indicator">•••</span>
          ) : (
            <>
              <svg 
                className="cart-icon" 
                viewBox="0 0 24 24" 
                width="20" 
                height="20"
              >
                <path d="M19 7h-3V6a4 4 0 0 0-8 0v1H5a1 1 0 0 0-1 1v11a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V8a1 1 0 0 0-1-1zm-9-1a2 2 0 0 1 4 0v1h-4V6zm8 13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V9h2v1a1 1 0 0 0 2 0V9h4v1a1 1 0 0 0 2 0V9h2v10z"/>
              </svg>
              <span className="add-text">{isPurchased ? 'Added' : 'Add'}</span>
            </>
          )}
        </button>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Add Stock to Portfolio</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="purchasedPrice">Purchase Price*</label>
                <input
                  type="number"
                  id="purchasedPrice"
                  value={formData.purchasedPrice}
                  onChange={(e) => setFormData({...formData, purchasedPrice: e.target.value})}
                  required
                  step="0.01"
                  min="0"
                />
              </div>
              <div className="form-group">
                <label htmlFor="number">Number of Shares*</label>
                <input
                  type="number"
                  id="number"
                  value={formData.number}
                  onChange={(e) => setFormData({...formData, number: e.target.value})}
                  required
                  min="1"
                />
              </div>
              <div className="form-group">
                <label htmlFor="purchasedDate">Purchase Date (Optional)</label>
                <input
                  type="date"
                  id="purchasedDate"
                  value={formData.purchasedDate}
                  onChange={(e) => setFormData({...formData, purchasedDate: e.target.value})}
                />
              </div>
              <div className="modal-buttons">
                <button type="button" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" disabled={isLoading}>
                  {isLoading ? 'Adding...' : 'Add Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}