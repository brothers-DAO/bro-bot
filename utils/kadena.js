import {Pact, createClient} from "@kadena/client";

const apiHost = process.env.API_HOST
const network = process.env.NETWORK;
const defaultChain = process.env.CHAINID;

const add_https = x => x.startsWith("http")?x:"https://"+x;

export const getClient = (chain=defaultChain) => createClient(`${add_https(apiHost)}/chainweb/0.0/${network}/chain/${chain}/pact`);

export const pactCalls = async (code, chain) => {
  const pactClient = getClient(chain);
  const tx = Pact.builder
    .execution(code)
    .setMeta({
      chainId: String(chain),
      gasLimit: 100000,
      gasPrice: 0.0000001,
    })
    .setNetworkId(network)
    .createTransaction();

  //console.log(tx)
  try {
    const res = await pactClient.dirtyRead(tx);
    return res;
  } catch (error) {
    console.error("Error fetching account details:", error);
    return null;
  }
};
