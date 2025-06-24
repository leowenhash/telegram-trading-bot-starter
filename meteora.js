const { PublicKey, Keypair, Connection } = require('@solana/web3.js');
const { BN } = require('bn.js');
const { autoFillYByStrategy, StrategyType } = require('@meteora-ag/dlmm');
const DLMM = require('@meteora-ag/dlmm').DLMM;
require('dotenv').config({ path: '.env.local' });

// 网络到RPC的映射
const NETWORK_TO_RPC = {
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com'
};

class MeteoraService {
  /**
   * 创建Meteora服务实例
   * @param {Connection|string} [connection] - 可选的Solana连接实例或RPC URL字符串
   */
  constructor(connection) {
    const network = process.env.SOLANA_NETWORK || 'devnet';
    const rpcUrl = NETWORK_TO_RPC[network] || NETWORK_TO_RPC.devnet;
    
    if (connection) {
      if (typeof connection === 'string') {
        this.connection = new Connection(connection, 'confirmed');
        this.rpcUrl = connection;
      } else {
        this.connection = connection;
        this.rpcUrl = connection._rpcEndpoint;
      }
    } else {
      this.connection = new Connection(rpcUrl, 'confirmed');
      this.rpcUrl = rpcUrl;
    }
    
    console.log(`Using RPC: ${this.rpcUrl}`);
  }

  /**
   * Creates a DLMM pool instance
   * @param {string} poolAddress - Pool address
   * @returns {Promise<DLMM>} DLMM instance
   * @throws {Error} If connection is not established or pool address is invalid
   */
  async createDlmmPool(poolAddress) {
    if (!this.connection) {
      throw new Error('Solana connection not established');
    }
    
    try {
      const publicKey = new PublicKey(poolAddress);
      return await DLMM.create(this.connection, publicKey);
    } catch (error) {
      throw new Error(`Invalid pool address: ${error.message}`);
    }
  }

  /**
   * 创建平衡仓位
   * @param {DLMM} dlmmPool - DLMM池实例
   * @param {string} userPubkey - 用户公钥
   * @param {number} totalXAmount - X代币数量
   * @param {number} rangeInterval - 区间范围
   * @returns {Promise<Object>} 交易结果
   */
  async createBalancePosition(dlmmPool, userPubkey, totalXAmount, rangeInterval = 10) {
    const activeBin = await dlmmPool.getActiveBin();
    const minBinId = activeBin.binId - rangeInterval;
    const maxBinId = activeBin.binId + rangeInterval;

    const totalYAmount = autoFillYByStrategy(
      activeBin.binId,
      dlmmPool.lbPair.binStep,
      new BN(totalXAmount),
      activeBin.xAmount,
      activeBin.yAmount,
      minBinId,
      maxBinId,
      StrategyType.Spot
    );

    const newPosition = new Keypair();

    return await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: newPosition.publicKey,
      user: new PublicKey(userPubkey),
      totalXAmount: new BN(totalXAmount),
      totalYAmount,
      strategy: {
        maxBinId,
        minBinId,
        strategyType: StrategyType.Spot
      }
    });
  }

  /**
   * 创建不平衡仓位
   * @param {DLMM} dlmmPool - DLMM池实例
   * @param {string} userPubkey - 用户公钥
   * @param {number} totalXAmount - X代币数量
   * @param {number} totalYAmount - Y代币数量
   * @param {number} rangeInterval - 区间范围
   * @returns {Promise<Object>} 交易结果
   */
  async createImbalancePosition(dlmmPool, userPubkey, totalXAmount, totalYAmount, rangeInterval = 10) {
    const activeBin = await dlmmPool.getActiveBin();
    const minBinId = activeBin.binId - rangeInterval;
    const maxBinId = activeBin.binId + rangeInterval;

    const newPosition = new Keypair();

    return await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: newPosition.publicKey,
      user: new PublicKey(userPubkey),
      totalXAmount: new BN(totalXAmount),
      totalYAmount: new BN(totalYAmount),
      strategy: {
        maxBinId,
        minBinId,
        strategyType: StrategyType.Spot
      }
    });
  }

  /**
   * 创建单边仓位
   * @param {DLMM} dlmmPool - DLMM池实例
   * @param {string} userPubkey - 用户公钥
   * @param {number} totalXAmount - X代币数量
   * @param {number} rangeInterval - 区间范围
   * @returns {Promise<Object>} 交易结果
   */
  async createOneSidePosition(dlmmPool, userPubkey, totalXAmount, rangeInterval = 10) {
    const activeBin = await dlmmPool.getActiveBin();
    const minBinId = activeBin.binId;
    const maxBinId = activeBin.binId + rangeInterval * 2;

    const newPosition = new Keypair();

    return await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: newPosition.publicKey,
      user: new PublicKey(userPubkey),
      totalXAmount: new BN(totalXAmount),
      totalYAmount: new BN(0),
      strategy: {
        maxBinId,
        minBinId,
        strategyType: StrategyType.Spot
      }
    });
  }
}

module.exports = MeteoraService;
