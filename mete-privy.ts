import { Connection, PublicKey, VersionedTransaction, TransactionMessage, Keypair, Transaction } from '@solana/web3.js';
import { BN } from 'bn.js';
import dotenv from 'dotenv';
import { PrivyClient } from '@privy-io/server-auth';
import DLMM, { autoFillYByStrategy, StrategyType } from '@meteora-ag/dlmm';
import type { LbPosition } from '@meteora-ag/dlmm';

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

// 池子实例缓存
let dlmmPool: DLMM;

async function initDLMMPool(): Promise<DLMM> {
  if (!dlmmPool) {
    dlmmPool = await DLMM.create(connection, new PublicKey(POOL_ADDRESS));
    console.log('✅ DLMM 池创建成功');
  }
  return dlmmPool;
}

async function signAndSendTransaction(transaction: VersionedTransaction | Transaction): Promise<string> {
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
  } else if (transaction instanceof Transaction) {
    // 处理 legacy Transaction
    transaction.recentBlockhash = blockhash;
    transaction.feePayer ||= new PublicKey(USER_PUBKEY);
    finalTransaction = transaction;
  } else {
    throw new Error('未知交易类型，无法处理。');
  }

  // 使用signTransaction签名交易
  const { signedTransaction } = await privy.walletApi.solana.signTransaction({
    walletId: WALLET_ID,
    transaction: finalTransaction
  });

  // 发送交易
  return await connection.sendRawTransaction(signedTransaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed'
  });
}

async function listPositions(): Promise<LbPosition[]> {
  const dlmmPool = await initDLMMPool();
  const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(new PublicKey(USER_PUBKEY));
  
  console.log('\n当前仓位列表:');
  userPositions.forEach((pos, i) => {
    console.log(`${i + 1}. ${pos.publicKey.toString()}`);
  });
  
  return userPositions;
}

async function removeLiquidity(positionPubKey: PublicKey, bps: number = 10000): Promise<string[]> {
  const dlmmPool = await initDLMMPool();
  
  const txs = await dlmmPool.removeLiquidity({
    position: positionPubKey,
    user: new PublicKey(USER_PUBKEY),
    fromBinId: 0, // 实际应从仓位数据获取
    toBinId: 100, // 实际应从仓位数据获取
    bps: new BN(bps),
    shouldClaimAndClose: bps === 10000
  });

  const txArray = Array.isArray(txs) ? txs : [txs];
  const results: string[] = [];
  
  for (const tx of txArray) {
    results.push(await signAndSendTransaction(tx));
  }
  
  return results;
}

async function getActiveBin() {
  const dlmmPool = await initDLMMPool();
  const activeBin = await dlmmPool.getActiveBin();
  return {
    binId: activeBin.binId,
    xAmount: activeBin.xAmount,
    yAmount: activeBin.yAmount,
    price: activeBin.price
  };
}

async function showPoolTokenStatus() {
  const dlmmPool = await initDLMMPool();
  const [tokenXInfo, tokenYInfo] = await Promise.all([
    connection.getTokenSupply(dlmmPool.tokenX.publicKey),
    connection.getTokenSupply(dlmmPool.tokenY.publicKey)
  ]);
  
  // 使用类型断言处理DLMM类型
  const pool = dlmmPool as any;
  
  return {
    baseToken: {
      address: dlmmPool.tokenX.publicKey.toString(),
      decimals: tokenXInfo.value.decimals,
      symbol: 'Unknown' // 默认值，实际可能需要从其他地方获取symbol
    },
    quoteToken: {
      address: dlmmPool.tokenY.publicKey.toString(),
      decimals: tokenYInfo.value.decimals,
      symbol: 'Unknown' // 默认值，实际可能需要从其他地方获取symbol
    },
    binStep: pool.lbPair.binStep / 100
  };
}

