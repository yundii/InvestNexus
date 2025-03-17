import { useParams } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import '../style/stockDetails.css';
import LikeButton from '../components/LikeButton';
import AddStockButton from '../components/AddStockButton';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

export default function StockDetails() {
  const { symbol } = useParams();
  const [chartData, setChartData] = useState(null);
  const [latestPrice, setLatestPrice] = useState(null);
  const [latestDateTime, setLatestDateTime] = useState(null);
  const [period, setPeriod] = useState('1D');

  const getStockName = (fullSymbol) => {
    return fullSymbol.split(':')[0];
  };

  const periods = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y'];

  const formatLabel = (timestamp, selectedPeriod) => {
    const time = new Date(timestamp);
    if (selectedPeriod === '1D') {
      return time.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      });
    } else if (selectedPeriod === '5D' || selectedPeriod === '1M') {
      return time.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } else {
      return time.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
  };

  const fetchData = useCallback(async (selectedPeriod) => {
    try {
      const response = await fetch(
        `https://seeking-alpha.p.rapidapi.com/symbols/get-chart?symbol=${getStockName(symbol)}&period=${selectedPeriod}`,
        {
          headers: {
            'x-rapidapi-key': '8c9cc817fdmsh6a614faa01d8977p1612edjsn3cf267975307',

          }
        }
      );
      
      const data = await response.json();
      const timeSeriesData = data.attributes;
      const timestamps = Object.keys(timeSeriesData).sort();
      const prices = timestamps.map(time => timeSeriesData[time].close);
      
      const lastTimestamp = timestamps[timestamps.length - 1];
      setLatestPrice(timeSeriesData[lastTimestamp].close.toFixed(2));
      setLatestDateTime(lastTimestamp);

      const labels = timestamps.map(timestamp => formatLabel(timestamp, selectedPeriod));

      setChartData({
        labels: labels,
        datasets: [{
          label: 'Stock Price',
          data: prices,
          borderColor: 'rgb(75, 192, 192)',
          tension: 0.1,
          pointRadius: 0
        }]
      });
    } catch (error) {
      console.error('Error fetching stock data:', error);
    }
  }, [symbol]);

  useEffect(() => {
    fetchData(period);
  }, [period, fetchData]);

  const options = {
    responsive: true,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        mode: 'index',
        intersect: false
      }
    },
    scales: {
      x: {
        title: {
          display: true,
          text: 'Time'
        }
      },
      y: {
        title: {
          display: true,
          text: 'Price ($)'
        }
      }
    }
  };

  return (
    <div className="stock-details-container">
      <h1 className="stock-details-header">
        {getStockName(symbol)} Stock
      </h1>
      <div className="action-buttons">
        <LikeButton symbol={getStockName(symbol)} />
        <AddStockButton symbol={getStockName(symbol)} />
      </div>
      {latestPrice && latestDateTime && (
        <div className="latest-price-info">
          <p>Latest Price: ${latestPrice}</p>
          <p>As of: {new Date(latestDateTime).toLocaleString()}</p>
        </div>
      )}
      <div className="period-selector">
        {periods.map(p => (
          <button 
            key={p}
            className={`period-button ${period === p ? 'active' : ''}`}
            onClick={() => setPeriod(p)}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="chart-container">
        {chartData && <Line options={options} data={chartData} />}
      </div>
    </div>
  );
}
