import { useState, useEffect } from 'react';
import { Select, Card, Statistic } from 'antd';
import { useAuthUser } from '../security/AuthContext';
import AnalyticsChartComponent from '../components/AnalyticsChartComponent';

export default function Analytics() {
  const [portfolioData, setPortfolioData] = useState({ portfolio: [], summary: {} });
  const [selectedStock, setSelectedStock] = useState(null);
  const [analytics, setAnalytics] = useState({
    totalShares: 0,
    bookValue: 0,
    currentValue: 0,
    totalGain: 0,
    totalGainPercent: 0,
    bestPerformer: null,
    worstPerformer: null,
  });
  const { socket } = useAuthUser();

  useEffect(() => {
    const fetchPortfolio = async () => {
      try {
        const response = await fetch('http://localhost:8000/portfolio', {
          credentials: 'include'
        });
        
        if (!response.ok) {
          throw new Error('Failed to fetch portfolio data');
        }
        
        const data = await response.json();
        setPortfolioData(data);
        calculateAnalytics(data);
      } catch (error) {
        console.error('Error fetching portfolio:', error);
      }
    };
    fetchPortfolio();
  }, []);

  // Listen for real-time portfolio updates
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
          
          const newData = {
            portfolio: updatedPortfolio,
            summary: {
              totalValue,
              totalCost,
              totalProfitLoss,
              totalProfitLossPercent
            }
          };
          
          calculateAnalytics(newData);
          return newData;
        });
      });
    }

    return () => {
      if (socket) {
        socket.off('stock-price-update');
      }
    };
  }, [socket]);

  const calculateAnalytics = (data) => {
    const portfolio = data.portfolio || [];
    const summary = data.summary || {};
    
    const totalShares = portfolio.reduce((sum, stock) => sum + stock.number, 0);
    const bookValue = summary.totalCost || 0;
    const currentValue = summary.totalValue || 0;
    const totalGain = summary.totalProfitLoss || 0;
    const totalGainPercent = summary.totalProfitLossPercent || 0;

    // Find best and worst performers
    let bestPerformer = null;
    let worstPerformer = null;
    
    if (portfolio.length > 0) {
      bestPerformer = portfolio.reduce((best, current) => 
        current.profitLossPercent > best.profitLossPercent ? current : best
      );
      worstPerformer = portfolio.reduce((worst, current) => 
        current.profitLossPercent < worst.profitLossPercent ? current : worst
      );
    }

    setAnalytics({
      totalShares,
      bookValue,
      currentValue,
      totalGain,
      totalGainPercent,
      bestPerformer,
      worstPerformer,
    });
  };

  const calculateDayGain = (stockId) => {
    const stock = portfolioData.portfolio.find((s) => s.id === stockId);
    if (!stock) return 0;
    return stock.profitLoss || 0;
  };

  return (
    <div className="p-6 w-full min-h-screen space-y-6">
      {/* Portfolio Performance Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="w-full">
          <Statistic 
            title="Total Shares" 
            value={analytics.totalShares} 
          />
        </Card>
        <Card className="w-full">
          <Statistic
            title="Book Value"
            value={analytics.bookValue}
            precision={2}
            prefix="$"
          />
        </Card>
        <Card className="w-full">
          <Statistic
            title="Current Value"
            value={analytics.currentValue}
            precision={2}
            prefix="$"
          />
        </Card>
        <Card className="w-full">
          <Statistic
            title="Total P&L"
            value={analytics.totalGain}
            precision={2}
            prefix="$"
            suffix={`(${analytics.totalGainPercent.toFixed(2)}%)`}
            valueStyle={{
              color: analytics.totalGain >= 0 ? '#3f8600' : '#cf1322',
            }}
          />
        </Card>
      </div>

      {/* Performance Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="w-full">
          <Statistic
            title="Best Performer"
            value={analytics.bestPerformer ? analytics.bestPerformer.stock.stockName : 'N/A'}
            suffix={analytics.bestPerformer ? `+${analytics.bestPerformer.profitLossPercent.toFixed(2)}%` : ''}
            valueStyle={{
              color: '#3f8600',
            }}
          />
        </Card>
        <Card className="w-full">
          <Statistic
            title="Worst Performer"
            value={analytics.worstPerformer ? analytics.worstPerformer.stock.stockName : 'N/A'}
            suffix={analytics.worstPerformer ? `${analytics.worstPerformer.profitLossPercent.toFixed(2)}%` : ''}
            valueStyle={{
              color: '#cf1322',
            }}
          />
        </Card>
      </div>

      {/* Individual Stock Analysis */}
      <Card className="w-full">
        <Statistic
          title="Individual Stock Analysis"
          value={selectedStock ? calculateDayGain(selectedStock) : 0}
          precision={2}
          prefix="$"
          valueStyle={{
            color: calculateDayGain(selectedStock) >= 0 ? '#3f8600' : '#cf1322',
          }}
        />
        <Select
          className="mt-2"
          placeholder="Select a stock for detailed analysis"
          onChange={setSelectedStock}
          style={{ width: '100%' }}
        >
          {portfolioData.portfolio.map((stock) => (
            <Select.Option key={stock.id} value={stock.id}>
              {stock.stock.stockName} - ${parseFloat(stock.latestPrice).toFixed(2)}
            </Select.Option>
          ))}
        </Select>
      </Card>

      {/* Chart area - vertical arrangement */}
      <div className="space-y-6 flex flex-col items-center">
        {/* doughnut chart */}
        <div className="bg-white rounded-lg shadow p-6 w-2/3 h-[250px]">
          <AnalyticsChartComponent 
            purchasedStocks={portfolioData.portfolio} 
            chartType="doughnut" 
          />
        </div>
        {/* bar chart */}
        <div className="bg-white rounded-lg shadow p-6 w-2/3 h-[250px]">
          <AnalyticsChartComponent 
            purchasedStocks={portfolioData.portfolio} 
            chartType="bar" 
          />
        </div>
        {/* line chart */}
        <div className="bg-white rounded-lg shadow p-6 w-2/3 h-[250px]">
          <AnalyticsChartComponent 
            purchasedStocks={portfolioData.portfolio} 
            chartType="line" 
          />
        </div>
      </div>
    </div>
  );
}
