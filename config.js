import dotenv from 'dotenv';
dotenv.config();

export const config = {
  binance: {
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    testnet: process.env.TESTNET === 'true'
  },
  trading: {
    symbol: 'BTCUSDT',
    timeframe: '1h',
    initialCapital: 1000,
    maxPositions: 3,
    stopLoss: 0.02,
    takeProfit: 0.03
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  },
  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/trading'
  }
};