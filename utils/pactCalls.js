import {pactCalls} from './kadena.js'
import {Decimal} from 'decimal.js'
import * as dateMath from 'date-arithmetic'

const _to_decimal = v => v?(v.decimal?Decimal(v.decimal):Decimal(v)):Decimal(0)

const brons = process.env.BRO_NS;
const eckons = process.env.KADENASWAP_NS
const eckoChain = process.env.KADENASWAP_CHAIN
const defaultChain = process.env.CHAINID;

const bro = `${brons}.bro`
const bro_registry = `${brons}.bro-registry`
const bro_treasury = `${brons}.bro-treasury`

export const getBal = async (chain, account) => {
    const code = `(${bro}.get-balance "${account}")`;
    const res = await pactCalls(code, chain);
    const parsedResponse = parsePactResponse(res);
    return parsedResponse;
}

export const listAccounts = () => {
    const code = `(${bro_registry}.list-accounts)`;
    return pactCalls(code, defaultChain)
           .then(parsePactResponseThrow)
}

export const getBroAccount = (user) => {
    const code = `(${bro_registry}.get-bro-account "${user}")`;
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
  const code = `(map (lambda (enc) (try "" (${bro_registry}.get-bro-account enc))) ${JSON.stringify(users)})`;
  return pactCalls(code, defaultChain)
        .then(parsePactResponseThrow)
}

export const getBroBalancesBatch = (chain, accounts) => {
  const code = `(map (lambda (acct) (try 0.0 (${bro}.get-balance acct))) ${JSON.stringify(accounts)})`;
  return pactCalls(code, chain)
         .then(parsePactResponseThrow)
         .then(data => data?data.map(_to_decimal):null)
}

export const getEckoLiquidityBatch = (accounts) => {
  const code = `(use ${bro_treasury})
                (map (lambda (x) (round x 12))
                (map (* (/ ( ${bro}.get-balance (dex-account)) (${eckons}.tokens.total-supply DEX-KEY)))
                     (map (lambda (acct) (try 0.0 (${eckons}.tokens.get-balance DEX-KEY acct))) ${JSON.stringify(accounts)})))`;
  return pactCalls(code, eckoChain)
         .then(parsePactResponseThrow)
         .then(data => data?data.map(_to_decimal):null)
}

export const getBroPrice = () => {
  const code = `(let ((acct (${bro_treasury}.dex-account)))
                 (round (/ (coin.get-balance acct)
                           (${bro}.get-balance acct))
                        2))`
  return pactCalls(code, defaultChain)
         .then(parsePactResponseThrow)
         .then(_to_decimal)
}

export const gatherableRewards = () => {
  const code = `(${bro_treasury}.liquidity-to-remove)`
  return pactCalls(code, defaultChain)
         .then(parsePactResponseThrow)
         .then(_to_decimal)
}

export const getBroTreasury = () => {
  const _compute = ([treasury, resCoin, resBro, liquidity]) => ({main:treasury,
                                                                 liquidity_bro: liquidity.mul(resCoin.div(resBro).sqrt()),
                                                                 liquidity_coin: liquidity.mul(resBro.div(resCoin).sqrt())
                                                                })

  const code = `[(${bro}.get-balance ${bro_treasury}.TREASURY-ACCOUNT)
                 (at 0 (${bro_treasury}.dex-reserves))
                 (at 1 (${bro_treasury}.dex-reserves))
                 (${bro_treasury}.current-liquidity)]`

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
