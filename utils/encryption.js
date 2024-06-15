import {hash} from '@kadena/cryptography-utils';

const brosec= process.env.BRO_SECPASS;

const _encrypt = (x, password) => "enc_" + hash(x + password);

export const encrypt = x => _encrypt(x.toString(), brosec)
