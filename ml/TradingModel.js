import * as tf from '@tensorflow/tfjs';
const { createModel } = 'brain.js';

export class TradingModel {
  constructor(inputSize = 10, outputSize = 3) {
    this.inputSize = inputSize;
    this.outputSize = outputSize;
    this.model = null;
    this.brainModel = null;
  }

  createTFModel() {
    const model = tf.sequential();
    
    // LSTM层处理时间序列数据
    model.add(tf.layers.lstm({
      units: 64,
      inputShape: [this.inputSize, 1],
      returnSequences: true
    }));
    
    model.add(tf.layers.dropout({ rate: 0.2 }));
    
    model.add(tf.layers.lstm({
      units: 32,
      returnSequences: false
    }));
    
    model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
    model.add(tf.layers.dropout({ rate: 0.2 }));
    
    // 输出层: 0-持有, 1-买入, 2-卖出
    model.add(tf.layers.dense({
      units: this.outputSize,
      activation: 'softmax'
    }));
    
    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });
    
    this.model = model;
    return model;
  }

  createBrainModel() {
    const config = {
      binaryThresh: 0.5,
      hiddenLayers: [64, 32],
      activation: 'sigmoid',
    };
    
    this.brainModel = createModel(config);
    return this.brainModel;
  }

  prepareData(data, lookback = 10) {
    const sequences = [];
    const labels = [];
    
    // 创建特征序列
    for (let i = lookback; i < data.length; i++) {
      const sequence = [];
      for (let j = i - lookback; j < i; j++) {
        const features = this.extractFeatures(data[j]);
        sequence.push(features);
      }
      
      // 计算标签（未来3根K线的收益率）
      if (i + 3 < data.length) {
        const futureReturn = (data[i + 3].close - data[i].close) / data[i].close;
        let label;
        
        if (futureReturn > 0.02) label = 1; // 买入
        else if (futureReturn < -0.02) label = 2; // 卖出
        else label = 0; // 持有
        
        sequences.push(sequence);
        labels.push(label);
      }
    }
    
    return {
      sequences: tf.tensor3d(sequences),
      labels: tf.oneHot(tf.tensor1d(labels, 'int32'), this.outputSize)
    };
  }

  extractFeatures(dataPoint) {
    return [
      dataPoint.close,
      dataPoint.volume,
      dataPoint.rsi || 50,
      dataPoint.macd || 0,
      dataPoint.signal || 0,
      dataPoint.bb_upper || dataPoint.close,
      dataPoint.bb_lower || dataPoint.close,
      dataPoint.vwap || dataPoint.close,
      (dataPoint.high - dataPoint.low) / dataPoint.close, // 波动率
      dataPoint.close / dataPoint.open - 1 // 涨跌幅
    ];
  }

  async train(data, epochs = 100, batchSize = 32) {
    const { sequences, labels } = this.prepareData(data);
    
    const history = await this.model.fit(sequences, labels, {
      epochs,
      batchSize,
      validationSplit: 0.2,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          console.log(`Epoch ${epoch}: loss = ${logs.loss}, accuracy = ${logs.acc}`);
        }
      }
    });
    
    return history;
  }

  async predict(sequence) {
    if (!this.model) {
      throw new Error('Model not initialized');
    }
    
    const inputTensor = tf.tensor3d([sequence]);
    const prediction = this.model.predict(inputTensor);
    const probabilities = await prediction.data();
    
    // 返回动作和置信度
    const actions = ['HOLD', 'BUY', 'SELL'];
    const maxIndex = probabilities.indexOf(Math.max(...probabilities));
    
    return {
      action: actions[maxIndex],
      confidence: probabilities[maxIndex],
      probabilities
    };
  }

  async saveModel(path) {
    await this.model.save(`file://${path}`);
  }

  async loadModel(path) {
    this.model = await tf.loadLayersModel(`file://${path}/model.json`);
  }
}