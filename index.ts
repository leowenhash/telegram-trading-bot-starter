import * as dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { PrivyClient } from '@privy-io/server-auth';
import { PublicKey, VersionedTransaction, TransactionMessage, SystemProgram, LAMPORTS_PER_SOL, Keypair, Cluster, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import { getAllUserWallets, saveUserWallet } from './mockDb';
import { getJupiterUltraOrder, executeJupiterUltraOrder, getJupiterUltraBalances, SOL_MINT } from './jupiter';
import SolanaService from './solana';
import MeteoraService from './meteora';
import { BN } from 'bn.js';

// Initialize services
const solana = new SolanaService();
// MeteoraService will be initialized with user-provided pool address when needed

const app = express();
const port = process.env.PORT || 3003;

// Initialize Privy client
const privy = new PrivyClient(process.env.PRIVY_APP_ID as string, process.env.PRIVY_APP_SECRET as string, {
  walletApi: {
    authorizationPrivateKey: process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY as string
  }
});

// Initialize Telegram bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN as string, { polling: true });

// Middleware to parse JSON
app.use(express.json());

// Basic route to verify server is running
app.get('/', (req, res) => {
  res.send('Telegram Bot Server is running!');
});

/**
 * MOCK DATABASE IMPLEMENTATION
 * 
 * This starter repo uses a simple JSON file to mock a database for simplicity.
 * In a production environment, you should replace this with a proper database.
 * 
 * Options for production:
 * - MongoDB
 * - PostgreSQL
 * - Redis
 * - etc.
 * 
 * The wallet mappings are stored in a JSON file that maps Telegram user IDs to Privy wallet IDs.
 * This is a simple implementation for demonstration purposes only.
 */

/**
 * Handles the /start command to create or retrieve a user's wallet
 * This command:
 * 1. Checks if user already has a wallet
 * 2. Creates a new wallet if needed
 * 3. Saves the user-wallet relationship to our mock database
 * 4. Returns the wallet address to the user
 * 
 * @param {Object} msg - Telegram message object
 * @param {Object} msg.from - User information
 * @param {number} msg.from.id - Unique Telegram user ID
 * @param {Object} msg.chat - Chat information
 * @param {number} msg.chat.id - Chat ID to send responses to
 */
bot.onText(/\/start/, async (msg: TelegramBot.Message) => {
  if (!msg.from) {
    return;
  }
  const userId = msg.from.id;
  let walletId = '';
  let walletAddress = '';
  
  console.log(`Processing /start command for user ${userId}`);
  
  // Load existing user-wallet relationships from our mock database
  // In production, you would query your actual database here
  const userWallets = getAllUserWallets();
  
  if (userWallets[userId]) {
    console.log(`User ${userId} already has a wallet. Using existing wallet.`);
    walletId = userWallets[userId];
  } else {
    console.log(`User ${userId} does not have a wallet. Creating new wallet.`);
    try {
      // Create a new Solana wallet using Privy's API
      const {id, address, chainType} = await privy.walletApi.createWallet({chainType: 'solana'});
      walletId = id;
      walletAddress = address;
      
      // Save the new user-wallet relationship to our mock database
      // In production, you would insert this into your actual database
      saveUserWallet(userId, walletId);
      
      console.log(`Successfully created wallet for user ${userId}: ${walletAddress}`);
    } catch (error: unknown) {
      console.error('Error fetching wallet for user ${userId}:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      bot.sendMessage(
        msg.chat.id,
        `❌ Sorry, there was an error accessing your wallet: ${errorMessage}. Please try again later.\n\n` +
        'If this error persists, please contact support.'
      );
    }
  }
  
  try {
    // If we don't have the wallet address yet, fetch it
    if (!walletAddress) {
      const wallet = await privy.walletApi.getWallet({id: walletId});
      walletAddress = wallet.address;
    }
    
    // Send welcome message with wallet address
    bot.sendMessage(
      msg.chat.id,
      `👋 Welcome to the Solana Trading Bot!\n\n` +
      `Your wallet address is: ${walletAddress}\n\n` +
      `📌 Position Management Commands:\n` +
      `/createposition <type> <pool> <amount> - Create new position (balance/imbalance/one-side)\n` +
      `/listpositions <pool> - List positions in a pool\n` +
      `/closeposition <pool> - Close a position (will show list to select)\n\n` +
      `💱 Trading Commands:\n` +
      `/swap <token_address> <amount> - Swap SOL for token\n` +
      `/getwallet - View all token balances\n` +
      `/balance - View SOL balance\n` +
      `/transactions - View recent transactions\n` +
      `/transfer <address> <amount> - Transfer SOL\n` +
      `/transfertoken <address> <token> <amount> - Transfer tokens\n\n` +
      `Example:\n` +
      `/createposition balance NPLipchco8sZA4jSR47dVafy77PdbpBCfqPf8Ksvsvj 100\n` +
      `/swap EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 0.1`
    );
    } catch (error: unknown) {
      console.error(`Error fetching wallet for user ${userId}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      bot.sendMessage(
        msg.chat.id,
        `❌ Sorry, there was an error accessing your wallet: ${errorMessage}. Please try again later.\n\n` +
        'If this error persists, please contact support.'
      );
    }
});

/**
 * Handles the /getwallet command to display a user's wallet address and balances
 * This command:
 * 1. Retrieves the user's wallet from our mock database
 * 2. Fetches current token balances
 * 3. Formats and displays the information
 * 
 * @param {Object} msg - Telegram message object
 */
bot.onText(/\/getwallet/, async (msg: TelegramBot.Message) => {
  if (!msg.from) {
    return;
  }
  const userId = msg.from.id;
  console.log(`Processing /getwallet command for user ${userId}`);
  
  // Load user-wallet relationships from our mock database
  // In production, you would query your actual database here
  const userWallets = getAllUserWallets();
  
  if (!userWallets[userId]) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ You don\'t have a wallet yet. Use /start to create one.'
    );
  }

  try {
    // Get the user's wallet
    const walletId = userWallets[userId];
    const wallet = await privy.walletApi.getWallet({id: walletId});
    const walletAddress = wallet.address;
    
    console.log(`Fetching balances for wallet ${walletAddress}`);
    
    // Get all token balances
    const balances = await solana.getAllTokenBalances(walletAddress);
    
    // Format the balance message
    let balanceMessage = `💰 Wallet Balance:\n\n`;
    let hasBalance = false;
    
    for (const [token, balance] of Object.entries(balances)) {
      if (balance.amount !== "0") {
        hasBalance = true;
        const tokenDisplay = token === 'SOL' ? 'SOL' : 
                          balance.symbol || `${token.slice(0, 4)}...${token.slice(-4)}`;
        const formattedAmount = balance.uiAmount.toFixed(4) + 
                              (token === 'SOL' ? ' SOL' : '');
        balanceMessage += `${tokenDisplay}: ${formattedAmount}\n`;
      }
    }
    
    if (!hasBalance) {
      balanceMessage += "No tokens found in wallet\n";
    }
    
    // Send the wallet information to the user
    bot.sendMessage(
      msg.chat.id,
      `Your wallet address is: ${walletAddress}\n\n` +
      balanceMessage +
      `\nUse /swap <token_address> <amount> to swap SOL for another token`
    );
    } catch (error: unknown) {
      console.error(`Error fetching wallet for user ${userId}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      bot.sendMessage(
        msg.chat.id,
        `❌ Sorry, there was an error accessing your wallet: ${errorMessage}. Please try again later.\n\n` +
        'If this error persists, please contact support.'
      );
    }
});

/**
 * Handles the /swap command to swap SOL for another token
 * This command:
 * 1. Validates the input parameters
 * 2. Checks user's SOL balance
 * 3. Creates and executes the swap
 * 4. Returns transaction details
 * 
 * @param {Object} msg - Telegram message object
 * @param {Array} match - Regex match groups
 */
bot.onText(/\/swap (.+) (.+)/, async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
  if (!msg.from || !match) {
    return;
  }
  const userId = msg.from.id;
  const tokenMint = match[1]; // First capture group is token address
  const amount = parseFloat(match[2]); // Second capture group is amount

  console.log(`Processing /swap command for user ${userId}: ${amount} SOL for token ${tokenMint}`);

  // Load user-wallet relationships from our mock database
  // In production, you would query your actual database here
  const userWallets = getAllUserWallets();

  if (!userWallets[userId]) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ Please use /start first to create a wallet.'
    );
  }

  // Validate token address
  try {
    new PublicKey(tokenMint);
  } catch (error) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ Invalid token address. Please enter a valid Solana token address.\n\n' +
      'Example:\n' +
      '/swap EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 0.1'
    );
  }

  // Validate amount
  if (isNaN(amount) || amount <= 0) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ Please enter a valid amount of SOL (e.g., 0.1, 0.5, 1.0)\n\n' +
      'Example:\n' +
      '/swap EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 0.1'
    );
  }

  try {
    // Get user's wallet
    const walletId = userWallets[userId];
    const wallet = await privy.walletApi.getWallet({id: walletId});
    const walletAddress = wallet.address;

    // Check SOL balance
    const balances = await getJupiterUltraBalances(walletAddress);
    const solBalance = balances.SOL?.uiAmount || 0;

    if (solBalance < amount) {
      return bot.sendMessage(
        msg.chat.id,
        `❌ Insufficient SOL balance.\n` +
        `You have ${solBalance.toFixed(4)} SOL but need ${amount} SOL for this swap.\n` +
        `Please try again with a smaller amount.`
      );
    }

    // Create the swap order
    const lamports = Math.floor(amount * 1e9); // Convert SOL to lamports
    console.log(`Creating swap order for ${amount} SOL to token ${tokenMint}`);
    
    const order = await getJupiterUltraOrder({
      inputMint: SOL_MINT,
      outputMint: tokenMint,
      amount: lamports.toString(),
      taker: walletAddress
    });

    // Sign the transaction
    console.log('Signing transaction...');
    const transactionBuffer = Buffer.from(order.transaction, 'base64');
    const transaction = VersionedTransaction.deserialize(Buffer.from(transactionBuffer));
    const {signedTransaction} = await privy.walletApi.solana.signTransaction({
      walletId,
      transaction: transaction
    });

    bot.sendMessage(msg.chat.id, '🔄 Transaction signed. Processing swap...');

    // Execute the swap
    console.log('Executing swap...');
    const executeResult = await executeJupiterUltraOrder(
      Buffer.from(signedTransaction.serialize()).toString('base64'),
      order.requestId
    );

    console.log(`Swap successful! Transaction: ${executeResult.signature}`);

    // Send success message
    bot.sendMessage(
      msg.chat.id,
      `✅ Swap successful!\n\n` +
      `Transaction: https://solscan.io/tx/${executeResult.signature}\n` +
      `You swapped ${amount} SOL for approximately ${order.outAmount / 1e9} tokens\n\n` +
      `Use /getwallet to check your new balance`
    );

    } catch (error: unknown) {
      console.error('Error in buy flow:', error);
      
      // Handle specific error cases
      if (error instanceof Error && error.message.includes('0x1771')) {
      bot.sendMessage(
        msg.chat.id,
        '❌ Swap failed due to price movement. Please try again with a smaller amount or wait a moment.'
      );
    } else if (typeof error === 'object' && error !== null && 'response' in error && 
               typeof error.response === 'object' && error.response !== null &&
               'data' in error.response && typeof error.response.data === 'object' &&
               error.response.data !== null && 'error' in error.response.data) {
      bot.sendMessage(
        msg.chat.id,
        `❌ Error: ${error.response.data.error}\n\n` +
        'Please try again with /swap <token_address> <amount>'
      );
    } else {
      bot.sendMessage(
        msg.chat.id,
        '❌ Sorry, there was an error processing your swap. Please try again later.\n\n' +
        'If this error persists, please contact support.'
      );
    }
  }
});

