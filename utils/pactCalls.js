import {pactCalls} from './kadena.js'
import {Decimal} from 'decimal.js'
import * as dateMath from 'date-arithmetic'

const _to_decimal = v => v?(v.decimal?Decimal(v.decimal):Decimal(v)):Decimal(0)

const brons = process.env.BRO_NS;
const defaultChain = process.env.CHAINID;

export const getBal = async (chain, account) => {
    const code = `(${brons}.bro.get-balance "${account}")`;
    const res = await pactCalls(code, chain);
    const parsedResponse = parsePactResponse(res);
    return parsedResponse;
}

export const listAccounts = () => {
    const code = `(${brons}.bro-registry.list-accounts)`;
    return pactCalls(code, defaultChain)
           .then(parsePactResponseThrow)
}

export const getBroAccount = (user) => {
    const code = `(${brons}.bro-registry.get-bro-account "${user}")`;
    return pactCalls(code, defaultChain)
           .then(parsePactResponse)
  };

export const getNow = () => {
    const code = `(free.util-time.now)`;
    return pactCalls(code, defaultChain)
           .then(parsePactResponseThrow)
           .then(x => new Date(x.timep))
  };

export const isInSync = () => getNow().then(x => dateMath.diff(x, new Date, 'seconds') < 180)
                                      .catch(() => false)

export const getBroAccountsBatch = (users) => {
  const code = `(map (lambda (enc) (try "" (${brons}.bro-registry.get-bro-account enc))) ${JSON.stringify(users)})`;
  return pactCalls(code, defaultChain)
        .then(parsePactResponseThrow)
}

export const getBroBalancesBatch = (chain, accounts) => {
  const code = `(map (lambda (acct) (try 0.0 (${brons}.bro.get-balance acct))) ${JSON.stringify(accounts)})`;
  return pactCalls(code, chain)
         .then(parsePactResponseThrow)
         .then(data => data?data.map(_to_decimal):null)
}

export const getBroPrice = () => {
  const code = `(let ((acct (${brons}.bro-treasury.dex-account)))
                 (round (/ (coin.get-balance acct)
                           (${brons}.bro.get-balance acct))
                        2))`
  return pactCalls(code, defaultChain)
         .then(parsePactResponseThrow)
         .then(_to_decimal)
}

export const gatherableRewards = () => {
  const code = `(${brons}.bro-treasury.liquidity-to-remove)`
  return pactCalls(code, defaultChain)
         .then(parsePactResponseThrow)
         .then(_to_decimal)
}

export const getBroTreasury = () => {
  const _compute = ([treasury, resCoin, resBro, liquidity]) => ({main:treasury,
                                                                 liquidity_bro: liquidity.mul(resCoin.div(resBro).sqrt()),
                                                                 liquidity_coin: liquidity.mul(resBro.div(resCoin).sqrt())
                                                                })

  const code = `[(${brons}.bro.get-balance ${brons}.bro-treasury.TREASURY-ACCOUNT)
                 (at 0 (${brons}.bro-treasury.dex-reserves))
                 (at 1 (${brons}.bro-treasury.dex-reserves))
                 (${brons}.bro-treasury.current-liquidity)]`

  return pactCalls(code, defaultChain)
         .then(parsePactResponseThrow)
         .then(x => x.map(_to_decimal))
         .then(_compute)
}

const parsePactResponseThrow = (response) => {
  if (response?.result?.status === 'success')
    return response.result.data
  throw new Error(response?.result?.error?.message)
  };

const parsePactResponse = (response) => {
    if (response.result.status === 'success') {
      return {
        success: true,
        data: response.result.data
      };
    } else if (response.result.status === 'failure') {
      return {
        success: false,
        error: response.result.error.message
      };
    }
  };
