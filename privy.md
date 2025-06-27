# Solana

## 1. Sign a message

Use the `signMessage` method on the ethereum client to sign a message with an Solana wallet.

```typescript
signMessage: (message: string, options: {uiOptions: SignMessageModalUIOptions; address?: string}) =>
  Promise<{signature: string}>;
```

### Usage

```typescript
const {signature, encoding} = await privy.walletApi.solana.signMessage({
  walletId: 'insert-wallet-id',
  message: 'Hello world'
});
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletId` | `string` | **Required** Unique ID of the wallet to take actions with. |
| `message` | `string | Uint8Array` | **Required** The string or bytes to sign with the wallet. |
| `idempotencyKey` | `string` | Idempotency key to identify a unique request. |

### Returns

| Field | Type | Description |
|-------|------|-------------|
| `signature` | `string` | An encoded string serializing the signature produced by the user's wallet. |
| `encoding` | `'hex'` | The encoding format for the returned signature. Currently, only 'base64' is supported for Solana. |

## 2. Send a transaction

Use the `signAndSendTransaction` method on the Solana client to send a transaction with a Solana wallet.

```typescript
signAndSendTransaction: (input: SolanaSignAndSendTransactionInputType) => Promise<SolanaSignAndSendTransactionResponseType>
```

### Usage

```typescript
import {
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';

const walletPublicKey = new PublicKey(wallet.address);
const instruction = SystemProgram.transfer({
  fromPubkey: walletPublicKey,
  toPubkey: new PublicKey(recipientAddress),
  lamports: amount,
});

const message = new TransactionMessage({
  payerKey: walletPublicKey,
  instructions: [instruction],
  recentBlockhash,
});

const transaction = new VersionedTransaction(message.compileToV0Message());

const {hash} = await privy.walletApi.solana.signAndSendTransaction({
  walletId: 'insert-wallet-id',
  caip2: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', // Mainnet
  transaction: transaction,
});
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletId` | `string` | **Required** The ID of the wallet to send the transaction from. |
| `caip2` | `string` | **Required** The CAIP2 chain ID of the chain the transaction is being sent on. |
| `transaction` | `Transaction | VersionedTransaction` | **Required** The transaction to sign and send. This can be either a legacy Transaction or a VersionedTransaction object from @solana/web3.js. |

### Returns

| Field | Type | Description |
|-------|------|-------------|
| `hash` | `string` | The hash for the broadcasted transaction. |
| `caip2` | `string` | The CAIP2 chain ID of the chain the transaction was sent on. |

## 3. Sign a transaction

Use the `signTransaction` method on the Solana client to sign a transaction with an Solana wallet.

```typescript
signTransaction: (input: SolanaSignTransactionInputType) => Promise<SolanaSignTransactionResponseType>
```

### Usage

```typescript
import {
  clusterApiUrl,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  TransactionMessage
} from '@solana/web3.js';

const walletPublicKey = new PublicKey(wallet.address);
const connection = new Connection(clusterApiUrl('devnet'));
const instruction = SystemProgram.transfer({
  fromPubkey: walletPublicKey,
  toPubkey: new PublicKey(address),
  lamports: value * LAMPORTS_PER_SOL
});

const {blockhash: recentBlockhash} = await connection.getLatestBlockhash();

const message = new TransactionMessage({
  payerKey: walletPublicKey,
  // Replace with your desired instructions
  instructions: [instruction],
  recentBlockhash
});

const yourSolanaTransaction = new VersionedTransaction(message.compileToV0Message());

// Get the signed transaction object from the response
const {signedTransaction} = await privy.walletApi.solana.signTransaction({
  walletId: wallet.id,
  transaction: yourSolanaTransaction
});
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `walletId` | `string` | **Required** The ID of the wallet to send the transaction from. |
| `transaction` | `Transaction | VersionedTransaction` | **Required** The transaction to sign. This can be either a legacy Transaction or a VersionedTransaction object from @solana/web3.js. |

### Returns

| Field | Type | Description |
|-------|------|-------------|
| `signedTransaction` | `string` | The signed transaction. |
| `encoding` | `'base64'` | The encoding format for the returned signedTransaction. Currently, only 'base64' is supported for Solana. |
```