async function showBinPriceDetails() {
  const dlmmPool = await initDLMMPool();
  const activeBin = await dlmmPool.getActiveBin();
  // 使用类型断言处理DLMM类型
  const pool = dlmmPool as any;
  const binStep = pool.lbPair.binStep / 10000;
  
  return {
    currentBinId: activeBin.binId,
    currentPrice: activeBin.price.toString(),
    binStepPercentage: binStep * 100,
    priceFormula: `(1 + ${binStep})^${activeBin.binId}`,
    neighborBins: {
      previous: Math.pow(1 + binStep, activeBin.binId - 1),
      next: Math.pow(1 + binStep, activeBin.binId + 1)
    }
  };
}

async function closePosition(positionPubKey: PublicKey): Promise<string[]> {
  const dlmmPool = await initDLMMPool();
  const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(new PublicKey(USER_PUBKEY));
  const position = userPositions.find(pos => pos.publicKey.equals(positionPubKey));
  
  if (!position) {
    throw new Error('未找到指定仓位');
  }

  // 获取仓位实际的bin范围
  const binIds = position.positionData.positionBinData.map(bin => bin.binId);
  const fromBinId = Math.min(...binIds);
  const toBinId = Math.max(...binIds);

  // 先移除100%流动性并关闭仓位
  const txs = await dlmmPool.removeLiquidity({
    position: positionPubKey,
    user: new PublicKey(USER_PUBKEY),
    fromBinId,
    toBinId,
    bps: new BN(10000), // 100%
    shouldClaimAndClose: true // 同时领取手续费和关闭仓位
  });

  const txArray = Array.isArray(txs) ? txs : [txs];
  const results: string[] = [];
  
  for (const tx of txArray) {
    results.push(await signAndSendTransaction(tx));
  }
  
  return results;
}

async function claimFees(positionPubKeys: PublicKey[]): Promise<string[]> {
  const dlmmPool = await initDLMMPool();
  const positions = await Promise.all(
    positionPubKeys.map(pubkey => dlmmPool.getPosition(pubkey))
  );

  const txs = await dlmmPool.claimAllSwapFee({
    owner: new PublicKey(USER_PUBKEY),
    positions
  });

  const results: string[] = [];
  for (const tx of txs) {
    results.push(await signAndSendTransaction(tx));
  }
  return results;
}

async function swapTokens(inToken: PublicKey, outToken: PublicKey, amount: number, swapYtoX: boolean = false): Promise<string> {
  const dlmmPool = await initDLMMPool();
  const binArrays = await dlmmPool.getBinArrayForSwap(swapYtoX);
  
  const swapQuote = await dlmmPool.swapQuote(
    new BN(amount * 10**6), // 假设代币精度为6
    swapYtoX,
    new BN(1), // 最小输出量容忍度
    binArrays
  );

  const tx = await dlmmPool.swap({
    inToken,
    binArraysPubkey: swapQuote.binArraysPubkey,
    inAmount: new BN(amount * 10**6),
    lbPair: dlmmPool.pubkey,
    user: new PublicKey(USER_PUBKEY),
    minOutAmount: swapQuote.minOutAmount,
    outToken
  });

  return await signAndSendTransaction(tx);
}

async function addLiquidity(positionPubKey: PublicKey, xAmount: number, yAmount: number): Promise<string> {
  const dlmmPool = await initDLMMPool();
  const activeBin = await dlmmPool.getActiveBin();
  
  const tx = await dlmmPool.addLiquidityByStrategy({
    positionPubKey,
    user: new PublicKey(USER_PUBKEY),
    totalXAmount: new BN(xAmount * 10**6), // 假设USDC精度为6
    totalYAmount: new BN(yAmount * 10**6), // 假设USDT精度为6
    strategy: {
      maxBinId: activeBin.binId + 10,
      minBinId: activeBin.binId - 10,
      strategyType: StrategyType.Spot
    }
  });

  return await signAndSendTransaction(tx);
}

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

import readline from 'readline';

