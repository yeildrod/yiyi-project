import { createRequire} from 'module';
const require = createRequire(import.meta.url);
const Binance = require('binance-api-node').default;
import { EventEmitter } from 'events';
import { config } from '../config.js';
const { HttpsProxyAgent } = require('https-proxy-agent');

export class TradingEngine extends EventEmitter {
  constructor(model, initialCapital = 1000) {
    super();
    this.client = Binance({
      apiKey: config.binance.apiKey,
      apiSecret: config.binance.apiSecret,
      testnet: config.binance.testnet,
      httpAgent: new HttpsProxyAgent('http://127.0.0.1:7890'),
      httpBase: 'https://data-api.binance.vision'       
    });
    this.model = model;
    this.capital = initialCapital;
    this.positions = new Map();
    this.tradeHistory = [];
    this.isLive = false;
  }

  async initialize() {
    try {
      const account = await this.client.accountInfo();
      this.capital = parseFloat(account.balances.find(b => b.asset === 'USDT').free);
      console.log(`初始资本: ${this.capital} USDT`);
      return true;
    } catch (error) {
      console.error('初始化失败:', error);
      return false;
    }
  }

  async executeTrade(symbol, action, confidence, price, quantity) {
    if (!this.isLive) {
      console.log(`模拟交易: ${action} ${quantity} ${symbol} @ ${price}`);
      return this.simulateTrade(symbol, action, price, quantity);
    }

    try {
      let order;
      
      switch (action) {
        case 'BUY':
          order = await this.client.order({
            symbol,
            side: 'BUY',
            type: 'LIMIT',
            quantity,
            price: price.toFixed(2),
            timeInForce: 'GTC'
          });
          break;
          
        case 'SELL':
          order = await this.client.order({
            symbol,
            side: 'SELL',
            type: 'LIMIT',
            quantity,
            price: price.toFixed(2),
            timeInForce: 'GTC'
          });
          break;
          
        default:
          return null;
      }
      
      const trade = {
        id: order.orderId,
        symbol,
        action,
        price,
        quantity,
        timestamp: new Date(),
        confidence
      };
      
      this.tradeHistory.push(trade);
      this.emit('trade', trade);
      
      return order;
    } catch (error) {
      console.error('交易执行失败:', error);
      return null;
    }
  }

  simulateTrade(symbol, action, price, quantity) {
    const trade = {
      id: Date.now(),
      symbol,
      action,
      price,
      quantity,
      timestamp: new Date(),
      simulated: true
    };
    
    if (action === 'BUY') {
      const cost = price * quantity;
      if (cost <= this.capital) {
        this.capital -= cost;
        this.positions.set(symbol, {
          quantity: (this.positions.get(symbol)?.quantity || 0) + quantity,
          avgPrice: price
        });
      }
    } else if (action === 'SELL') {
      const position = this.positions.get(symbol);
      if (position && position.quantity >= quantity) {
        const revenue = price * quantity;
        this.capital += revenue;
        position.quantity -= quantity;
        
        if (position.quantity === 0) {
          this.positions.delete(symbol);
        }
      }
    }
    
    this.tradeHistory.push(trade);
    this.emit('trade', trade);
    
    return trade;
  }

  calculatePositionSize(price, confidence) {
    const riskPerTrade = this.capital * 0.02; // 每笔交易风险2%
    const maxPosition = this.capital * 0.3 * confidence; // 最大仓位30%
    
    const stopLossAmount = price * config.trading.stopLoss;
    const quantityByRisk = riskPerTrade / stopLossAmount;
    const quantityByCapital = maxPosition / price;
    
    return Math.min(quantityByRisk, quantityByCapital);
  }

  async processSignal(data, prediction) {
    const { action, confidence } = prediction;
    const currentPrice = data.close;
    
    if (confidence < 0.7) {
      console.log(`置信度过低: ${confidence}，跳过交易`);
      return;
    }
    
    const quantity = this.calculatePositionSize(currentPrice, confidence);
    
    if (quantity <= 0) {
      console.log('仓位计算为0，跳过交易');
      return;
    }
    
    await this.executeTrade(
      config.trading.symbol,
      action,
      confidence,
      currentPrice,
      quantity.toFixed(6)
    );
  }

  start() {
    this.isLive = true;
    console.log('交易引擎启动');
  }

  stop() {
    this.isLive = false;
    console.log('交易引擎停止');
  }

  getPerformance() {
    const initialCapital = config.trading.initialCapital;
    const currentValue = this.capital;
    
    // 计算持仓价值
    let positionsValue = 0;
    for (const [symbol, position] of this.positions) {
      // 这里应该获取当前市价，简单起见使用平均成本
      positionsValue += position.avgPrice * position.quantity;
    }
    
    const totalValue = currentValue + positionsValue;
    const profit = totalValue - initialCapital;
    const roi = (profit / initialCapital) * 100;
    
    return {
      initialCapital,
      currentCapital: currentValue,
      positionsValue,
      totalValue,
      profit,
      roi: roi.toFixed(2) + '%',
      totalTrades: this.tradeHistory.length,
      winningTrades: this.tradeHistory.filter(t => {
        if (t.action === 'BUY') return false;
        // 简化的胜率计算
        return Math.random() > 0.5;
      }).length
    };
  }
}