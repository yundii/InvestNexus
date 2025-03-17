const RAPID_APIKEY = '8c9cc817fdmsh6a614faa01d8977p1612edjsn3cf267975307';

export const searchStock = async (symbol) => {
    try {
        const url = `https://alpha-vantage.p.rapidapi.com/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&datatype=json`;
        const options = {
            method: 'GET',
            headers: {
                'x-rapidapi-key': RAPID_APIKEY,
                'x-rapidapi-host': 'alpha-vantage.p.rapidapi.com'
            }
        };

        const response = await fetch(url, options);
        const data = await response.json();

        if (data['Error Message']) {
            throw new Error('Stock not found');
        }

        // get time series data
        const timeSeriesDaily = data['Time Series (Daily)'];
        
        // get latest date
        const latestDate = Object.keys(timeSeriesDaily)[0];
        const latestData = timeSeriesDaily[latestDate];

        return {
            stockName: data['Meta Data']['2. Symbol'].toUpperCase(),
            openPrice: latestData['1. open'],
            closePrice: latestData['4. close']
        };
    } catch (error) {
        console.error('Error fetching stock data:', error);
        throw error;
    }
}; 


export const fetchAndStoreStockNews = async (symbol, prisma) => {
    try {
        // find stock in database
        const stock = await prisma.stock.findFirst({
            where: { stockName: symbol }
        });

        if (!stock) {
            throw new Error('Stock not found in database');
        }

        // get existing news in the last 7 days for more comprehensive duplicates check
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const existingNews = await prisma.financeNews.findMany({
            where: {
                AND: [
                    {
                        OR: [
                            { stockId: stock.id },
                            { stockId: null }
                        ]
                    },
                    {
                        date: {
                            gte: sevenDaysAgo
                        }
                    }
                ]
            },
            select: {
                title: true,
                news_url: true,
                date: true
            }
        });

        // create multiple sets for duplicates
        const existingTitles = new Set(existingNews.map(news => news.title.toLowerCase().trim()));
        const existingUrls = new Set(existingNews.map(news => news.news_url));
        const existingTitleDatePairs = new Set(
            existingNews.map(news => `${news.title.toLowerCase().trim()}-${news.date.toISOString().split('T')[0]}`)
        );

        const url = `https://real-time-finance-data.p.rapidapi.com/stock-news?symbol=${symbol}&language=en`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'x-rapidapi-key': RAPID_APIKEY,
                'x-rapidapi-host': 'real-time-finance-data.p.rapidapi.com'
            }
        });

        const data = await response.json();

        if (data.status !== "OK" || !data.data.news) {
            throw new Error('Failed to fetch news data');
        }

        const newsToStore = data.data.news
            .slice(0, 20)
            .filter(news => {
                const newsTitle = news.article_title.toLowerCase().trim();
                const newsDate = new Date(news.post_time_utc).toISOString().split('T')[0];
                const titleDatePair = `${newsTitle}-${newsDate}`;

                // multiple duplicates check
                return !existingUrls.has(news.article_url) && 
                       !existingTitles.has(newsTitle) &&
                       !existingTitleDatePairs.has(titleDatePair);
            })
            .map(news => ({
                stockId: stock.id,
                title: news.article_title,
                date: new Date(news.post_time_utc),
                topic: 'Stock News',
                source: news.source,
                news_url: news.article_url,
                banner_url: news.article_photo_url
            }));

        if (newsToStore.length === 0) {
            console.log(`No new news to store for ${symbol}`);
            return { count: 0 };
        }

        const createdNews = await prisma.financeNews.createMany({
            data: newsToStore,
            skipDuplicates: true,
        });

        return createdNews;
    } catch (error) {
        console.error('Error fetching and storing news:', error);
        throw error;
    }
};

export const fetchTopicNews = async (topics, prisma) => {
    try {
        const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=${topics}&apikey=W4LZ8TZN51QS5V7S`;
        
        const response = await fetch(url);
        const data = await response.json();

        if (!data.feed) {
            throw new Error('Failed to fetch news data');
        }

        // get existing news in the last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const existingNews = await prisma.financeNews.findMany({
            where: {
                date: {
                    gte: sevenDaysAgo
                }
            },
            select: {
                title: true,
                news_url: true,
                date: true
            }
        });

        // create multiple sets for duplicates
        const existingTitles = new Set(existingNews.map(news => news.title.toLowerCase().trim()));
        const existingUrls = new Set(existingNews.map(news => news.news_url));
        const existingTitleDatePairs = new Set(
            existingNews.map(news => `${news.title.toLowerCase().trim()}-${news.date.toISOString().split('T')[0]}`)
        );

        const newsToStore = data.feed
            .filter(news => {
                const newsTitle = news.title.toLowerCase().trim();
                const newsDate = new Date(news.time_published.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z'))
                    .toISOString().split('T')[0];
                const titleDatePair = `${newsTitle}-${newsDate}`;

                // multiple duplicates check
                return !existingUrls.has(news.url) && 
                       !existingTitles.has(newsTitle) &&
                       !existingTitleDatePairs.has(titleDatePair);
            })
            .map(news => ({
                title: news.title,
                date: new Date(news.time_published.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z')),
                topic: news.topics.map(t => t.topic).join(', '),
                source: news.source,
                news_url: news.url,
                banner_url: news.banner_image || null,
                
            }));

        if (newsToStore.length === 0) {
            return { count: 0 };
        }

        const createdNews = await prisma.financeNews.createMany({
            data: newsToStore,
            skipDuplicates: true,
        });

        return createdNews;
    } catch (error) {
        console.error('Error fetching topic news:', error);
        throw error;
    }
};