import { useRef, useEffect } from 'react';
import { Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend } from 'chart.js';
import '../style/AnalyticsChartComponent.css';

ChartJS.register(
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
);

export default function AnalyticsChartComponent({ purchasedStocks, chartType }) {
  const chartRef = useRef(null);

  useEffect(() => {
    if (!purchasedStocks.length || !chartRef.current) return;

    let chart;
    
    if (chartType === 'doughnut') {
      chart = new ChartJS(chartRef.current, {
        type: 'doughnut',
        data: {
          labels: purchasedStocks.map(stock => stock.stock.stockName),
          datasets: [{
            data: purchasedStocks.map(stock => stock.number),
            backgroundColor: [
              '#FF6384',
              '#36A2EB',
              '#FFCE56',
              '#4BC0C0',
              '#9966FF',
            ],
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          aspectRatio: 2,
          plugins: {
            title: {
              display: true,
              text: 'Portfolio Distribution',
              font: {
                size: 14
              }
            },
            legend: {
              position: 'top',
              labels: {
                font: {
                  size: 12
                }
              }
            }
          }
        }
      });
    } else if (chartType === 'bar') {
      const mockDayGainData = purchasedStocks.map(stock => 
        (parseFloat(stock.latestPrice) - parseFloat(stock.purchasedPrice)) * stock.number
      );

      chart = new ChartJS(chartRef.current, {
        type: 'bar',
        data: {
          labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'],
          datasets: [{
            label: 'Day Gain',
            data: mockDayGainData,
            backgroundColor: 'rgba(54, 162, 235, 0.5)',
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          aspectRatio: 2,
          plugins: {
            title: {
              display: true,
              text: 'Day Gain (Last 5 Days)',
              font: {
                size: 14
              }
            },
            legend: {
              labels: {
                font: {
                  size: 12
                }
              }
            }
          },
          scales: {
            x: {
              grid: {
                display: false
              }
            },
            y: {
              grid: {
                display: false
              },
              border: {
                display: true
              }
            }
          }
        }
      });
    } else if (chartType === 'line') {
      const mockDayGainData = purchasedStocks.map(stock => 
        (parseFloat(stock.latestPrice) - parseFloat(stock.purchasedPrice)) * stock.number
      );

      chart = new ChartJS(chartRef.current, {
        type: 'line',
        data: {
          labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'],
          datasets: [{
            label: 'Total Gain',
            data: mockDayGainData,
            borderColor: 'rgb(75, 192, 192)',
            tension: 0.1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          aspectRatio: 2,
          plugins: {
            title: {
              display: true,
              text: 'Total Gain Over Time',
              font: {
                size: 14
              }
            },
            legend: {
              labels: {
                font: {
                  size: 12
                }
              }
            }
          },
          scales: {
            x: {
              grid: {
                display: false
              }
            },
            y: {
              grid: {
                display: false
              },
              border: {
                display: true
              }
            }
          }
        }
      });
    }

    return () => {
      if (chart) {
        chart.destroy();
      }
    };
  }, [purchasedStocks, chartType]);

  return (
    <div className="w-full h-full">
      <canvas ref={chartRef}></canvas>
    </div>
  );
}