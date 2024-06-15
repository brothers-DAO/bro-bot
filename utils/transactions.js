import {
  Pact,
  isSignedTransaction,
  createSignWithKeypair,
} from "@kadena/client";

import {getClient} from './kadena.js';
import {encrypt} from './encryption.js';
import {base64UrlEncode} from '@kadena/cryptography-utils';

const brons = process.env.BRO_NS;
const defaultChain = process.env.CHAINID;
const network = process.env.NETWORK;
const GAS_PRICE = process.env.GAS_PRICE


const bot_signer = createSignWithKeypair({ publicKey: process.env.BRO_PUBKEY, secretKey: process.env.BRO_PRIVKEY });
const bot_pubkey = process.env.BRO_PUBKEY;

export const status = (hash) => {
  const jsclient = getClient();
  return jsclient.pollStatus({requestKey:hash, chainId:defaultChain , networkId: network},
                             {timeout:240_000, interval:5000})
                  .then( x=> x?.[hash])
}

export const gather_rewards = async () => {
    const jsclient = getClient();

    const unsignedTransaction = Pact.builder
      .execution(
        `(${brons}.bro-treasury.gather-rewards)`
      )
      .setMeta({
        chainId: String(defaultChain),
        senderAccount: `r:${brons}.bot`,
        gasLimit: 12000,
        gasPrice: GAS_PRICE,
        ttl: 14400,
      })
      .addSigner(bot_pubkey, (signFor) => [
        signFor("coin.GAS"),
        signFor(`${brons}.bro-treasury.OPERATE-DEX`),
      ])
      .setNetworkId(network)
      .createTransaction();
    const signedTx = await bot_signer(unsignedTransaction);

    try {
      // Perform a preflight check
      const preflightResult = await jsclient.preflight(signedTx);
      // console.log("Preflight result:", preflightResult);

      if (preflightResult.result.status === "failure") {
        console.error("Preflight failure:", preflightResult.result.status);
        const errorMessage = preflightResult.result.error.message;
        throw new Error(errorMessage);
      }

      // console.log("Preflight successful");

      // Submit the transaction if preflight is successful
      if (isSignedTransaction(signedTx)) {
        const transactionDescriptor = await jsclient.submit(signedTx);
        return transactionDescriptor.requestKey;
      }
    } catch (error) {
      console.error("Error during preflight or submission:", error);
      throw error;
    }
  };


export const register = async (userId, account, chain) => {
    const jsclient = getClient();
    if(account.length < 3 || account.length > 256)
      throw new Error("Invalid account name")

    const b64account = base64UrlEncode(account);
    const enctg = encrypt(userId);

    const unsignedTransaction = Pact.builder
      .execution(
        `(${brons}.bro-registry.register "${enctg}" "${b64account}")`
      )
      .setMeta({
        chainId: String(chain),
        senderAccount: `r:${brons}.bot`,
        gasLimit: 1500,
        gasPrice: GAS_PRICE,
        ttl: 600,
      })
      .addSigner(bot_pubkey, (signFor) => [
        signFor("coin.GAS"),
        signFor(`${brons}.bro-registry.BOT-OPERATOR`),
      ])
      .setNetworkId(network)
      .createTransaction();

    const signedTx = await bot_signer(unsignedTransaction);

    try {
      // Perform a preflight check
      const preflightResult = await jsclient.preflight(signedTx);
      // console.log("Preflight result:", preflightResult);

      if (preflightResult.result.status === "failure") {
        console.error("Preflight failure:", preflightResult.result.status);
        const errorMessage = preflightResult.result.error.message;
        throw new Error(errorMessage);
      }

      // console.log("Preflight successful");

      // Submit the transaction if preflight is successful
      if (isSignedTransaction(signedTx)) {
        const transactionDescriptor = await jsclient.submit(signedTx);
        return transactionDescriptor.requestKey;
      }
    } catch (error) {
      console.error("Error during preflight or submission:", error);
      throw error;
    }
  };

  export const unregister = async (userId, chain) => {
      const jsclient = getClient();
      const enctg = encrypt(userId);

      const unsignedTransaction = Pact.builder
        .execution(
          `(${brons}.bro-registry.unregister "${enctg}")`
        )
        .setMeta({
          chainId: String(chain),
          senderAccount: `r:${brons}.bot`,
          gasLimit: 1500,
          gasPrice: GAS_PRICE,
          ttl: 600,
        })
        .addSigner(bot_pubkey, (signFor) => [
          signFor("coin.GAS"),
          signFor(`${brons}.bro-registry.BOT-OPERATOR`),
        ])
        .setNetworkId(network)
        .createTransaction();
      const signedTx = await bot_signer(unsignedTransaction);

      try {
        // Perform a preflight check
        const preflightResult = await jsclient.preflight(signedTx);
        // console.log("Preflight result:", preflightResult);

        if (preflightResult.result.status === "failure") {
          console.error("Preflight failure:", preflightResult.result.status);
          const errorMessage = preflightResult.result.error.message;
          throw new Error(errorMessage);
        }

        // console.log("Preflight successful");

        // Submit the transaction if preflight is successful
        if (isSignedTransaction(signedTx)) {
          const transactionDescriptor = await jsclient.submit(signedTx);
          return transactionDescriptor.requestKey;
        }
      } catch (error) {
        console.error("Error during preflight or submission:", error);
        throw error;
      }
    };


  export const tipUser = async (user) => {
    const jsclient = getClient()

    const enctg = encrypt(user);

    const unsignedTransaction = Pact.builder
      .execution(
        `(${brons}.bro-treasury.tip "${enctg}")`
      )
      .setMeta({
        chainId: String(defaultChain),
        senderAccount: `r:${brons}.bot`,
        gasPrice: GAS_PRICE,
        gasLimit: 1500,
        ttl: 600,
      })
      .addSigner(bot_pubkey, (signFor) => [
        signFor("coin.GAS"),
        signFor(`${brons}.bro-treasury.TIPPING`),
      ])
      .setNetworkId(network)
      .createTransaction();
    const signedTx = await bot_signer(unsignedTransaction);

    try {
      // Perform a preflight check
      const preflightResult = await jsclient.preflight(signedTx);
      // console.log("Preflight result:", preflightResult);

      if (preflightResult.result.status === "failure") {
        // console.error("Preflight failure:", preflightResult.result.status);
        const errorMessage = preflightResult.result.error.message;
        throw new Error(errorMessage);
      }

      // console.log("Preflight successful");

      // Submit the transaction if preflight is successful
      if (isSignedTransaction(signedTx)) {
        const transactionDescriptor = await jsclient.submit(signedTx);
        return transactionDescriptor.requestKey;
      }
    } catch (error) {
      console.error("Error during preflight or submission:", error);
      throw error;
    }
  };
