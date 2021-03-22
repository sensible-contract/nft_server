const { num2bin, Ripemd160, Sha256, toHex } = require("scryptlib");
const { DataLen8 } = require("./ScriptHelper");
const ISSUE = "00";
const TRANSFER = "01";

const issuePrefix = "25";
const transferPrefix = "3d";
/**
 * PayloadNFT
 */
class PayloadNFT {
  /**
   * 解析、构造NFT合约的数据部分
   *
   * @constructor
   *
   * @param {Object} params
   * @param {String=} params.scriptCode 合约代码部分
   * @param {string} params.dataType 数据类型，1字节
   * @param {Ripemd160} params.ownerPkh 所属人
   * @param {number} params.tokenId tokenId
   * @param {string} params.metaTxId meta txid
   * @param {number=} params.totalSupply 发行总量
   */
  constructor({ dataType, ownerPkh, tokenId, totalSupply, metaTxId }) {
    this.dataType = dataType;
    this.metaTxId = metaTxId;
    this.ownerPkh = ownerPkh;
    this.totalSupply = totalSupply;
    this.tokenId = tokenId;
  }

  dump() {
    let payload = "";
    if (this.dataType == ISSUE) {
      payload =
        toHex(this.ownerPkh) +
        num2bin(this.tokenId, DataLen8) +
        num2bin(this.totalSupply, DataLen8) +
        this.dataType;
    } else if (this.dataType == TRANSFER) {
      payload =
        toHex(this.ownerPkh) +
        num2bin(this.tokenId, DataLen8) +
        toHex(this.metaTxId) +
        this.dataType;
    }
    return payload;
  }
}

module.exports = {
  ISSUE,
  TRANSFER,
  issuePrefix,
  transferPrefix,
  PayloadNFT,
};