async function mainMenu() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  while (true) {
    console.log('\n=== Meteora Privy 交互菜单 ===');
    console.log('1. 创建仓位');
    console.log('2. 列出我的仓位');
    console.log('3. 添加流动性');
    console.log('4. 移除流动性');
    console.log('5. 代币交换');
    console.log('6. 领取手续费');
    console.log('7. 关闭仓位');
    console.log('8. 查询活跃bin');
    console.log('9. 查询池状态');
    console.log('10. 查询bin价格详情');
    console.log('0. 退出');

    const choice = await new Promise<string>(resolve => {
      rl.question('\n请选择操作: ', resolve);
    });

    try {
      switch (choice) {
        case '1':
          await createPosition();
          break;
        case '2':
          await listPositions();
          break;
        case '3': {
          const positions = await listPositions();
          if (positions.length === 0) {
            console.log('没有找到仓位，请先创建仓位');
            break;
          }
          const posChoice = await new Promise<string>(resolve => {
            rl.question('选择要添加流动性的仓位编号: ', resolve);
          });
          const xAmount = await new Promise<string>(resolve => {
            rl.question('输入要添加的X代币数量(USDC): ', resolve);
          });
          const yAmount = await new Promise<string>(resolve => {
            rl.question('输入要添加的Y代币数量(USDT): ', resolve);
          });
          const txHash = await addLiquidity(
            positions[parseInt(posChoice)-1].publicKey,
            parseFloat(xAmount),
            parseFloat(yAmount)
          );
          console.log(`流动性添加成功，交易哈希: ${txHash}`);
          break;
        }
        case '4': {
          const positions = await listPositions();
          if (positions.length === 0) {
            console.log('没有找到仓位');
            break;
          }
          const posChoice = await new Promise<string>(resolve => {
            rl.question('选择要移除流动性的仓位编号: ', resolve);
          });
          const bps = await new Promise<string>(resolve => {
            rl.question('输入要移除的流动性百分比(1-100): ', resolve);
          });
          const txHashes = await removeLiquidity(
            positions[parseInt(posChoice)-1].publicKey,
            parseFloat(bps) * 100
          );
          console.log(`流动性移除成功，交易哈希: ${txHashes.join(', ')}`);
          break;
        }
        case '5': {
          const xAmount = await new Promise<string>(resolve => {
            rl.question('输入要交换的USDC数量: ', resolve);
          });
          const txHash = await swapTokens(
            (await initDLMMPool()).tokenX.publicKey,
            (await initDLMMPool()).tokenY.publicKey,
            parseFloat(xAmount)
          );
          console.log(`代币交换成功，交易哈希: ${txHash}`);
          break;
        }
        case '6': {
          const positions = await listPositions();
          if (positions.length === 0) {
            console.log('没有找到仓位');
            break;
          }
          const txHashes = await claimFees(positions.map(p => p.publicKey));
          console.log(`手续费领取成功，交易哈希: ${txHashes.join(', ')}`);
          break;
        }
        case '7': {
          const positions = await listPositions();
          if (positions.length === 0) {
            console.log('没有找到仓位');
            break;
          }
          const posChoice = await new Promise<string>(resolve => {
            rl.question('选择要关闭的仓位编号: ', resolve);
          });
          const txHash = await closePosition(
            positions[parseInt(posChoice)-1].publicKey
          );
          console.log(`仓位关闭成功，交易哈希: ${txHash}`);
          break;
        }
        case '8': {
          const activeBin = await getActiveBin();
          console.log('当前活跃bin信息:', activeBin);
          break;
        }
        case '8': {
          const poolStatus = await showPoolTokenStatus();
          console.log('池状态信息:', poolStatus);
          break;
        }
        case '9': {
          const poolStatus = await showPoolTokenStatus();
          console.log('池状态信息:', poolStatus);
          break;
        }
        case '10': {
          const binDetails = await showBinPriceDetails();
          console.log('bin价格详情:', binDetails);
          break;
        }
        case '0':
          rl.close();
          return;
        default:
          console.log('无效选择');
      }
    } catch (error) {
      console.error('操作失败:', error instanceof Error ? error.message : error);
    }
  }
}

mainMenu().catch(console.error);
