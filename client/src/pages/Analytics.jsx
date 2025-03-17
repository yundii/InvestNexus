import { useState, useEffect } from 'react';
import { Select, Card, Statistic } from 'antd';
import AnalyticsChartComponent from '../components/AnalyticsChartComponent';

export default function Analytics() {
  const [purchasedStocks, setPurchasedStocks] = useState([]);
  const [selectedStock, setSelectedStock] = useState(null);
  const [analytics, setAnalytics] = useState({
    totalShares: 0,
    bookValue: 0,
    dayGain: 0,
    totalGain: 0,
  });

  useEffect(() => {
    const fetchPurchasedStocks = async () => {
      try {
        const response = await fetch('http://localhost:8000/purchased-stocks', {
          credentials: 'include'
        });
        
        if (!response.ok) {
          throw new Error('Failed to fetch portfolio data');
        }
        
        const data = await response.json();
        setPurchasedStocks(data);
        calculateAnalytics(data);
      } catch (error) {
        console.error('Error fetching purchased stocks:', error);
      }
    };
    fetchPurchasedStocks();
  }, []);

  const calculateAnalytics = (stocks) => {
    const totalShares = stocks.reduce((sum, stock) => sum + stock.number, 0);
    const bookValue = stocks.reduce(
      (sum, stock) => sum + stock.number * parseFloat(stock.purchasedPrice),
      0
    );
    const currentValue = stocks.reduce(
      (sum, stock) => sum + stock.number * parseFloat(stock.latestPrice),
      0
    );
    const totalGain = currentValue - bookValue;

    setAnalytics({
      totalShares,
      bookValue,
      totalGain,
    });
  };

  const calculateDayGain = (stockId) => {
    const stock = purchasedStocks.find((s) => s.id === stockId);
    if (!stock) return 0;
    return (
      stock.number * (parseFloat(stock.latestPrice) - parseFloat(stock.purchasedPrice))
    );
  };

  return (
    <div className="p-6 w-full min-h-screen space-y-6">
      {/* top statistics */}
      <div className="grid grid-cols-4 gap-4">
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
            title="Day Gain"
            value={selectedStock ? calculateDayGain(selectedStock) : 0}
            precision={2}
            prefix="$"
            valueStyle={{
              color: calculateDayGain(selectedStock) >= 0 ? '#3f8600' : '#cf1322',
            }}
          />
          <Select
            className="mt-2"
            placeholder="Select a stock"
            onChange={setSelectedStock}
            style={{ width: '100%' }}
          >
            {purchasedStocks.map((stock) => (
              <Select.Option key={stock.id} value={stock.id}>
                {stock.stock.stockName}
              </Select.Option>
            ))}
          </Select>
        </Card>
        <Card className="w-full">
          <Statistic
            title="Total Gain"
            value={analytics.totalGain}
            precision={2}
            prefix="$"
            valueStyle={{
              color: analytics.totalGain >= 0 ? '#3f8600' : '#cf1322',
            }}
          />
        </Card>
      </div>

      {/* chart area - vertical arrangement */}
      <div className="space-y-6 flex flex-col items-center">
        {/* doughnut chart */}
        <div className="bg-white rounded-lg shadow p-6 w-2/3 h-[250px]">
          <AnalyticsChartComponent 
            purchasedStocks={purchasedStocks} 
            chartType="doughnut" 
          />
        </div>
        {/* bar chart */}
        <div className="bg-white rounded-lg shadow p-6 w-2/3 h-[250px]">
          <AnalyticsChartComponent 
            purchasedStocks={purchasedStocks} 
            chartType="bar" 
          />
        </div>
        {/* line chart */}
        <div className="bg-white rounded-lg shadow p-6 w-2/3 h-[250px]">
          <AnalyticsChartComponent 
            purchasedStocks={purchasedStocks} 
            chartType="line" 
          />
        </div>
      </div>
    </div>
  );
}
