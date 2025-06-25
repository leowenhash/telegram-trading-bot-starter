import { PublicKey, Keypair, Connection, VersionedTransaction } from '@solana/web3.js';
import { BN } from 'bn.js';
import DLMM, { autoFillYByStrategy, StrategyType } from '@meteora-ag/dlmm';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

// 网络到RPC的映射
const NETWORK_TO_RPC = {
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com'
};

class MeteoraService {
  connection: Connection;
  rpcUrl: string;

  /**
   * 创建Meteora服务实例
   * @param {Connection|string} [connection] - 可选的Solana连接实例或RPC URL字符串
   */
  constructor(connection?: Connection | string) {
    const network = process.env.SOLANA_NETWORK as keyof typeof NETWORK_TO_RPC || 'devnet';
    const rpcUrl = NETWORK_TO_RPC[network] || NETWORK_TO_RPC.devnet;
    
    if (connection) {
      if (typeof connection === 'string') {
        this.connection = new Connection(connection, 'confirmed');
        this.rpcUrl = connection;
      } else {
        this.connection = connection;
        this.rpcUrl = connection.rpcEndpoint;
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
  async createDlmmPool(poolAddress: string): Promise<InstanceType<typeof DLMM>> {
    if (!this.connection) {
      throw new Error('Solana connection not established');
    }
    
    try {
      const publicKey = new PublicKey(poolAddress);
      console.log(`Creating DLMM pool with address: ${poolAddress}`);
      const dlmm = await DLMM.create(this.connection, publicKey);
      console.log('DLMM pool created successfully');
      return dlmm;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to create DLMM pool: ${errMsg}`);
      throw new Error(`Invalid pool address or DLMM initialization failed: ${errMsg}`);
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
  async createBalancePosition(
    dlmmPool: InstanceType<typeof DLMM>,
    userPubkey: string,
    totalXAmount: number,
    rangeInterval = 10
  ): Promise<VersionedTransaction> {
    const activeBin = await dlmmPool.getActiveBin();
    const minBinId = activeBin.binId - rangeInterval;
    const maxBinId = activeBin.binId + rangeInterval;

    const totalYAmount = autoFillYByStrategy(
      activeBin.binId,
      (dlmmPool as any).lbPair.binStep as number,
      new BN(totalXAmount),
      activeBin.xAmount,
      activeBin.yAmount,
      minBinId,
      maxBinId,
      StrategyType.Spot
    );

    const tx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: new PublicKey(userPubkey), // 使用用户钱包地址作为仓位地址
      user: new PublicKey(userPubkey),
      totalXAmount: new BN(totalXAmount),
      totalYAmount,
      strategy: {
        maxBinId,
        minBinId,
        strategyType: StrategyType.Spot
      }
    });
    const serializedTx = tx.serialize();
    return VersionedTransaction.deserialize(serializedTx);
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
  async createImbalancePosition(
    dlmmPool: InstanceType<typeof DLMM>,
    userPubkey: string,
    totalXAmount: number,
    totalYAmount: number,
    rangeInterval = 10
  ): Promise<VersionedTransaction> {
    const activeBin = await dlmmPool.getActiveBin();
    const minBinId = activeBin.binId - rangeInterval;
    const maxBinId = activeBin.binId + rangeInterval;

    const tx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: new PublicKey(userPubkey), // 使用用户钱包地址作为仓位地址
      user: new PublicKey(userPubkey),
      totalXAmount: new BN(totalXAmount),
      totalYAmount: new BN(totalYAmount),
      strategy: {
        maxBinId,
        minBinId,
        strategyType: StrategyType.Spot
      }
    });
    const serializedTx = tx.serialize();
    return VersionedTransaction.deserialize(serializedTx);
  }

  /**
   * 创建单边仓位
   * @param {DLMM} dlmmPool - DLMM池实例
   * @param {string} userPubkey - 用户公钥
   * @param {number} totalXAmount - X代币数量
   * @param {number} rangeInterval - 区间范围
   * @returns {Promise<Object>} 交易结果
   */
  async createOneSidePosition(
    dlmmPool: InstanceType<typeof DLMM>,
    userPubkey: string,
    totalXAmount: number,
    rangeInterval = 10
  ): Promise<VersionedTransaction> {
    const activeBin = await dlmmPool.getActiveBin();
    const minBinId = activeBin.binId;
    const maxBinId = activeBin.binId + rangeInterval * 2;

    const tx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: new PublicKey(userPubkey), // 使用用户钱包地址作为仓位地址
      user: new PublicKey(userPubkey),
      totalXAmount: new BN(totalXAmount),
      totalYAmount: new BN(0),
      strategy: {
        maxBinId,
        minBinId,
        strategyType: StrategyType.Spot
      }
    });
    const serializedTx = tx.serialize();
    return VersionedTransaction.deserialize(serializedTx);
  }
}

export default MeteoraService;
