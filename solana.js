const { 
  Connection, 
  PublicKey, 
  LAMPORTS_PER_SOL, 
  clusterApiUrl
} = require('@solana/web3.js');
const { getAssociatedTokenAddress, createTransferInstruction } = require('@solana/spl-token');

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

  /**
   * 代币转账
   * @param {string} fromPubkey - 发送方钱包地址
   * @param {string} toPubkey - 接收方钱包地址
   * @param {string} mint - 代币mint地址
   * @param {number} amount - 转账数量(代币最小单位)
   * @param {Buffer} rawTransaction - 已签名的交易数据
   * @returns {Promise<string>} - 交易哈希
   */
  async transferToken(fromPubkey, toPubkey, mint, amount, rawTransaction) {
    try {
      // 获取代币的小数位数
      const tokenInfo = await this.connection.getParsedAccountInfo(new PublicKey(mint));
      const decimals = tokenInfo?.value?.data?.parsed?.info?.decimals || 9;
      
      // 将转账金额转换为最小单位
      const amountInLamports = Math.floor(amount * Math.pow(10, decimals));
      
      console.log(`Transferring ${amount} tokens (${amountInLamports} lamports) from ${fromPubkey} to ${toPubkey}`);
      
      return await this.connection.sendRawTransaction(rawTransaction);
    } catch (error) {
      console.error('Token transfer error:', error);
      throw error;
    }
  }

  /**
   * 查询代币余额
   * @param {string} walletAddress - 钱包地址
   * @param {string} tokenMint - 代币mint地址
   * @returns {Promise<number>} - 代币余额(最小单位)
   */
  async getTokenBalance(walletAddress, tokenMint) {
    try {
      const tokenAccount = await getAssociatedTokenAddress(
        new PublicKey(tokenMint),
        new PublicKey(walletAddress)
      );
      
      const accountInfo = await this.connection.getTokenAccountBalance(
        new PublicKey(tokenAccount)
      );
      
      return accountInfo.value.amount;
    } catch (error) {
      // 如果代币账户不存在，返回0
      if (error.message.includes('could not find account')) {
        return '0';
      }
      console.error('Get token balance error:', error);
      throw error;
    }
  }

  /**
   * 查询钱包中所有代币余额
   * @param {string} walletAddress - 钱包地址
   * @returns {Promise<Object>} - 代币余额对象 {tokenMint: {amount: string, decimals: number}}
   */
  async getAllTokenBalances(walletAddress) {
    try {
      const pubkey = new PublicKey(walletAddress);
      const tokenAccounts = await this.connection.getTokenAccountsByOwner(pubkey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
      });

      const balances = {};
      
      // 添加SOL余额
      const solBalance = await this.connection.getBalance(pubkey);
      balances['SOL'] = {
        amount: solBalance.toString(),
        decimals: 9,
        uiAmount: solBalance / LAMPORTS_PER_SOL
      };

      // 处理代币余额
      for (const account of tokenAccounts.value) {
        try {
          const accountInfo = await this.connection.getTokenAccountBalance(account.pubkey);
          console.log(`Token account info:`, JSON.stringify(accountInfo, null, 2));
          
          if (!accountInfo.value || accountInfo.value.amount === '0') {
            continue;
          }

          // 从代币账户信息获取mint地址
          let mint;
          try {
            const accountData = await this.connection.getParsedAccountInfo(account.pubkey);
            mint = accountData?.value?.data?.parsed?.info?.mint;
            if (!mint) {
              console.warn(`No mint address found for token account: ${account.pubkey}`);
              continue;
            }
          } catch (error) {
            console.error(`Error getting mint address for account ${account.pubkey}:`, error);
            continue;
          }

          let symbol = mint.slice(0, 4) + '...' + mint.slice(-4);
          console.log(`Processing token: ${mint} (${symbol})`);
          
          try {
            // 尝试获取代币元数据
            const tokenInfo = await this.connection.getParsedAccountInfo(new PublicKey(mint));
            if (tokenInfo?.value?.data?.parsed?.info?.symbol) {
              symbol = tokenInfo.value.data.parsed.info.symbol;
            }
          } catch (error) {
            console.log(`Could not get token info for ${mint}:`, error.message);
          }
          
          balances[mint] = {
            amount: accountInfo.value.amount,
            decimals: accountInfo.value.decimals,
            uiAmount: accountInfo.value.uiAmount,
            symbol: symbol
          };
        } catch (error) {
          console.error(`Error processing token account ${account.pubkey}:`, error);
        }
      }

      return balances;
    } catch (error) {
      console.error('Get all token balances error:', error);
      throw error;
    }
  }
}

module.exports = SolanaService;
