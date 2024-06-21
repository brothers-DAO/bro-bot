import {encrypt} from './encryption.js';
import {getBroBalancesBatch, getBroAccountsBatch, getEckoLiquidityBatch} from './pactCalls.js';
import {Decimal} from 'decimal.js'

const CHAINS = process.env.BRO_HOLDING_CHAINS.split(" ");

const MINIMUM_HOLDING = Decimal(process.env.BRO_MINIMUM_HOLDING)
const LIQUIDITY_MULTIPLIER = Decimal(process.env.LIQUIDITY_MULTIPLIER)


export const total_balances = (accounts) => Promise.all(CHAINS.map(c=>getBroBalancesBatch(c, accounts)))
                                            .then(bals => bals.reduce((accu, x) => accu.map( (v, idx) => v.add(x[idx]))))

export const checkHoldings = async (tgIds) => {
  const accounts = await getBroAccountsBatch(tgIds.map(encrypt))
  const hold =  await total_balances(accounts);
  const liquidity =  await getEckoLiquidityBatch(accounts)
  const bals = hold.map( (h,i) => h.add(liquidity[i].mul(LIQUIDITY_MULTIPLIER)))
  const result = tgIds.map( (id, idx)=> ({id:id, account:accounts[idx], hold:hold[idx], liquidity:liquidity[idx], bal:bals[idx], registered:accounts[idx]!="", holds:bals[idx].gte(MINIMUM_HOLDING)}))
  return result;
};
