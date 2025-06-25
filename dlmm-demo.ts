// 导入DLMM库和相关Solana Web3.js模块
import DLMM, { autoFillYByStrategy, StrategyType } from '@meteora-ag/dlmm';
// 导入Solana连接和交易相关模块
import { Connection, PublicKey, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
// 导入大数处理库
import BN from 'bn.js';
// 导入文件系统模块
import fs from 'fs';
// 导入路径处理模块
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
// 导入命令行交互模块
import readline from 'readline';

// 配置部分开始
// RPC节点地址(开发网)
const RPC_ENDPOINT = 'https://api.devnet.solana.com';
// USDC-USDT流动性池地址
const USDC_USDT_POOL = new PublicKey('NPLipchco8sZA4jSR47dVafy77PdbpBCfqPf8Ksvsvj');
// 钱包密钥文件路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WALLET_PATH = path.join(__dirname, 'devnet-keypair.json');

// 初始化Solana连接
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

// 辅助函数：从文件加载钱包密钥对
function loadWalletKeypair(filePath: string): Keypair {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const keypairData = JSON.parse(fileContent);
  return Keypair.fromSecretKey(Uint8Array.from(keypairData));
}

// 检查SOL余额
async function checkSolBalance(user: Keypair): Promise<number> {
  const balance = await connection.getBalance(user.publicKey);
  console.log(`Wallet balance: ${balance / 10 ** 9} SOL`);
  return balance;
}

// 初始化DLMM池
async function initDLMM(): Promise<DLMM> {
  const dlmmPool = await DLMM.create(connection, USDC_USDT_POOL);
  console.log('DLMM Pool initialized');
  return dlmmPool;
}

// 主菜单函数
async function showMainMenu(dlmmPool: DLMM, user: Keypair) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  while (true) {
    console.log('\n=== DLMM SDK Demo ===');
    console.log('1. Create balance position');
    console.log('2. Create imbalance position');
    console.log('3. Create one-side position');
    console.log('4. List my positions');
    console.log('5. Remove liquidity from position');
    console.log('6. Add liquidity to position');
    console.log('7. Swap tokens');
    console.log('8. Claim fees');
    console.log('9. Get active bin');
    console.log('10. Show pool token status');
    console.log('11. Show bin price details');
    console.log('0. Exit');

    const choice = await new Promise<string>((resolve) => {
      rl.question('\nSelect an option: ', resolve);
    });

    switch (choice) {
      case '1':
        await createBalancePosition(dlmmPool, user);
        break;
      case '2':
        await createImbalancePosition(dlmmPool, user);
        break;
      case '3':
        await createOneSidePosition(dlmmPool, user);
        break;
      case '4':
        await listPositions(dlmmPool, user);
        break;
      case '5':
        await removeLiquidity(dlmmPool, user);
        break;
      case '6':
        await addLiquidity(dlmmPool, user);
        break;
      case '7':
        await swapTokens(dlmmPool, user);
        break;
      case '8':
        await claimFees(dlmmPool, user);
        break;
      case '9':
        await getActiveBin(dlmmPool);
        break;
      case '10':
        await showPoolTokenStatus(dlmmPool);
        break;
      case '11':
        await showBinPriceDetails(dlmmPool);
        break;
      case '0':
        rl.close();
        return;
      default:
        console.log('Invalid option');
    }
  }
}

// 创建平衡仓位函数
async function createBalancePosition(dlmmPool: DLMM, user: Keypair) {
  try {
    // 获取当前活跃的bin
    const activeBin = await dlmmPool.getActiveBin();
    // 设置仓位范围(上下各10个bin)
    const TOTAL_RANGE_INTERVAL = 10;
    const minBinId = activeBin.binId - TOTAL_RANGE_INTERVAL;
    const maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL;
    
    // 设置USDC数量(100个)
    const totalXAmount = new BN(100 * 10 ** 6); // 100 USDC
    // 自动计算需要的USDT数量
    const totalYAmount = autoFillYByStrategy(
      activeBin.binId,
      dlmmPool.lbPair.binStep,
      totalXAmount,
      activeBin.xAmount,
      activeBin.yAmount,
      minBinId,
      maxBinId,
      StrategyType.Spot
    );
    
    // 直接使用用户钱包地址作为仓位地址
    const tx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: user.publicKey,  // 使用用户钱包地址
      user: user.publicKey,
      totalXAmount,
      totalYAmount,
      strategy: { maxBinId, minBinId, strategyType: StrategyType.Spot },
    });
    // 仅使用用户钱包签名
    tx.sign(user);
    
    // Serialize transaction to base64
    const serializedTx = tx.serialize();
    const base64Tx = serializedTx.toString('base64');
    console.log('base64Tx:', base64Tx);
    
    // // Format API call
    // const apiCall = {
    //   method: "POST",
    //   url: `https://api.privy.io/v1/wallets/${user.publicKey.toString()}/rpc`,
    //   headers: {
    //     'Authorization': `Basic ${process.env.PRIVY_AUTH}`,
    //     'Content-Type': 'application/json',
    //     'privy-app-id': process.env.PRIVY_APP_ID
    //   },
    //   data: {
    //     method: "signTransaction",
    //     params: {
    //       transaction: base64Tx,
    //       encoding: "base64"
    //     }
    //   }
    // };

    // console.log('API call for signing transaction:');
    // console.log(JSON.stringify(apiCall, null, 2));
    // return apiCall;
  } catch (error) {
    console.error('Error creating position:', error);
  }
}

