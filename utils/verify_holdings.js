import {encrypt} from './encryption.js';
import {getBroBalancesBatch, getBroAccountsBatch} from './pactCalls.js';
import {Decimal} from 'decimal.js'

const CHAINS = process.env.BRO_HOLDING_CHAINS.split(" ");

const MINIMUM_HOLDING = Decimal(process.env.BRO_MINIMUM_HOLDING)

export const total_balances = (accounts) => Promise.all(CHAINS.map(c=>getBroBalancesBatch(c, accounts)))
                                            .then(bals => bals.reduce((accu, x) => accu.map( (v, idx) => v.add(x[idx]))))

export const checkHoldings = async (tgIds) => {
  const accounts = await getBroAccountsBatch(tgIds.map(encrypt))
  const bals =  await total_balances(accounts);
  const result = tgIds.map( (id, idx)=> ({id:id, account:accounts[idx], bal:bals[idx], registered:accounts[idx]!="", holds:bals[idx].gte(MINIMUM_HOLDING)}))
  return result;
};