/**
 * Handles the /swap command with no parameters
 * This command:
 * 1. Detects when a user sends just /swap without parameters
 * 2. Responds with instructions on how to use the command properly
 * 
 * @param {Object} msg - Telegram message object
 */
bot.onText(/^\/swap$/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '❌ Missing parameters. You must provide both token address and amount.\n\n' +
    'Correct usage:\n' +
    '/swap <token_address> <amount>\n\n' +
    'Example:\n' +
    '/swap EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 0.1'
  );
});

/**
 * Handles the /balance command to display a user's SOL balance
 * @param {Object} msg - Telegram message object
 */
bot.onText(/\/balance/, async (msg: TelegramBot.Message) => {
  if (!msg.from) {
    return;
  }
  const userId = msg.from.id;
  console.log(`Processing /balance command for user ${userId}`);
  
  const userWallets = getAllUserWallets();
  
  if (!userWallets[userId]) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ You don\'t have a wallet yet. Use /start to create one.'
    );
  }

  try {
    const walletId = userWallets[userId];
    const wallet = await privy.walletApi.getWallet({id: walletId});
    const balance = await solana.getBalance(wallet.address);
    
    bot.sendMessage(
      msg.chat.id,
      `💰 Your SOL balance: ${balance.toFixed(4)} SOL`
    );
    } catch (error: unknown) {
      console.error('Error getting balance:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      bot.sendMessage(
        msg.chat.id,
        `❌ Sorry, there was an error checking your balance: ${errorMessage}. Please try again later.`
      );
    }
});

