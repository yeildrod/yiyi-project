import { DataCollector } from './data/DataCollector.js';
import { TradingModel } from './ml/TradingModel.js';
import { TradingEngine } from './trading/TradingEngine.js';
import { Trainer } from './training/Trainer.js';
import { config } from './config.js';
import express from 'express';
import WebSocket from 'ws';

class AutoTradingSystem {
  constructor() {
    this.dataCollector = new DataCollector();
    this.model = new TradingModel();
    this.tradingEngine = new TradingEngine(this.model, config.trading.initialCapital);
    this.trainer = new Trainer();
    this.dataBuffer = [];
    this.isRunning = false;
    
    // 加载模型
    this.loadModel();
    
    // 设置WebSocket服务器
    this.setupWebSocket();
  }

  async loadModel() {
    try {
      await this.model.loadModel('./models/latest');
      console.log('模型加载成功');
    } catch (error) {
      console.log('未找到已训练模型，将使用新模型');
      this.model.createTFModel();
    }
  }

  setupWebSocket() {
    const app = express();
    const wss = new WebSocket.Server({ port: 8080 });
    
    wss.on('connection', (ws) => {
      console.log('客户端连接');
      
      // 发送性能数据
      const sendPerformance = () => {
        if (ws.readyState === WebSocket.OPEN) {
          const performance = this.tradingEngine.getPerformance();
          ws.send(JSON.stringify({
            type: 'performance',
            data: performance
          }));
        }
      };
      
      // 每5秒发送一次性能数据
      const interval = setInterval(sendPerformance, 5000);
      
      ws.on('close', () => {
        clearInterval(interval);
        console.log('客户端断开连接');
      });
    });
    
    app.get('/api/performance', (req, res) => {
      res.json(this.tradingEngine.getPerformance());
    });
    
    app.get('/api/trades', (req, res) => {
      res.json(this.tradingEngine.tradeHistory.slice(-50));
    });
    
    app.get('/api/start', (req, res) => {
      this.start();
      res.json({ status: 'started' });
    });
    
    app.get('/api/stop', (req, res) => {
      this.stop();
      res.json({ status: 'stopped' });
    });
    
    app.get('/api/train', async (req, res) => {
      try {
        await this.trainer.trainModel();
        await this.loadModel();
        res.json({ status: 'training_complete' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    app.listen(3000, () => {
      console.log('API服务器运行在 http://localhost:3000');
    });
  }

  async start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('自动交易系统启动');
    
    // 初始化交易引擎
    await this.tradingEngine.initialize();
    
    // 开始收集实时数据
    this.dataCollector.startRealTimeData(
      config.trading.symbol,
      config.trading.timeframe,
      async (data) => {
        if (!data.isFinal) return;
        
        this.dataBuffer.push(data);
        
        // 保持缓冲区大小
        if (this.dataBuffer.length > 100) {
          this.dataBuffer.shift();
        }
        
        // 添加技术指标
        const dataWithIndicators = this.dataCollector.addIndicators([...this.dataBuffer]);
        const latestData = dataWithIndicators[dataWithIndicators.length - 1];
        
        // 准备输入序列
        if (this.dataBuffer.length >= 10) {
          const sequence = [];
          for (let i = this.dataBuffer.length - 10; i < this.dataBuffer.length; i++) {
            sequence.push(this.model.extractFeatures(dataWithIndicators[i]));
          }
          
          // 预测
          const prediction = await this.model.predict(sequence);
          console.log(`预测: ${prediction.action}, 置信度: ${prediction.confidence.toFixed(4)}`);
          
          // 执行交易
          await this.tradingEngine.processSignal(latestData, prediction);
        }
      }
    );
    
    this.tradingEngine.start();
  }

  stop() {
    this.isRunning = false;
    this.tradingEngine.stop();
    console.log('自动交易系统停止');
  }

  async train() {
    console.log('开始训练...');
    await this.trainer.trainModel();
    await this.loadModel();
    console.log('训练完成，模型已重新加载');
  }
}

// 启动系统
const system = new AutoTradingSystem();

// 处理命令行参数
const args = process.argv.slice(2);
if (args.includes('--train')) {
  system.train();
} else if (args.includes('--start')) {
  system.start();
} else if (args.includes('--backtest')) {
  (async () => {
    const data = await system.dataCollector.fetchHistoricalData(
      config.trading.symbol,
      config.trading.timeframe,
      500
    );
    await system.trainer.backtest(data, system.model);
  })();
} else {
  console.log('可用命令:');
  console.log('  node index.js --train    训练模型');
  console.log('  node index.js --start    启动交易系统');
  console.log('  node index.js --backtest 运行回测');
}