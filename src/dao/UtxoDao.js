const { app } = require("../app");
const { ErrCode, Utxo } = require("../const");
const { CodeError } = require("../util/CodeError");

class UtxoDao {
  static getDB() {
    return app.dao.getClient("db_sensible_nft");
  }

  static getUtxos(address) {
    return new Promise((resolve, reject) => {
      this.getDB()
        .collection("utxos_" + address)
        .find({})
        .toArray((err, res) => {
          if (err) {
            reject(new CodeError(ErrCode.EC_DAO_ERROR));
            return;
          }

          resolve(res);
        });
    });
  }

  static addUtxos(address, utxos) {
    return new Promise((resolve, reject) => {
      this.getDB()
        .collection("utxos_" + address)
        .insertMany(utxos, (err, res) => {
          if (err) {
            reject(new CodeError(ErrCode.EC_DAO_ERROR));
            return;
          }
          resolve(res);
        });
    });
  }

  static removeUtxo(address, txId, outputIndex) {
    return new Promise((resolve, reject) => {
      this.getDB()
        .collection("utxos_" + address)
        .deleteOne({ txId, outputIndex }, (err, res) => {
          if (err) {
            reject(new CodeError(ErrCode.EC_DAO_ERROR));
            return;
          }
          resolve(res);
        });
    });
  }

  static updateUtxo(address, txId, outputIndex, utxo) {
    return new Promise((resolve, reject) => {
      this.getDB()
        .collection("utxos_" + address)
        .updateOne({ txId, outputIndex }, { $set: utxo }, (err, res) => {
          if (err) {
            reject(new CodeError(ErrCode.EC_DAO_ERROR));
            return;
          }
          resolve(res);
        });
    });
  }
}

module.exports = {
  UtxoDao,
};
