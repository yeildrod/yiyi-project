import { DataCollector } from '../data/DataCollector.js';
import { TradingModel } from '../ml/TradingModel.js';
import mongoose from 'mongoose';
import { config } from '../config.js';

export class Trainer {
  constructor() {
    this.dataCollector = new DataCollector();
    this.model = new TradingModel();
    this.db = null;
  }

  async connectDB() {
    try {
      await mongoose.connect(config.mongo.uri);
      this.db = mongoose.connection;
      console.log('MongoDB连接成功');
    } catch (error) {
      console.error('MongoDB连接失败:', error);
    }
  }

  async trainModel() {
    console.log('开始训练模型...');
    
    // 1. 收集数据
    const historicalData = await this.dataCollector.fetchHistoricalData(
      config.trading.symbol,
      config.trading.timeframe,
      1000
    );
    
    console.log(`收集到 ${historicalData.length} 条历史数据`);
    
    // 2. 创建并训练模型
    this.model.createTFModel();
    const history = await this.model.train(historicalData, 50, 32);
    
    // 3. 保存模型
    await this.model.saveModel('./models/latest');
    console.log('模型训练完成并保存');
    
    // 4. 保存训练记录
    await this.saveTrainingRecord(history);
    
    return history;
  }

  async saveTrainingRecord(history) {
    const trainingSchema = new mongoose.Schema({
      timestamp: Date,
      symbol: String,
      timeframe: String,
      epochs: Number,
      finalLoss: Number,
      finalAccuracy: Number,
      trainingTime: Number
    });
    
    const TrainingRecord = mongoose.models.TrainingRecord || 
      mongoose.model('TrainingRecord', trainingSchema);
    
    const record = new TrainingRecord({
      timestamp: new Date(),
      symbol: config.trading.symbol,
      timeframe: config.trading.timeframe,
      epochs: history.params.epochs,
      finalLoss: history.history.loss[history.history.loss.length - 1],
      finalAccuracy: history.history.acc[history.history.acc.length - 1],
      trainingTime: Date.now() - history.startTime
    });
    
    await record.save();
    console.log('训练记录已保存');
  }

  async backtest(data, model, initialCapital = 1000) {
    console.log('开始回测...');
    
    const trades = [];
    let capital = initialCapital;
    let positions = 0;
    let positionEntry = 0;
    
    for (let i = 20; i < data.length - 3; i++) {
      const sequence = [];
      for (let j = i - 10; j < i; j++) {
        sequence.push(model.extractFeatures(data[j]));
      }
      
      const prediction = await model.predict(sequence);
      
      if (prediction.confidence > 0.7) {
        const currentPrice = data[i].close;
        
        if (prediction.action === 'BUY' && positions === 0) {
          // 买入
          const quantity = capital * 0.3 / currentPrice;
          positions = quantity;
          positionEntry = currentPrice;
          capital -= quantity * currentPrice;
          
          trades.push({
            type: 'BUY',
            price: currentPrice,
            quantity,
            timestamp: data[i].timestamp,
            confidence: prediction.confidence
          });
        } else if (prediction.action === 'SELL' && positions > 0) {
          // 卖出
          const profit = (currentPrice - positionEntry) * positions;
          capital += positions * currentPrice;
          
          trades.push({
            type: 'SELL',
            price: currentPrice,
            quantity: positions,
            profit,
            timestamp: data[i].timestamp,
            confidence: prediction.confidence
          });
          
          positions = 0;
          positionEntry = 0;
        }
      }
    }
    
    // 平仓
    if (positions > 0) {
      const lastPrice = data[data.length - 1].close;
      capital += positions * lastPrice;
    }
    
    const totalProfit = capital - initialCapital;
    const roi = (totalProfit / initialCapital) * 100;
    const winRate = trades.filter(t => t.profit > 0).length / trades.length * 100;
    
    console.log('回测结果:');
    console.log(`初始资本: ${initialCapital}`);
    console.log(`最终资本: ${capital}`);
    console.log(`总利润: ${totalProfit}`);
    console.log(`ROI: ${roi.toFixed(2)}%`);
    console.log(`交易次数: ${trades.length}`);
    console.log(`胜率: ${winRate.toFixed(2)}%`);
    
    return {
      initialCapital,
      finalCapital: capital,
      totalProfit,
      roi,
      totalTrades: trades.length,
      winRate,
      trades
    };
  }
}