/**
 * Handles the /transactions command to display a user's recent transactions
 * @param {Object} msg - Telegram message object
 */
bot.onText(/\/transactions/, async (msg: TelegramBot.Message) => {
  if (!msg.from) {
    return;
  }
  const userId = msg.from.id;
  console.log(`Processing /transactions command for user ${userId}`);
  
  const userWallets = getAllUserWallets();
  
  if (!userWallets[userId]) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ You don\'t have a wallet yet. Use /start to create one.'
    );
  }

  try {
    const walletId = userWallets[userId];
    const wallet = await privy.walletApi.getWallet({id: walletId});
    const transactions = await solana.getTransactions(wallet.address);
    
    let message = `📜 Recent transactions:\n\n`;
    transactions.forEach(tx => {
      const amount = tx.amount / LAMPORTS_PER_SOL;
      const formattedAmount = amount >= 0 ? 
        `+${amount.toFixed(4)}` : 
        `${amount.toFixed(4)}`;
      
      message += `⏰ ${tx.blockTime ? new Date(tx.blockTime * 1000).toLocaleString() : 'Pending'}\n`;
      message += `🆔 ${tx.signature}\n`;
      message += `💸 Amount: ${formattedAmount} SOL\n\n`;
    });

    bot.sendMessage(msg.chat.id, message);
    } catch (error: unknown) {
      console.error('Error getting transactions:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      bot.sendMessage(
        msg.chat.id,
        `❌ Sorry, there was an error fetching your transactions: ${errorMessage}. Please try again later.`
      );
    }
});

