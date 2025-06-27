import { PublicKey, Keypair, Connection, VersionedTransaction, Transaction, Cluster } from '@solana/web3.js';
import { BN } from 'bn.js';
import DLMM, { autoFillYByStrategy, StrategyType } from '@meteora-ag/dlmm';
import type { LbPosition } from '@meteora-ag/dlmm';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

// 网络到RPC的映射
const NETWORK_TO_RPC: Record<string, string> = {
  devnet: process.env.DEVNET_RPC || 'https://api.devnet.solana.com',
  testnet: process.env.TESTNET_RPC || 'https://api.testnet.solana.com',
  mainnet: process.env.MAINNET_RPC || 'https://api.mainnet-beta.solana.com'
};

export class MeteoraService {
  private connection: Connection;
  private dlmmPool?: DLMM;
  private poolAddress: PublicKey;
  private network: Cluster;

  constructor(connection: Connection, poolAddress: string, network: Cluster = process.env.NETWORK as Cluster || 'devnet') {
    if (!NETWORK_TO_RPC[network]) {
      throw new Error(`不支持的网络类型: ${network}`);
    }
    
    this.connection = connection;
    this.poolAddress = new PublicKey(poolAddress);
    this.network = network;
  }

  async initDLMMPool(): Promise<DLMM> {
    if (!this.dlmmPool) {
      this.dlmmPool = await DLMM.create(this.connection, this.poolAddress);
      console.log(`✅ DLMM 池创建成功 (网络: ${this.network})`);
    }
    return this.dlmmPool;
  }

  async listPositions(userPubkey: string): Promise<LbPosition[]> {
    const dlmmPool = await this.initDLMMPool();
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(new PublicKey(userPubkey));
    return userPositions;
  }

  async createBalancePosition(userPubkey: string, amount: number, positionKeypair?: Keypair) {
    const dlmmPool = await this.initDLMMPool();
    const activeBin = await dlmmPool.getActiveBin();
    const minBinId = activeBin.binId - 10;
    const maxBinId = activeBin.binId + 10;

    const totalYAmount = autoFillYByStrategy(
      activeBin.binId,
      (dlmmPool as any).lbPair.binStep,
      new BN(amount),
      activeBin.xAmount,
      activeBin.yAmount,
      minBinId,
      maxBinId,
      StrategyType.Spot
    );

    positionKeypair = positionKeypair || Keypair.generate();

    const tx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: positionKeypair.publicKey,
      user: new PublicKey(userPubkey),
      totalXAmount: new BN(amount),
      totalYAmount,
      strategy: {
        maxBinId,
        minBinId,
        strategyType: StrategyType.Spot
      }
    });

    console.log('✅ 交易构造完成');

    return {
      transaction: Array.isArray(tx) ? tx[0] : tx,
      positionKeypair
    };
  }

  async createImbalancePosition(userPubkey: string, xAmount: number, yAmount: number) {
    const dlmmPool = await this.initDLMMPool();
    const activeBin = await dlmmPool.getActiveBin();
    const minBinId = activeBin.binId - 10;
    const maxBinId = activeBin.binId + 10;

    const positionKeypair = Keypair.generate();

    const tx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: positionKeypair.publicKey,
      user: new PublicKey(userPubkey),
      totalXAmount: new BN(xAmount),
      totalYAmount: new BN(yAmount),
      strategy: {
        maxBinId,
        minBinId,
        strategyType: StrategyType.Spot
      }
    });

    return {
      transaction: Array.isArray(tx) ? tx[0] : tx,
      positionKeypair
    };
  }

  async createOneSidePosition(userPubkey: string, amount: number) {
    const dlmmPool = await this.initDLMMPool();
    const activeBin = await dlmmPool.getActiveBin();
    const minBinId = activeBin.binId;
    const maxBinId = activeBin.binId + 20;

    const positionKeypair = Keypair.generate();

    const tx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: positionKeypair.publicKey,
      user: new PublicKey(userPubkey),
      totalXAmount: new BN(amount),
      totalYAmount: new BN(0),
      strategy: {
        maxBinId,
        minBinId,
        strategyType: StrategyType.Spot
      }
    });

    return {
      transaction: Array.isArray(tx) ? tx[0] : tx,
      positionKeypair
    };
  }

  // 其他DLMM操作函数...
  async removeLiquidity(positionPubKey: PublicKey, userPubkey: string, bps: number = 10000) {
    const dlmmPool = await this.initDLMMPool();
    const txs = await dlmmPool.removeLiquidity({
      position: positionPubKey,
      user: new PublicKey(userPubkey),
      fromBinId: 0,
      toBinId: 100,
      bps: new BN(bps),
      shouldClaimAndClose: bps === 10000
    });
    return Array.isArray(txs) ? txs : [txs];
  }

  async addLiquidity(positionPubKey: PublicKey, userPubkey: string, xAmount: number, yAmount: number) {
    const dlmmPool = await this.initDLMMPool();
    const activeBin = await dlmmPool.getActiveBin();
    return await dlmmPool.addLiquidityByStrategy({
      positionPubKey,
      user: new PublicKey(userPubkey),
      totalXAmount: new BN(xAmount * 10**6),
      totalYAmount: new BN(yAmount * 10**6),
      strategy: {
        maxBinId: activeBin.binId + 10,
        minBinId: activeBin.binId - 10,
        strategyType: StrategyType.Spot
      }
    });
  }

  async closePosition(positionPubKey: PublicKey, userPubkey: string) {
    const dlmmPool = await this.initDLMMPool();
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(new PublicKey(userPubkey));
    const position = userPositions.find(pos => pos.publicKey.equals(positionPubKey));
    
    if (!position) throw new Error('未找到指定仓位');

    const binIds = position.positionData.positionBinData.map(bin => bin.binId);
    const fromBinId = Math.min(...binIds);
    const toBinId = Math.max(...binIds);

    const txs = await dlmmPool.removeLiquidity({
      position: positionPubKey,
      user: new PublicKey(userPubkey),
      fromBinId,
      toBinId,
      bps: new BN(10000),
      shouldClaimAndClose: true
    });

    return Array.isArray(txs) ? txs : [txs];
  }

  async getActiveBin() {
    const dlmmPool = await this.initDLMMPool();
    const activeBin = await dlmmPool.getActiveBin();
    return activeBin;
  }
}

export default MeteoraService;