// 创建不平衡仓位函数
async function createImbalancePosition(dlmmPool: DLMM, user: Keypair) {
  try {
    const activeBin = await dlmmPool.getActiveBin();
    const TOTAL_RANGE_INTERVAL = 10;
    const minBinId = activeBin.binId - TOTAL_RANGE_INTERVAL;
    const maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL;
    
    // 设置不平衡的USDC和USDT数量
    const totalXAmount = new BN(100 * 10 ** 6); // 100 USDC
    const totalYAmount = new BN(50 * 10 ** 6); // 50 USDT
    
    const newPosition = Keypair.generate();
    const tx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: newPosition.publicKey,
      user: user.publicKey,
      totalXAmount,
      totalYAmount,
      strategy: { maxBinId, minBinId, strategyType: StrategyType.Spot },
    });
    
    const txHash = await sendAndConfirmTransaction(connection, tx, [user, newPosition]);
    console.log('Imbalance position created!');
    console.log('Tx:', txHash);
    console.log('Position:', newPosition.publicKey.toString());
  } catch (error) {
    console.error('Error creating position:', error);
  }
}

// 创建单边仓位函数
async function createOneSidePosition(dlmmPool: DLMM, user: Keypair) {
  try {
    const activeBin = await dlmmPool.getActiveBin();
    // 设置更大的范围(20个bin)
    const TOTAL_RANGE_INTERVAL = 20;
    const minBinId = activeBin.binId;
    const maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL;
    
    // 只提供USDC(单边)
    const totalXAmount = new BN(100 * 10 ** 6); // 100 USDC
    const totalYAmount = new BN(0); // One-sided
    
    const newPosition = Keypair.generate();
    const tx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: newPosition.publicKey,
      user: user.publicKey,
      totalXAmount,
      totalYAmount,
      strategy: { maxBinId, minBinId, strategyType: StrategyType.Spot },
    });
    
    const txHash = await sendAndConfirmTransaction(connection, tx, [user, newPosition]);
    console.log('One-side position created!');
    console.log('Tx:', txHash);
    console.log('Position:', newPosition.publicKey.toString());
  } catch (error) {
    console.error('Error creating position:', error);
  }
}

// 仓位管理函数
// 列出用户仓位
async function listPositions(dlmmPool: DLMM, user: Keypair) {
  try {
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(user.publicKey);
    console.log('\nYour positions:');
    userPositions.forEach((pos, i) => {
      console.log(`${i + 1}. ${pos.publicKey.toString()}`);
    });
  } catch (error) {
    console.error('Error listing positions:', error);
  }
}