/**
 * Handles the /transfer command to transfer SOL to another address
 * @param {Object} msg - Telegram message object
 * @param {Array} match - Regex match groups
 */
/**
 * Handles the /transfertoken command to transfer tokens to another address
 * @param {Object} msg - Telegram message object
 * @param {Array} match - Regex match groups
 */
bot.onText(/\/transfertoken (.+) (.+) (.+)/, async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
  if (!msg.from || !match) {
    return;
  }
  const userId = msg.from.id;
  const toAddress = match[1];
  const tokenMint = match[2];
  const amount = parseFloat(match[3]);

  console.log(`Processing /transfertoken command for user ${userId}: ${amount} tokens (${tokenMint}) to ${toAddress}`);

  const userWallets = getAllUserWallets();
  
  if (!userWallets[userId]) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ Please use /start first to create a wallet.'
    );
  }

  // Validate parameters
  if (!toAddress || !tokenMint || !amount) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ Missing parameters. Usage: /transfertoken <address> <token_mint> <amount>\n' +
      'Example: /transfertoken Hq5eXj... AqeS6f... 15000'
    );
  }

  // Validate token mint
  try {
    new PublicKey(tokenMint);
    } catch (error: unknown) {
      console.error('Error getting transactions:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      bot.sendMessage(
        msg.chat.id,
        `❌ Sorry, there was an error fetching your transactions: ${errorMessage}. Please try again later.`
      );
    }

  // Validate amount
  if (isNaN(amount) || amount <= 0) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ Please enter a valid amount of tokens (must be greater than 0)'
    );
  }

  // Validate to address
  try {
    new PublicKey(toAddress);
  } catch (error) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ Invalid recipient address. Please enter a valid Solana address.'
    );
  }

  try {
    const walletId = userWallets[userId];
    const wallet = await privy.walletApi.getWallet({id: walletId});
    
    // Get token accounts
    const fromTokenAccount = await getAssociatedTokenAddress(
      new PublicKey(tokenMint),
      new PublicKey(wallet.address)
    );
    const toTokenAccount = await getAssociatedTokenAddress(
      new PublicKey(tokenMint),
      new PublicKey(toAddress)
    );

    // 获取代币小数位数
    const tokenInfo = await solana.connection.getParsedAccountInfo(new PublicKey(tokenMint));
    const decimals = tokenInfo?.value?.data && typeof tokenInfo.value.data === 'object' && 'parsed' in tokenInfo.value.data
      ? (tokenInfo.value.data as {parsed: {info: {decimals: number}}}).parsed.info.decimals
      : 9;
    const amountInLamports = Math.floor(amount * Math.pow(10, decimals));

    // Check token balance
    const tokenBalanceRaw = await solana.getTokenBalance(wallet.address, tokenMint);
    const tokenBalance = parseFloat(tokenBalanceRaw) / Math.pow(10, decimals);
    
    if (tokenBalance < amount) {
      return bot.sendMessage(
        msg.chat.id,
        `❌ Insufficient token balance.\n` +
        `You have ${tokenBalance} tokens but need ${amount} for this transfer.\n` +
        `Use /getwallet to check your balances.`
      );
    }

    // Create transfer instruction
    const transferInstruction = createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      new PublicKey(wallet.address),
      amountInLamports
    );

    // Create transaction message
    const messageV0 = new TransactionMessage({
      payerKey: new PublicKey(wallet.address),
      recentBlockhash: (await solana.connection.getRecentBlockhash()).blockhash,
      instructions: [transferInstruction]
    }).compileToV0Message();

    // Create versioned transaction
    const transaction = new VersionedTransaction(messageV0);

    // Sign transaction via Privy
    const { signedTransaction } = await privy.walletApi.solana.signTransaction({
      walletId,
      transaction
    });

    // Send token transfer
    const signature = await solana.transferToken(
      wallet.address,
      toAddress,
      tokenMint,
      amount,
      Buffer.from(signedTransaction.serialize())
    );
    
    bot.sendMessage(
      msg.chat.id,
      `✅ Token transfer successful!\n\n` +
      `Transaction: https://solscan.io/tx/${signature}\n` +
      `Sent ${amount} tokens (${tokenMint}) to ${toAddress}`
    );
    } catch (error: unknown) {
      console.error('Token transfer error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      bot.sendMessage(
        msg.chat.id,
        `❌ Sorry, there was an error processing your token transfer: ${errorMessage}. Please try again later.`
      );
    }
});

