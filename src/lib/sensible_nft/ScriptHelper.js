require("./fix_bsv_in_scrypt");
const { existsSync, readFileSync } = require("fs");
const { compileContract, bsv, Sha256 } = require("scryptlib");
const { Net } = require("../net");
const path = require("path");
const BN = bsv.crypto.BN;
const minFee = 546;

const inputIndex = 0;
const DataLen = 1;
const DataLen4 = 4;
const DataLen8 = 8;
const dummyTxId =
  "a477af6b2667c29670467e4e0728b685ee07b240235771862318e29ddbe58458";
const reversedDummyTxId =
  "5884e5db9de218238671572340b207ee85b628074e7e467096c267266baf77a4";
const out = path.join(__dirname, "deployments/fixture/autoGen");
const contractScryptPath = path.join(__dirname, "../../../contracts");
const contractJsonPath = path.join(
  __dirname,
  "../../../deployments/fixture/autoGen"
);

class ScriptHelper {
  static prepare(blockChainApi, privateKey, contractSatoshis, satotxApiPrefix) {
    this.blockChainApi = blockChainApi;
    this.privateKey = privateKey;
    this.dummyAddress = privateKey.toAddress();
    const dummyPublicKey = bsv.PublicKey.fromPrivateKey(privateKey);
    this.dummyPkh = bsv.crypto.Hash.sha256ripemd160(dummyPublicKey.toBuffer());

    this.contractSatoshis = contractSatoshis;
    this.satotxApiPrefix = satotxApiPrefix;
    this.fee = 1000;
  }
  /**
   * reverse hexStr byte order
   * @param {Sha256} hexStr
   */
  static reverseEndian(hexStr) {
    let num = new BN(hexStr, "hex");
    let buf = num.toBuffer();
    return buf.toString("hex").match(/.{2}/g).reverse().join("");
  }

  static makeTx({ tx, inputs, outputs }) {
    inputs.forEach((input) => {
      var script;
      if (input.to) {
        script = bsv.Script.buildPublicKeyHashOut(input.to);
        tx.addInput(
          new bsv.Transaction.Input.PublicKeyHash({
            prevTxId: input.txid,
            outputIndex: input.vout,
            script: "",
          }),
          script,
          input.satoshis
        );
      } else if (input.script) {
        script = bsv.Script.fromASM(input.script);
        tx.addInput(
          new bsv.Transaction.Input({
            prevTxId: input.txid,
            outputIndex: input.vout,
            script: "",
          }),
          script,
          input.satoshis
        );
      }
    });

    outputs.forEach((output) => {
      var script;
      if (output.to) {
        script = bsv.Script.buildPublicKeyHashOut(output.to);
      } else if (output.script) {
        script = bsv.Script.fromASM(output.script);
      } else if (output.opreturn) {
        script = output.opreturn;
      }
      tx.addOutput(
        new bsv.Transaction.Output({
          script: script,
          satoshis: output.satoshis,
        })
      );
    });
    return tx;
  }
  static createDummyPayByOthersTx(utxoTxId) {
    // step 1: fetch utxos
    let _utxos = [
      {
        txId: utxoTxId,
        outputIndex: 0,
        satoshis: 100000000 * 21,
      },
    ];

    let utxos = _utxos.map((utxo) => ({
      txId: utxo.txId,
      outputIndex: utxo.outputIndex,
      satoshis: utxo.satoshis,
      script: bsv.Script.buildPublicKeyHashOut(this.dummyAddress).toHex(),
    }));

    // step 2: build the tx
    const tx = new bsv.Transaction().from(utxos);
    return tx;
  }

  static async createPayByOthersTx(address) {
    // step 1: fetch utxos
    let _res = await this.blockChainApi.getUnspents(address);

    let utxos = _res.map((utxo) => ({
      txId: utxo.txId,
      outputIndex: utxo.outputIndex,
      satoshis: utxo.satoshis,
      script: bsv.Script.buildPublicKeyHashOut(address).toHex(),
    }));

    // step 2: build the tx
    const tx = new bsv.Transaction().from(utxos);
    return tx;
  }

  /**
   * 构造锁定脚本的交易
   * @param address 地址
   * @param amountInContract 注入合约的金额
   * @param fee 矿工费
   */
  static async createLockingTx(address, amountInContract, fee) {
    // step 1: fetch utxos
    let _res = await this.blockChainApi.getUnspents(address);

    let utxos = _res.map((utxo) => ({
      txId: utxo.txId,
      outputIndex: utxo.outputIndex,
      satoshis: utxo.satoshis,
      script: bsv.Script.buildPublicKeyHashOut(address).toHex(),
    }));

    // step 2: build the tx
    const tx = new bsv.Transaction().from(utxos);
    tx.addOutput(
      new bsv.Transaction.Output({
        script: new bsv.Script(), // place holder
        satoshis: amountInContract,
      })
    );

    tx.change(address).fee(fee || minFee);

    return tx;
  }

