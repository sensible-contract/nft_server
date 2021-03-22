const { bsv } = require("scryptlib");
const { app } = require("../app");
const { UtxoDao } = require("../dao/UtxoDao");
const { sighashType } = require("../lib/sensible_nft/NFT");
const { ScriptHelper } = require("../lib/sensible_nft/ScriptHelper");
const { PrivateKeyMgr } = require("./PrivateKeyMgr");

const MIN_FEE = 546;
class UtxoMgr {
  static get balance() {
    return this.utxos.reduce((pre, cur) => cur.satoshis + pre, 0);
  }

  static get address() {
    return PrivateKeyMgr.privateKey.toAddress().toString();
  }

  static async loadUtxos() {
    let utxos = await UtxoDao.getUtxos(this.address);
    if (utxos.length == 0) {
      let _res = await ScriptHelper.blockChainApi.getUnspents(this.address);
      utxos = _res.map((v) => ({
        txId: v.txId,
        satoshis: v.satoshis,
        outputIndex: v.outputIndex,
        rootHeight: 0,
      }));
      await UtxoDao.addUtxos(this.address, utxos);
    }
    this.utxos = utxos;
    if (this.balance < 10000) {
      throw "insufficient balance.";
    }
    await this.adjustUtxos();
  }

  /**
   * 拆分UTXO
   * 找到一个最大的UTXO将其拆分
   */
  static async adjustUtxos() {
    console.log(
      "adjustUtxo utxo count:",
      this.utxos.length,
      "balance:",
      this.balance
    );
    if (this.utxos.length >= app.get("nftConfig").minSplit) {
      //Make sure there are more than MAX_SPLIT
      return;
    }

    //Find the max value
    this.utxos.sort((a, b) => {
      return b.satoshis - a.satoshis;
    });
    let utxo = this.utxos[0];

    if (!utxo) {
      throw "insufficient balance.";
    }

    console.log(utxo);
    const unitSatoshis = app.get("nftConfig").unitSatoshis;
    const toSplitCount = Math.min(
      Math.floor(utxo.satoshis / unitSatoshis),
      app.get("nftConfig").maxSplit - this.utxos.length
    );

    // 提取该UTXO，防止被其他并发操作使用
    utxo = this.utxos.splice(0, 1)[0];

    // step 2: build the tx
    const tx = new bsv.Transaction().from({
      txId: utxo.txId,
      outputIndex: utxo.outputIndex,
      satoshis: utxo.satoshis,
      script: bsv.Script.buildPublicKeyHashOut(
        PrivateKeyMgr.privateKey.toAddress()
      ).toHex(),
    });

    let script = bsv.Script.buildPublicKeyHashOut(
      PrivateKeyMgr.privateKey.toAddress()
    );
    let leftSatoshis = utxo.satoshis;
    for (let i = 0; i < toSplitCount; i++) {
      leftSatoshis -= unitSatoshis;
      if (
        leftSatoshis < Math.ceil(tx._estimateSize() * app.get("nftConfig").feeb)
      ) {
        console.log("不足");
        break;
      }
      tx.addOutput(
        new bsv.Transaction.Output({
          script: script,
          satoshis: unitSatoshis,
        })
      );
    }
    tx.change(ScriptHelper.dummyAddress).fee(
      Math.max(
        Math.ceil(tx._estimateSize() * app.get("nftConfig").feeb),
        MIN_FEE
      )
    );

    ScriptHelper.unlockP2PKHInput(PrivateKeyMgr.privateKey, tx, 0, sighashType);
    try {
      let _res = await ScriptHelper.sendTx(tx);
      console.log("split success", _res);
      let newUtxos = [];
      tx.outputs.forEach((v, index) => {
        newUtxos.push({
          txId: tx.id,
          satoshis: v.satoshis,
          outputIndex: index,
          rootHeight: utxo.rootHeight + 1,
        });
      });
      await UtxoDao.removeUtxo(this.address, utxo.txId, utxo.outputIndex);
      await UtxoDao.addUtxos(this.address, newUtxos);
      this.utxos = this.utxos.concat(newUtxos);
      console.log(
        "split finished. balance:",
        this.balance,
        "utxo count:",
        this.utxos.length
      );
    } catch (e) {
      this.utxos.push(utxo);
      console.error(e);
      throw e;
    } finally {
    }
  }

  /**
   * 返回一个适合进行genesis的UTXO合集
   */
  static fetchUtxos(estimateSatoshis) {
    this.utxos.sort((a, b) => a.rootHeight - b.rootHeight); //从浅到深
    let sum = 0;
    let utxos = [];
    for (let i = 0; i < this.utxos.length; i++) {
      sum += this.utxos[i].satoshis;
      if (sum >= estimateSatoshis) {
        utxos = this.utxos.splice(0, i + 1);
        break;
      }
    }
    return utxos;
  }

  static fetchUtxo(estimateSatoshis) {
    this.utxos.sort((a, b) => a.rootHeight - b.rootHeight); //从浅到深
    let utxo;
    for (let i = 0; i < this.utxos.length; i++) {
      if (this.utxos[i].satoshis >= estimateSatoshis) {
        utxo = this.utxos.splice(i, i + 1)[0];
        break;
      }
    }
    return utxo;
  }

  static recycleUtxos(utxos) {
    this.utxos = this.utxos.concat(utxos);
  }
}

module.exports = {
  UtxoMgr,
};