// Store user state for interactive commands
interface UserState {
  currentCommand?: string;
  params?: Record<string, unknown>;
}
const userState: Record<number, UserState> = {};

bot.onText(/\/createposition (.+) (.+) (.+)/, async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
  if (!msg.from || !match) {
    return;
  }
  const userId = msg.from.id;
  const positionType = match[1].toLowerCase();
  const poolAddress = match[2];
  const amount = parseFloat(match[3]);

  // Validate position type
  if (!['balance', 'imbalance', 'one-side'].includes(positionType)) {
    return bot.sendMessage(msg.chat.id, '❌ Invalid type, must be balance/imbalance/one-side');
  }

  // Validate pool address
  try {
    new PublicKey(poolAddress);
  } catch (error) {
    return bot.sendMessage(msg.chat.id, '❌ Invalid pool address');
  }

  // Validate amount
  if (isNaN(amount) || amount <= 0) {
    return bot.sendMessage(msg.chat.id, '❌ Invalid amount, must be number > 0');
  }

  // Get user wallet
  const userWallets = getAllUserWallets();
  if (!userWallets[userId]) {
    return bot.sendMessage(msg.chat.id, '❌ Please use /start to create a wallet first');
  }

    try {
      const walletId = userWallets[userId];
      const wallet = await privy.walletApi.getWallet({id: walletId});
      const walletAddress = wallet.address;

      if (!poolAddress) {
        return bot.sendMessage(msg.chat.id, '❌ Pool address is required');
      }
      
      const network = process.env.NETWORK as Cluster || 'devnet';
      const meteoraService = new MeteoraService(solana.connection, poolAddress, network);
      const amountInLamports = Math.floor(amount * 1e9);

      let signature: string;
      
      switch (positionType) {
        case 'balance':
          // Generate position keypair
          const positionKeypair = Keypair.generate();
          
          // Create position with keypair
          const {transaction: balanceTx, positionKeypair: balanceKeypair} = await meteoraService.createBalancePosition(
            walletAddress, 
            amountInLamports,
            positionKeypair
          );

          // Log transaction construction
          console.log('✅ Transaction constructed');

          const transaction = Array.isArray(balanceTx) ? balanceTx[0] : balanceTx;
          console.log('📦 Transaction type:', transaction.constructor.name);

          // Get latest blockhash
          const { blockhash } = await solana.connection.getLatestBlockhash('finalized');

          let finalTransaction;

          if (transaction instanceof VersionedTransaction) {
            // Handle VersionedTransaction
            const instructions = transaction.message.staticAccountKeys.map((_, idx) => {
              const ix = transaction.message.compiledInstructions[idx];
              return {
                programIdIndex: ix.programIdIndex,
                accountKeyIndexes: ix.accountKeyIndexes,
                data: ix.data
              };
            });

            const messageV0 = new TransactionMessage({
              payerKey: new PublicKey(walletAddress),
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
            finalTransaction.sign([balanceKeypair]);

          } else if (transaction instanceof Transaction) {
            // Handle legacy Transaction
            transaction.recentBlockhash = blockhash;
            transaction.feePayer ||= new PublicKey(walletAddress);
            transaction.partialSign(balanceKeypair);

            finalTransaction = transaction;

          } else if (typeof transaction === 'string') {
            throw new Error('Transaction already serialized to base64 by Meteora SDK');
          } else {
            throw new Error('Unknown transaction type');
          }

          // Sign with Privy
          const { signedTransaction } = await privy.walletApi.solana.signTransaction({
            walletId,
            transaction: finalTransaction
          });

          // Add position keypair signature
          const signedTx = VersionedTransaction.deserialize(signedTransaction.serialize());
          signedTx.sign([balanceKeypair]);

          // Send transaction
          signature = await solana.connection.sendRawTransaction(signedTx.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
          });

          console.log('🎉 Position created! Transaction:', signature);
          break;

        case 'imbalance':
          // 获取交易和仓位Keypair
          const {transaction: imbalanceTx, positionKeypair: imbalanceKeypair} = await meteoraService.createImbalancePosition(walletAddress, amountInLamports, amountInLamports/2);
          
          // 使用privy API签名交易
          const { signedTransaction: imbalanceSignedTx } = await privy.walletApi.solana.signTransaction({
            walletId,
            transaction: imbalanceTx
          });
          
          // 手动添加仓位Keypair的签名
          const signedImbalanceTx = VersionedTransaction.deserialize(imbalanceSignedTx.serialize());
          signedImbalanceTx.sign([imbalanceKeypair]);
          
          // 发送已签名的交易
          signature = await solana.connection.sendRawTransaction(signedImbalanceTx.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
          });
          break;

        case 'one-side':
          // 获取交易和仓位Keypair
          const {transaction: oneSideTx, positionKeypair: oneSideKeypair} = await meteoraService.createOneSidePosition(walletAddress, amountInLamports);
          
          // 使用privy API签名交易
          const { signedTransaction: oneSideSignedTx } = await privy.walletApi.solana.signTransaction({
            walletId,
            transaction: oneSideTx
          });
          
          // 手动添加仓位Keypair的签名
          const signedOneSideTx = VersionedTransaction.deserialize(oneSideSignedTx.serialize());
          signedOneSideTx.sign([oneSideKeypair]);
          
          // 发送已签名的交易
          signature = await solana.connection.sendRawTransaction(signedOneSideTx.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
          });
          break;

        default:
          throw new Error('Invalid position type');
      }
    
    bot.sendMessage(
      msg.chat.id,
      `✅ Position created successfully!\n\n` +
      `Type: ${positionType}\n` +
      `Amount: ${amount}\n` +
      `Pool: ${poolAddress}\n` +
      `Transaction: https://solscan.io/tx/${signature}`
    );
    } catch (error: unknown) {
      console.error('Create position error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      bot.sendMessage(
        msg.chat.id,
        `❌ Error creating position: ${errorMessage}`
      );
    }
});