  static createUnlockingTx(
    prevTxId,
    inputAmount,
    inputLockingScriptASM,
    outputAmount,
    outputLockingScriptASM
  ) {
    const tx = new bsv.Transaction();

    tx.addInput(
      new bsv.Transaction.Input({
        prevTxId,
        outputIndex: inputIndex,
        script: new bsv.Script(), // placeholder
      }),
      bsv.Script.fromASM(inputLockingScriptASM),
      inputAmount
    );

    tx.addOutput(
      new bsv.Transaction.Output({
        script: bsv.Script.fromASM(
          outputLockingScriptASM || inputLockingScriptASM
        ),
        satoshis: outputAmount,
      })
    );

    tx.fee(inputAmount - outputAmount);

    return tx;
  }

  static unlockP2PKHInput(privateKey, tx, inputIndex, sigtype) {
    const sig = new bsv.Transaction.Signature({
      publicKey: privateKey.publicKey,
      prevTxId: tx.inputs[inputIndex].prevTxId,
      outputIndex: tx.inputs[inputIndex].outputIndex,
      inputIndex,
      signature: bsv.Transaction.Sighash.sign(
        tx,
        privateKey,
        sigtype,
        inputIndex,
        tx.inputs[inputIndex].output.script,
        tx.inputs[inputIndex].output.satoshisBN
      ),
      sigtype,
    });

    tx.inputs[inputIndex].setScript(
      bsv.Script.buildPublicKeyHashIn(
        sig.publicKey,
        sig.signature.toDER(),
        sig.sigtype
      )
    );
  }

  /**
   * @param {Object} satotxData
   * @param {number} satotxData.index utxo的vout
   * @param {Sha256} satotxData.txId 产生utxo的txid
   * @param {String} satotxData.txHex 产生utxo的rawtx
   * @param {Sha256} satotxData.byTxId 花费此utxo的txid
   * @param {String} satotxData.byTxHex 花费此utxo的rawtx
   */
  static async satoTxSigUTXOSpendBy({ index, txId, txHex, byTxId, byTxHex }) {
    let _res = await Net.httpPost(
      `${this.satotxApiPrefix}/utxo-spend-by/${txId}/${index}/${byTxId}`,
      {
        txHex: txHex,
        byTxHex: byTxHex,
      }
    );
    if (_res.code != 0) {
      throw _res.msg;
    }

    return _res.data;
  }

  /**
   * @param {Object} satotxData
   * @param {number} satotxData.index utxo的vout
   * @param {Sha256} satotxData.txId 产生utxo的txid
   * @param {String} satotxData.txHex 产生utxo的rawtx
   */
  static async satoTxSigUTXO({ index, txId, txHex }) {
    let _res = await Net.httpPost(
      `${this.satotxApiPrefix}/utxo/${txId}/${index}`,
      {
        txHex: txHex,
      }
    );
    if (_res.code == -1) {
      throw _res.msg;
    }
    return _res.data;
  }

  static async sendTx(tx) {
    let txid = await this.blockChainApi.broadcast(tx.serialize());
    return txid;
  }

  static compileContract(fileName) {
    const filePath = path.join(this.contractScryptPath, fileName);
    const out = this.contractJsonPath;

    const result = compileContract(filePath, out);
    if (result.errors.length > 0) {
      console.log(`Compile contract ${filePath} fail: `, result.errors);
      throw result.errors;
    }

    return result;
  }

  static loadDesc(fileName) {
    const filePath = path.join(this.contractJsonPath, `${fileName}`);
    if (!existsSync(filePath)) {
      throw new Error(
        `Description file ${filePath} not exist!\nIf You already run 'npm run watch', maybe fix the compile error first!`
      );
    }
    return JSON.parse(readFileSync(filePath).toString());
  }

  static getDataPart(hex, outputIndex) {
    let _res = new bsv.Transaction(hex);
    return this.getDataPartFromScript(_res.outputs[outputIndex].script);
  }

  static getDataPartFromScript(script) {
    let chunks = script.chunks;
    let opreturnIdx = -1;
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].opcodenum == 106) {
        opreturnIdx = i;
        break;
      }
    }

    if (opreturnIdx == -1) return "";
    let parts = chunks.splice(opreturnIdx, chunks.length);
    let genesisPart = parts[1];
    let dataPart = parts[2];
    if (!dataPart) return "";
    return dataPart.len.toString(16) + dataPart.buf.toString("hex");
  }
}

ScriptHelper.contractJsonPath = contractJsonPath;
ScriptHelper.contractScryptPath = contractScryptPath;

module.exports = {
  inputIndex,
  DataLen,
  DataLen4,
  DataLen8,
  dummyTxId,
  reversedDummyTxId,
  ScriptHelper,
};
