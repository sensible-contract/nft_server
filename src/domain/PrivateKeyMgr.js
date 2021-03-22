const { bsv } = require("scryptlib");
class PrivateKeyMgr {
  static init(wif) {
    this.privateKey = new bsv.PrivateKey.fromWIF(wif);
  }
}

module.exports = {
  PrivateKeyMgr,
};
