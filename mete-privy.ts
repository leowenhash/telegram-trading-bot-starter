import { Connection, PublicKey, VersionedTransaction, TransactionMessage, Keypair, Transaction } from '@solana/web3.js';
import { BN } from 'bn.js';
import dotenv from 'dotenv';
import { PrivyClient } from '@privy-io/server-auth';
import DLMM, { autoFillYByStrategy, StrategyType } from '@meteora-ag/dlmm';

dotenv.config({ path: '.env' });

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

const privy = new PrivyClient(process.env.PRIVY_APP_ID as string, process.env.PRIVY_APP_SECRET as string, {
  walletApi: {
    authorizationPrivateKey: process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY as string
  }
});

const POOL_ADDRESS = 'NPLipchco8sZA4jSR47dVafy77PdbpBCfqPf8Ksvsvj';
const WALLET_ID = 'pwrl3khyz8h60ndqy61og2x4';
const USER_PUBKEY = '5vkThAJ6ao4UxA1SGRZgtzx39kvZjLmdxB44QKaS6YUt';
const AMOUNT = 100;

async function createPosition() {
  try {
    const dlmmPool = await DLMM.create(connection, new PublicKey(POOL_ADDRESS));
    console.log('✅ DLMM 池创建成功');

    const activeBin = await dlmmPool.getActiveBin();
    const minBinId = activeBin.binId - 10;
    const maxBinId = activeBin.binId + 10;

    const totalYAmount = autoFillYByStrategy(
      activeBin.binId,
      (dlmmPool as any).lbPair.binStep,
      new BN(AMOUNT),
      activeBin.xAmount,
      activeBin.yAmount,
      minBinId,
      maxBinId,
      StrategyType.Spot
    );

    const positionKeypair = Keypair.generate();

    const tx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: positionKeypair.publicKey,
      user: new PublicKey(USER_PUBKEY),
      totalXAmount: new BN(AMOUNT),
      totalYAmount,
      strategy: {
        maxBinId,
        minBinId,
        strategyType: StrategyType.Spot
      }
    });

    console.log('✅ 交易构造完成');

    const transaction = Array.isArray(tx) ? tx[0] : tx;

    console.log('📦 交易类型：', transaction.constructor.name);

    // 获取最新 blockhash
    const { blockhash } = await connection.getLatestBlockhash('finalized');

    let finalTransaction;

    if (transaction instanceof VersionedTransaction) {
      // 处理 VersionedTransaction
      const instructions = transaction.message.staticAccountKeys.map((_, idx) => {
        const ix = transaction.message.compiledInstructions[idx];
        return {
          programIdIndex: ix.programIdIndex,
          accountKeyIndexes: ix.accountKeyIndexes,
          data: ix.data
        };
      });

      const messageV0 = new TransactionMessage({
        payerKey: new PublicKey(USER_PUBKEY),
        recentBlockhash: blockhash,
        instructions: instructions.map(ix => {
          const programId = transaction.message.staticAccountKeys[ix.programIdIndex];
          const accounts = ix.accountKeyIndexes.map(i => ({
            pubkey: transaction.message.staticAccountKeys[i],
            isSigner: false,
            isWritable: true
          }));
          return {
            programId,
            keys: accounts,
            data: Buffer.from(ix.data)
          };
        })
      }).compileToV0Message();

      finalTransaction = new VersionedTransaction(messageV0);
      finalTransaction.sign([positionKeypair]);

    } else if (transaction instanceof Transaction) {
      // 处理 legacy Transaction
      transaction.recentBlockhash = blockhash;
      transaction.feePayer ||= new PublicKey(USER_PUBKEY);
      transaction.partialSign(positionKeypair);

      finalTransaction = transaction;

    } else if (typeof transaction === 'string') {
      throw new Error('当前交易已被 Meteora SDK 序列化为 base64，无法修改 blockhash，请联系 Meteora 支持。');
    } else {
      throw new Error('未知交易类型，无法处理。');
    }

    // 使用signTransaction签名交易
    const { signedTransaction } = await privy.walletApi.solana.signTransaction({
      walletId: WALLET_ID,
      transaction: finalTransaction
    });

    // 添加position keypair的签名
    const signedTx = VersionedTransaction.deserialize(signedTransaction.serialize());
    signedTx.sign([positionKeypair]);

    // 发送交易
    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });

    console.log('🎉 仓位创建成功！交易哈希:', signature);
    return signature;

  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('❌ 创建仓位失败:', error.message);
      if (error.message.includes('Transaction was not confirmed')) {
        console.error('请检查网络连接和 gas 费用设置');
      }
    } else {
      console.error('❌ 创建仓位失败: 未知错误类型');
    }
    throw error;
  }
}

createPosition();