// Help message for /createposition
bot.onText(/^\/createposition$/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '❌ Missing parameters. Usage:\n' +
    '/createposition <type> <pool> <amount>\n\n' +
    'Example:\n' +
    '/createposition balance NPLipchco8sZA4jSR47dVafy77PdbpBCfqPf8Ksvsvj 100\n\n' +
    'Available types: balance, imbalance, one-side'
  );
});

// List positions command
bot.onText(/\/listpositions (.+)/, async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
  if (!msg.from || !match) {
    return;
  }
  const userId = msg.from.id;
  const poolAddress = match[1];

  // Validate pool address
  try {
    new PublicKey(poolAddress);
  } catch (error) {
    return bot.sendMessage(msg.chat.id, '❌ Invalid pool address');
  }

  const userWallets = getAllUserWallets();
  if (!userWallets[userId]) {
    return bot.sendMessage(msg.chat.id, '❌ Please use /start to create a wallet first');
  }

  try {
    const walletId = userWallets[userId];
    const wallet = await privy.walletApi.getWallet({id: walletId});
    const network = process.env.NETWORK as Cluster || 'devnet';
    const meteoraService = new MeteoraService(solana.connection, poolAddress, network);

    const positions = await meteoraService.listPositions(wallet.address);
    
    if (positions.length === 0) {
      return bot.sendMessage(msg.chat.id, 'ℹ️ No positions found in this pool');
    }

    // console.log(positions)

    let message = '📊 Your Positions:\n\n';
    positions.forEach((pos, i) => {
      message += `📍 Position ${i + 1}: ${pos.publicKey.toString()}\n\n`;
      
      // Basic Info
      message += 'Basic Info:\n';
      message += '----------------\n';
      message += `Bin Range:    ${pos.positionData.lowerBinId}-${pos.positionData.upperBinId}\n`;
      message += `Last Updated: ${new Date(pos.positionData.lastUpdatedAt.toNumber() * 1000).toLocaleString()}\n`;
      message += `Owner:        ${pos.positionData.owner.toString().slice(0, 8)}...${pos.positionData.owner.toString().slice(-8)}\n\n`;
      
      // Amounts
      message += 'Amounts:\n';
      message += '----------------\n';
      message += `Total X: ${pos.positionData.totalXAmount.toString().padEnd(20)}`;
      message += `Excl. Fee X: ${pos.positionData.totalXAmountExcludeTransferFee.toString()}\n`;
      message += `Total Y: ${pos.positionData.totalYAmount.toString().padEnd(20)}`;
      message += `Excl. Fee Y: ${pos.positionData.totalYAmountExcludeTransferFee.toString()}\n\n`;
      
      // Fees & Rewards
      message += 'Fees & Rewards:\n';
      message += '----------------\n';
      message += `Fee X:      ${pos.positionData.feeX.toString().padEnd(15)}`;
      message += `Reward One: ${pos.positionData.rewardOne.toString()}\n`;
      message += `Fee Y:      ${pos.positionData.feeY.toString().padEnd(15)}`;
      message += `Reward Two: ${pos.positionData.rewardTwo.toString()}\n\n`;
    });

    bot.sendMessage(msg.chat.id, message);
  } catch (error: unknown) {
    console.error('List positions error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    bot.sendMessage(msg.chat.id, `❌ Error listing positions: ${errorMessage}`);
  }
});

