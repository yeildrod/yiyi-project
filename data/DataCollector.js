import { createRequire} from 'module';
const require = createRequire(import.meta.url)
const Binance = require('binance-api-node').default;
import { createClient } from 'redis';
import { config } from '../config.js';
import TechnicalIndicators from 'technicalindicators';
const { HttpsProxyAgent } = require('https-proxy-agent');

// console.log(process.env);

export class DataCollector {
  constructor() {
    this.client = Binance({
      apiKey: config.binance.apiKey,
      apiSecret: config.binance.apiSecret,
      testnet: config.binance.testnet,
      httpAgent: new HttpsProxyAgent('http://127.0.0.1:7890'),
      httpBase: 'https://data-api.binance.vision' 
    });
    this.redis = createClient(config.redis);
    this.redis.connect();
  }

  async fetchHistoricalData(symbol, interval, limit = 500) {
    const candles = await this.client.candles({
      symbol,
      interval,
      limit
    });
    console.log(`API 返回了 ${candles.length} 条 K 线数据`); 
    const formattedData = candles.map(candle => ({
      timestamp: new Date(candle.openTime),
      open: parseFloat(candle.open),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      close: parseFloat(candle.close),
      volume: parseFloat(candle.volume)
    }));
    
    return this.addIndicators(formattedData);
  }

  addIndicators(data) {
    const closes = data.map(d => d.close);
    const volumes = data.map(d => d.volume);
    const highs = data.map(d => d.high);
    const lows = data.map(d => d.low);
    
    // RSI
    const rsi = TechnicalIndicators.RSI.calculate({
      values: closes,
      period: 14
    });
    
    // MACD
    const macd = TechnicalIndicators.MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
    
    // Bollinger Bands
    const bb = TechnicalIndicators.BollingerBands.calculate({
      values: closes,
      period: 20,
      stdDev: 2
    });
    
    // Volume Weighted Average Price
    const vwap = TechnicalIndicators.VWAP.calculate({
      close: closes,
      high: highs,
      low: lows,
      volume: volumes
    });
    
    // 添加指标到数据
    for (let i = 0; i < data.length; i++) {
      if (i >= 26) { // MACD需要至少26个数据点
        const macdIndex = i - 26;
        if (macd[macdIndex]) {
          data[i].macd = macd[macdIndex].MACD;
          data[i].signal = macd[macdIndex].signal;
          data[i].histogram = macd[macdIndex].histogram;
        }
      }
      
      if (i >= 14) { // RSI需要至少14个数据点
        const rsiIndex = i - 14;
        data[i].rsi = rsi[rsiIndex];
      }
      
      if (i >= 20) { // Bollinger Bands需要至少20个数据点
        const bbIndex = i - 20;
        if (bb[bbIndex]) {
          data[i].bb_upper = bb[bbIndex].upper;
          data[i].bb_middle = bb[bbIndex].middle;
          data[i].bb_lower = bb[bbIndex].lower;
        }
      }
      
      if (vwap[i]) {
        data[i].vwap = vwap[i];
      }
    }
    
    return data;
  }

  async startRealTimeData(symbol, interval, callback) {
    this.client.ws.candles(symbol, interval, candle => {
      const data = {
        timestamp: new Date(candle.startTime),
        open: parseFloat(candle.open),
        high: parseFloat(candle.high),
        low: parseFloat(candle.low),
        close: parseFloat(candle.close),
        volume: parseFloat(candle.volume),
        isFinal: candle.isFinal
      };
      
      // 存储到Redis
      this.redis.lPush(`market:${symbol}:${interval}`, JSON.stringify(data));
      this.redis.lTrim(`market:${symbol}:${interval}`, 0, 999);
      
      callback(data);
    });
  }
}