// 移除流动性
async function removeLiquidity(dlmmPool: DLMM, user: Keypair) {
  try {
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(user.publicKey);
    if (userPositions.length === 0) {
      console.log('No positions found');
      return;
    }

    console.log('\nSelect position to remove:');
    userPositions.forEach((pos, i) => {
      console.log(`${i + 1}. ${pos.publicKey.toString()}`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const choice = await new Promise<number>((resolve) => {
      rl.question('\nEnter position number: ', (answer) => {
        rl.close();
        resolve(parseInt(answer) - 1);
      });
    });

    if (isNaN(choice)) throw new Error('Invalid choice');

    const position = userPositions[choice];
    const binIds = position.positionData.positionBinData.map(bin => bin.binId);
    
    // 创建移除流动性交易(100%)
    const tx = await dlmmPool.removeLiquidity({
      position: position.publicKey,
      user: user.publicKey,
      fromBinId: binIds[0],
      toBinId: binIds[binIds.length - 1],
      bps: new BN(100 * 100), // 100%
      shouldClaimAndClose: true
    });

    const txs = Array.isArray(tx) ? tx : [tx];
    for (const singleTx of txs) {
      const txHash = await sendAndConfirmTransaction(connection, singleTx, [user]);
      console.log('Tx:', txHash);
    }
    console.log('Liquidity removed!');
  } catch (error) {
    console.error('Error removing liquidity:', error);
  }
}

// 添加流动性
async function addLiquidity(dlmmPool: DLMM, user: Keypair) {
  try {
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(user.publicKey);
    if (userPositions.length === 0) {
      console.log('No positions found');
      return;
    }

    console.log('\nSelect position to add liquidity:');
    userPositions.forEach((pos, i) => {
      console.log(`${i + 1}. ${pos.publicKey.toString()}`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const choice = await new Promise<number>((resolve) => {
      rl.question('\nEnter position number: ', (answer) => {
        rl.close();
        resolve(parseInt(answer) - 1);
      });
    });

    if (isNaN(choice)) throw new Error('Invalid choice');

    const position = userPositions[choice];
    const activeBin = await dlmmPool.getActiveBin();
    
    // 添加50 USDC流动性
    const totalXAmount = new BN(50 * 10 ** 6); // 50 USDC
    // 自动计算需要的USDT数量
    const totalYAmount = autoFillYByStrategy(
      activeBin.binId,
      dlmmPool.lbPair.binStep,
      totalXAmount,
      activeBin.xAmount,
      activeBin.yAmount,
      position.positionData.lowerBinId,
      position.positionData.upperBinId,
      StrategyType.Spot
    );

    // 创建添加流动性交易
    const tx = await dlmmPool.addLiquidityByStrategy({
      positionPubKey: position.publicKey,
      user: user.publicKey,
      totalXAmount,
      totalYAmount,
      strategy: {
        maxBinId: position.positionData.upperBinId,
        minBinId: position.positionData.lowerBinId,
        strategyType: StrategyType.Spot
      },
    });

    // 获取代币精度
    const tokenXInfo = await connection.getTokenSupply(dlmmPool.tokenX.publicKey);
    const tokenYInfo = await connection.getTokenSupply(dlmmPool.tokenY.publicKey);
    const xDecimals = tokenXInfo.value.decimals;
    const yDecimals = tokenYInfo.value.decimals;

    const txHash = await sendAndConfirmTransaction(connection, tx, [user]);
    console.log('\nLiquidity added successfully!');
    console.log('Transaction:', txHash);
    console.log(`Added X tokens: ${Number(totalXAmount.toString()) / (10 ** xDecimals)}`);
    console.log(`Added Y tokens: ${Number(totalYAmount.toString()) / (10 ** yDecimals)}`);
  } catch (error) {
    console.error('Error adding liquidity:', error);
  }
}

// 代币交换函数
async function swapTokens(dlmmPool: DLMM, user: Keypair) {
  try {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // 获取用户输入的交换数量
    const amount = await new Promise<string>((resolve) => {
      rl.question('\nEnter amount to swap (in USDC): ', resolve);
    });

    const swapAmount = new BN(parseFloat(amount) * 10 ** 6);
    const swapYtoX = false; // Swap X to Y (USDC to USDT)
    // 获取交换所需的bin数组
    const binArrays = await dlmmPool.getBinArrayForSwap(swapYtoX);

    // 获取交换报价
    const swapQuote = await dlmmPool.swapQuote(
      swapAmount,
      swapYtoX,
      new BN(1),
      binArrays
    );

    // 创建交换交易
    const tx = await dlmmPool.swap({
      inToken: dlmmPool.tokenX.publicKey,
      binArraysPubkey: swapQuote.binArraysPubkey,
      inAmount: swapAmount,
      lbPair: dlmmPool.pubkey,
      user: user.publicKey,
      minOutAmount: swapQuote.minOutAmount,
      outToken: dlmmPool.tokenY.publicKey,
    });

    const txHash = await sendAndConfirmTransaction(connection, tx, [user]);
    console.log('Swap executed!');
    console.log('Tx:', txHash);
    console.log('Expected output:', swapQuote.minOutAmount.toString());
  } catch (error) {
    console.error('Error swapping tokens:', error);
  }
}

// 获取活跃bin函数
async function getActiveBin(dlmmPool: DLMM) {
  try {
    const activeBin = await dlmmPool.getActiveBin();
    console.log('\nActive Bin Info:');
    console.log('Bin ID:', activeBin.binId);
    console.log('X Amount:', activeBin.xAmount.toString());
    console.log('Y Amount:', activeBin.yAmount.toString());
    console.log('Price:', activeBin.price.toString());
  } catch (error) {
    console.error('Error getting active bin:', error);
  }
}

// 显示池子代币状态
async function showPoolTokenStatus(dlmmPool: DLMM) {
  try {
    console.log('\nPool Token Status:');
    console.log('Base Token (X):');
    console.log('  Address:', dlmmPool.tokenX.publicKey.toString());
    console.log('Quote Token (Y):');
    console.log('  Address:', dlmmPool.tokenY.publicKey.toString());
    console.log('Bin Step:', dlmmPool.lbPair.binStep / 100, '%');
    
    // 获取代币元数据
    const tokenXInfo = await connection.getTokenSupply(dlmmPool.tokenX.publicKey);
    const tokenYInfo = await connection.getTokenSupply(dlmmPool.tokenY.publicKey);
    console.log('Base Token Decimals:', tokenXInfo.value.decimals);
    console.log('Quote Token Decimals:', tokenYInfo.value.decimals);
  } catch (error) {
    console.error('Error getting pool status:', error);
  }
}

// 显示bin价格详情
async function showBinPriceDetails(dlmmPool: DLMM) {
  try {
    const activeBin = await dlmmPool.getActiveBin();
    const binStep = dlmmPool.lbPair.binStep / 10000; // 转换为小数
    
    console.log('\nBin Price Details:');
    console.log('Current Bin ID:', activeBin.binId);
    console.log('Bin Step:', binStep * 100, '%');
    console.log('Current Price:', activeBin.price.toString());
    console.log('Price Formula: (1 + binStep)^binId');
    console.log('Calculation Example:');
    console.log(`  (1 + ${binStep})^${activeBin.binId} ≈ ${activeBin.price}`);
    
    // 显示相邻bin价格
    const prevPrice = Math.pow(1 + binStep, activeBin.binId - 1);
    const nextPrice = Math.pow(1 + binStep, activeBin.binId + 1);
    console.log('\nNeighbor Bins:');
    console.log(`Bin ${activeBin.binId - 1} Price: ${prevPrice}`);
    console.log(`Bin ${activeBin.binId + 1} Price: ${nextPrice}`);
  } catch (error) {
    console.error('Error getting bin details:', error);
  }
}

// 领取手续费函数
async function claimFees(dlmmPool: DLMM, user: Keypair) {
  try {
    const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(user.publicKey);
    if (userPositions.length === 0) {
      console.log('No positions found');
      return;
    }

    // 显示手续费信息
    console.log('\nChecking positions for claimable fees:');
    let hasClaimableFees = false;
    
    // 检查是否有可领取的手续费
    for (const position of userPositions) {
      try {
        // 尝试创建领取交易来检测是否有手续费
        await dlmmPool.claimAllSwapFee({
          owner: user.publicKey,
          positions: [position],
        });
        hasClaimableFees = true;
        console.log(`- ${position.publicKey.toString()} has fees to claim`);
      } catch (error) {
        console.log(`- ${position.publicKey.toString()} no fees to claim`);
      }
    }

    if (!hasClaimableFees) {
      console.log('\nNo fees available to claim on any positions');
      return;
    }

    // 获取代币精度
    const tokenXInfo = await connection.getTokenSupply(dlmmPool.tokenX.publicKey);
    const tokenYInfo = await connection.getTokenSupply(dlmmPool.tokenY.publicKey);
    const xDecimals = tokenXInfo.value.decimals;
    const yDecimals = tokenYInfo.value.decimals;

    // 创建领取所有手续费交易
    const txs = await dlmmPool.claimAllSwapFee({
      owner: user.publicKey,
      positions: userPositions,
    });

    // 执行交易并显示结果
    for (const tx of txs) {
      try {
        const txHash = await sendAndConfirmTransaction(connection, tx, [user]);
        console.log('\nFees claimed successfully!');
        console.log('Transaction:', txHash);
        
        // 获取交易详情来显示实际领取数量
        const txDetails = await connection.getTransaction(txHash, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        });
        
        if (txDetails?.meta?.postTokenBalances) {
          const balances = txDetails.meta.postTokenBalances;
          for (const balance of balances) {
            if (balance.owner === user.publicKey.toString()) {
              const tokenAmount = balance.uiTokenAmount.uiAmount;
              const tokenMint = balance.mint;
              if (tokenMint === dlmmPool.tokenX.publicKey.toString()) {
                console.log(`Received X tokens: ${tokenAmount}`);
              } else if (tokenMint === dlmmPool.tokenY.publicKey.toString()) {
                console.log(`Received Y tokens: ${tokenAmount}`);
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof Error) {
          console.error('Error executing fee claim transaction:', error.message);
        } else {
          console.error('Error executing fee claim transaction:', String(error));
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('No fee to claim')) {
      console.log('\nNo fees available to claim on any positions');
    } else if (error instanceof Error) {
      console.error('\nError checking claimable fees:', error.message);
    } else {
      console.error('\nError checking claimable fees:', String(error));
    }
  }
}

// 主函数
async function main() {
  try {
    // 加载钱包
    const user = loadWalletKeypair(WALLET_PATH);
    console.log('User wallet:', user.publicKey.toString());

    // 检查SOL余额
    const balance = await checkSolBalance(user);
    if (balance < 0.01 * 10 ** 9) {
      throw new Error('Insufficient SOL for transactions');
    }

    // 初始化DLMM池
    const dlmmPool = await initDLMM();
    // 显示主菜单
    await showMainMenu(dlmmPool, user);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main().catch(console.error);