// Help for listpositions
bot.onText(/^\/listpositions$/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '❌ Missing parameters. Usage:\n' +
    '/listpositions <pool_address>\n\n' +
    'Example:\n' +
    '/listpositions NPLipchco8sZA4jSR47dVafy77PdbpBCfqPf8Ksvsvj'
  );
});

bot.onText(/\/transfer (.+) (.+)/, async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
  if (!msg.from || !match) {
    return;
  }
  const userId = msg.from.id;
  const toAddress = match[1];
  const amount = parseFloat(match[2]);

  console.log(`Processing /transfer command for user ${userId}: ${amount} SOL to ${toAddress}`);

  const userWallets = getAllUserWallets();
  
  if (!userWallets[userId]) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ Please use /start first to create a wallet.'
    );
  }

  // Validate amount
  if (isNaN(amount) || amount <= 0) {
    return bot.sendMessage(
      msg.chat.id,
      '❌ Please enter a valid amount of SOL (e.g., 0.1, 0.5, 1.0)'
    );
  }

  try {
    const walletId = userWallets[userId];
    const wallet = await privy.walletApi.getWallet({id: walletId});
    
    // Create transfer instruction
    const transferInstruction = SystemProgram.transfer({
      fromPubkey: new PublicKey(wallet.address),
      toPubkey: new PublicKey(toAddress),
      lamports: amount * LAMPORTS_PER_SOL,
    });

    // Create transaction message
    const messageV0 = new TransactionMessage({
      payerKey: new PublicKey(wallet.address),
      recentBlockhash: (await solana.connection.getRecentBlockhash()).blockhash,
      instructions: [transferInstruction]
    }).compileToV0Message();

    // Create versioned transaction
    const transaction = new VersionedTransaction(messageV0);

    // Sign transaction via Privy
    const { signedTransaction } = await privy.walletApi.solana.signTransaction({
      walletId,
      transaction
    });

    // Send transaction
    const signature = await solana.connection.sendRawTransaction(signedTransaction.serialize());
    
    bot.sendMessage(
      msg.chat.id,
      `✅ Transfer successful!\n\n` +
      `Transaction: https://solscan.io/tx/${signature}\n` +
      `Sent ${amount} SOL to ${toAddress}`
    );
    } catch (error: unknown) {
      console.error('Transfer error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      bot.sendMessage(
        msg.chat.id,
        `❌ Sorry, there was an error processing your transfer: ${errorMessage}. Please try again later.`
      );
    }
});

