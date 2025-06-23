const { 
  Connection, 
  PublicKey, 
  LAMPORTS_PER_SOL, 
  clusterApiUrl
} = require('@solana/web3.js');

class SolanaService {
  constructor() {
    this.network = process.env.SOLANA_NETWORK || 'devnet';
    this.connection = new Connection(clusterApiUrl(this.network));
  }

  /**
   * 发送已签名的原始交易
   * @param {Buffer} rawTransaction - 已签名的交易数据
   * @returns {Promise<string>} - 交易哈希
   */
  async sendRawTransaction(rawTransaction) {
    try {
      return await this.connection.sendRawTransaction(rawTransaction);
    } catch (error) {
      console.error('Send transaction error:', error);
      throw error;
    }
  }

  /**
   * 查询钱包余额
   * @param {string} publicKey - 钱包公钥
   * @returns {Promise<number>} - 余额(SOL)
   */
  async getBalance(publicKey) {
    try {
      const pubkey = new PublicKey(publicKey);
      const balance = await this.connection.getBalance(pubkey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Get balance error:', error);
      throw error;
    }
  }

  /**
   * 查询交易记录
   * @param {string} publicKey - 钱包公钥
   * @param {number} limit - 返回的交易数量限制
   * @returns {Promise<Array>} - 交易记录数组
   */
  async getTransactions(publicKey, limit = 10) {
    try {
      const pubkey = new PublicKey(publicKey);
      const signatures = await this.connection.getSignaturesForAddress(pubkey, { limit });
      
      const transactions = await Promise.all(
        signatures.map(async (signature) => {
          const tx = await this.connection.getTransaction(signature.signature, {
            maxSupportedTransactionVersion: 0
          });
          return {
            signature: signature.signature,
            blockTime: signature.blockTime,
            slot: signature.slot,
            memo: tx?.transaction?.message?.instructions?.[0]?.parsed?.info?.memo || null,
            amount: tx?.meta?.postBalances?.[0] && tx?.meta?.preBalances?.[0] 
              ? tx.meta.preBalances[0] - tx.meta.postBalances[0] 
              : 0
          };
        })
      );

      return transactions;
    } catch (error) {
      console.error('Get transactions error:', error);
      throw error;
    }
  }

  /**
   * 切换网络配置
   * @param {string} network - 网络类型(devnet/testnet/mainnet)
   */
  setNetwork(network) {
    this.network = network;
    this.connection = new Connection(clusterApiUrl(network));
  }
}

module.exports = SolanaService;