// Close position command
bot.onText(/\/closeposition (.+)/, async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
  if (!msg.from || !match) {
    return;
  }
  const userId = msg.from.id;
  const poolAddress = match[1];

  console.log(`Processing /closeposition command for user ${userId} for pool ${poolAddress}`);

  // Validate pool address
  try {
    new PublicKey(poolAddress);
  } catch (error) {
    return bot.sendMessage(msg.chat.id, '❌ Invalid pool address');
  }

  const userWallets = getAllUserWallets();
  if (!userWallets[userId]) {
    return bot.sendMessage(msg.chat.id, '❌ Please use /start to create a wallet first');
  }

  try {
    const walletId = userWallets[userId];
    const wallet = await privy.walletApi.getWallet({id: walletId});
    const walletAddress = wallet.address;

    // Initialize service with pool address
    const meteoraService = new MeteoraService(solana.connection, poolAddress, 'devnet');
    const positions = await meteoraService.listPositions(walletAddress);
    
    if (positions.length === 0) {
      return bot.sendMessage(msg.chat.id, 'ℹ️ No positions found');
    }

    // Create inline keyboard for position selection
    const positionOptions = positions.map((pos: any) => ({
      text: pos.publicKey.toString().slice(0, 8) + '...',
      callback_data: `close_position_${pos.publicKey.toString()}`
    }));

    const options = {
      reply_markup: {
        inline_keyboard: [
          ...positionOptions.map(opt => [opt]),
          [{ text: '❌ Cancel', callback_data: 'cancel_close' }]
        ]
      }
    };

    bot.sendMessage(
      msg.chat.id,
      '📊 Select a position to close:',
      options
    );

    // Handle position selection
    bot.on('callback_query', async (query: TelegramBot.CallbackQuery) => {
      try {
        if (!query.data || !query.message) return;

        if (query.data.startsWith('close_position_')) {
          const positionPubKey = query.data.replace('close_position_', '');
          
          // First verify position still exists
          const positions = await meteoraService.listPositions(walletAddress);
          const position = positions.find((pos: any) => pos.publicKey.toString() === positionPubKey);
          
          if (!position) {
            return bot.editMessageText(
              '❌ Position not found or already closed',
              {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id
              }
            );
          }

          const txs = await meteoraService.closePosition(
            new PublicKey(positionPubKey),
            walletAddress
          );

          const signatures: string[] = [];
          for (const tx of txs) {
            try {
              // Get latest blockhash
              const { blockhash } = await solana.connection.getLatestBlockhash('finalized');
              
              // Update transaction with latest blockhash
              if (tx instanceof VersionedTransaction) {
                const message = tx.message;
                const newMessage = new TransactionMessage({
                  payerKey: message.staticAccountKeys[0],
                  recentBlockhash: blockhash,
                  instructions: message.compiledInstructions.map(ix => ({
                    programId: message.staticAccountKeys[ix.programIdIndex],
                    keys: ix.accountKeyIndexes.map(i => ({
                      pubkey: message.staticAccountKeys[i],
                      isSigner: false,
                      isWritable: true
                    })),
                    data: Buffer.from(ix.data)
                  }))
                }).compileToV0Message();
                
                tx.message = newMessage;
              } else if (tx instanceof Transaction) {
                tx.recentBlockhash = blockhash;
                tx.feePayer = new PublicKey(walletAddress);
              }

              // Sign transaction
              const { signedTransaction } = await privy.walletApi.solana.signTransaction({
                walletId,
                transaction: tx
              });

              // Send transaction
              const signature = await solana.connection.sendRawTransaction(
                signedTransaction.serialize(),
                {
                  skipPreflight: false,
                  preflightCommitment: 'confirmed'
                }
              );
              
              // Confirm transaction
              await solana.connection.confirmTransaction({
                signature,
                blockhash,
                lastValidBlockHeight: (await solana.connection.getBlockHeight()) + 150
              });

              signatures.push(signature);
            } catch (error: unknown) {
              console.error('Transaction error:', error);
              let errorMessage = 'Unknown error';
              if (error instanceof Error) {
                errorMessage = error.message;
                // Handle specific Meteora error codes
                if (error.message.includes('3007')) {
                  errorMessage = 'Position already closed or does not exist';
                }
              }
              bot.editMessageText(
                `❌ Transaction failed: ${errorMessage}`,
                {
                  chat_id: query.message.chat.id,
                  message_id: query.message.message_id
                }
              );
              return;
            }
          }
        
          bot.editMessageText(
            `✅ Position closed successfully!\n\n` +
            `Position: ${positionPubKey}\n` +
            `Transactions:\n${signatures.map(s => `https://solscan.io/tx/${s}`).join('\n')}`,
            {
              chat_id: query.message.chat.id,
              message_id: query.message.message_id
            }
          );
        } else if (query.data === 'cancel_close') {
          bot.editMessageText(
            '❌ Position close cancelled',
            {
              chat_id: query.message.chat.id,
              message_id: query.message.message_id
            }
          );
        }
      } catch (error: unknown) {
        console.error('Callback query error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (query.message) {
          bot.editMessageText(
            `❌ Error processing request: ${errorMessage}`,
            {
              chat_id: query.message.chat.id,
              message_id: query.message.message_id
            }
          );
        } else {
          console.error('Cannot send error message - query.message is undefined');
        }
      }
    });
  } catch (error: unknown) {
    console.error('List positions error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    bot.sendMessage(msg.chat.id, `❌ Error listing positions: ${errorMessage}`);
  }
});



// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
