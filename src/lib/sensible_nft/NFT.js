// @ts-nocheck
const {
  bsv,
  buildContractClass,
  Bytes,
  getPreimage,
  num2bin,
  PubKey,
  Ripemd160,
  Sha256,
  Sig,
  SigHashPreimage,
  signTx,
  toHex,
} = require("scryptlib");
const {
  PayloadNFT,
  ISSUE,
  TRANSFER,
  SWAP,
  SELL,
  issuePrefix,
  transferPrefix,
} = require("./PayloadNFT");
const { DataLen4, dummyTxId, ScriptHelper } = require("./ScriptHelper");

const Signature = bsv.crypto.Signature;
const sighashType =
  Signature.SIGHASH_ANYONECANPAY |
  Signature.SIGHASH_ALL |
  Signature.SIGHASH_FORKID;

/**
 * NFT Tx forge，创建合约相关的Tx，执行对应签名
 */
class NFT {
  /**
   * @param {Boolean} pubkey
   * @constructor NFT合约 forge
   */
  constructor(pubkey) {
    // @ts-ignore
    const rabinPubKey = BigInt("0x" + pubkey);

    let deploy = true;
    this.deploy = deploy;

    let nftContractDesc;
    const compileBeforeTest = !deploy;
    if (compileBeforeTest) {
      /* 实时编译 */
      nftContractDesc = ScriptHelper.compileContract("nft.scrypt");
    } else {
      /* 预编译 */
      nftContractDesc = ScriptHelper.loadDesc("nft_desc.json");
    }
    const nftContractClass = buildContractClass(nftContractDesc);
    this.nft = new nftContractClass(rabinPubKey);
    this.nftCodePart = this.nft.codePart.toASM();
  }

  /**
   * 创建一个新的Tx，用作GenesisTx溯源；发布时不需要这一步，直接用现成的utxo即可
   *
   * @param {Object} params 必要参数
   * @param {number} params.outputSatoshis 输出satoshi
   *
   * @returns {Tx} tx
   */
  makeTxP2pk({ outputSatoshis }) {
    let tx = ScriptHelper.createDummyPayByOthersTx(dummyTxId);
    let txnew = ScriptHelper.makeTx({
      tx: tx,
      inputs: [],
      outputs: [
        {
          satoshis: outputSatoshis,
          to: ScriptHelper.dummyAddress,
        },
      ],
    });
    txnew.change(ScriptHelper.dummyAddress).fee(ScriptHelper.fee);
    return txnew;
  }

  /**
   * 设置溯源outpoint信息
   *
   * @param {Object} params 必要参数
   * @param {Sha256} params.prevTxId 溯源txid
   * @param {number} params.outputIndex 溯源outputIndex
   * @param {number=} params.issueOutputIndex = 0 溯源初始发起的Issue输出的outputIdx
   *
   * @returns {Tx} tx
   */
  setTxGenesisPart({ prevTxId, outputIndex, issueOutputIndex = 0 }) {
    this.nftGenesisPart =
      ScriptHelper.reverseEndian(prevTxId) +
      num2bin(outputIndex, DataLen4) +
      num2bin(issueOutputIndex, DataLen4);
  }

  /**
   * 使用溯源outpoint创建GenesisTx，指定发行人和起始tokenId
   *
   * @param {Object} params 必要参数
   * @param {Ripemd160} params.outputIssuerPkh 初始化发行人Pkh
   * @param {number} params.outputTokenId 初始化发行tokenId
   * @param {string} params.metaTxId meta txid
   * @param {number} params.totalSupply 发行总量
   * @param params.opreturnData
   * @returns {Tx} tx
   */
  async makeTxGenesis({
    tx,
    outputIssuerPkh,
    outputTokenId,
    totalSupply,
    opreturnData,
  }) {
    let pl = new PayloadNFT({
      dataType: ISSUE,
      ownerPkh: outputIssuerPkh,
      totalSupply: totalSupply,
      tokenId: outputTokenId,
    });
    const newLockingScript = [
      this.nftCodePart,
      this.nftGenesisPart,
      pl.dump(),
    ].join(" ");

    let outputs = [
      {
        satoshis: ScriptHelper.contractSatoshis,
        script: newLockingScript,
      },
    ];
    if (opreturnData) {
      outputs.push({
        satoshis: 0,
        opreturn: opreturnData,
      });
    }
    let txnew = ScriptHelper.makeTx({
      tx: tx,
      inputs: [],
      outputs,
    });
    txnew.change(ScriptHelper.dummyAddress).fee(ScriptHelper.fee);
    return txnew;
  }

  /**
   * 创建IssueTx，发行下一个Token给某接收人
   *
   * @param {Object} params 必要参数
   * @param {Sha256} params.prevTxId 上一个issue utxo txid
   * @param {number} params.outputIndex 上一个issue utxo outputIndex
   * @param {PayloadNFT} params.pl 输入锁定
   *
   * @param {Object} outs 输出
   * @param {Ripemd160} outs.outputOwnerPkh 新Token接收人Pkh
   * @param {number} outs.outputTokenId 下一个发行tokenId, 应当为inputTokenId+1
   * @param {Ripemd160} outs.changeAddress 找零地址
   * @param {Ripemd160} outs.opreturnData opreturnData
   * @returns {Tx} tx
   */
  async makeTxIssue(
    tx,
    { prevTxId, outputIndex, pl },
    { outputOwnerPkh, outputTokenId, changeAddress, opreturnData }
  ) {
    const utxoLockingScript = [
      this.nftCodePart,
      this.nftGenesisPart,
      pl.dump(),
    ].join(" ");

    pl.tokenId = outputTokenId;
    const newLockingScript0 = [
      this.nftCodePart,
      this.nftGenesisPart,
      pl.dump(),
    ].join(" ");

    pl.dataType = TRANSFER;
    pl.ownerPkh = outputOwnerPkh;
    const newLockingScript1 = [
      this.nftCodePart,
      this.nftGenesisPart,
      pl.dump(),
    ].join(" ");

    let inputs = [
      {
        txid: prevTxId,
        vout: outputIndex,
        satoshis: ScriptHelper.contractSatoshis,
        script: utxoLockingScript, // issue
      },
    ];

    let outputs = [
      {
        satoshis: ScriptHelper.contractSatoshis,
        script: newLockingScript0, // issue
      },
      {
        satoshis: ScriptHelper.contractSatoshis,
        script: newLockingScript1, // transfer
      },
    ];
    if (opreturnData) {
      outputs.push({
        satoshis: 0,
        opreturn: opreturnData,
      });
    }
    let txnew = ScriptHelper.makeTx({
      tx: tx,
      inputs,
      outputs,
    });

    txnew.change(changeAddress).fee(ScriptHelper.fee);
    return txnew;
  }

  /**
   * 创建 TransferTx
   * Token拥有者转移token到下一个接收人
   *
   * @param {Object} params 必要参数
   * @param {Sha256} params.prevTxId 上一个transfer utxo txid
   * @param {number} params.outputIndex 上一个transfer utxo outputIndex
   * @param {PayloadNFT} params.pl 输入锁定
   *
   * @param {Object} outs 输出
   * @param {Ripemd160} outs.outputOwnerPkh Token新的所属人pkh
   * @param {number} outs.outputTokenId Token新的Id，输出锁定脚本中的tokenId, 应当和原Id保持一致
   * @param {Ripemd160} outs.changeAddress 找零地址
   * @param {any} outs.opreturnData opreturnData
   * @returns {Tx} tx
   */
  async makeTxTransfer(
    tx,
    { prevTxId, outputIndex, pl },
    { outputOwnerPkh, outputTokenId, changeAddress, opreturnData }
  ) {
    const utxoLockingScript = [
      this.nftCodePart,
      this.nftGenesisPart,
      pl.dump(),
    ].join(" ");
    pl.ownerPkh = outputOwnerPkh;
    pl.tokenId = outputTokenId;
    const newLockingScript0 = [
      this.nftCodePart,
      this.nftGenesisPart,
      pl.dump(),
    ].join(" ");

    let inputs = [
      {
        txid: prevTxId,
        vout: outputIndex,
        satoshis: ScriptHelper.contractSatoshis,
        script: utxoLockingScript, // transfer
      },
    ];
    let outputs = [
      {
        satoshis: ScriptHelper.contractSatoshis,
        script: newLockingScript0, // transfer
      },
    ];
    if (opreturnData) {
      outputs.push({
        satoshis: 0,
        opreturn: opreturnData,
      });
    }
    let txnew = ScriptHelper.makeTx({
      tx: tx,
      inputs,
      outputs,
    });
    txnew.change(changeAddress).fee(ScriptHelper.fee);
    return txnew;
  }

  ////////////////////////////////////////////////////////////////
  /**
   * unlockTxIssue
   * 为之前创建的issue Tx生成解锁脚本，并签名其他输入
   *
   * @param {Object} params 必要参数
   * @param {Tx} params.tx 用makeTxIssue创建的Tx对象
   * @param {PayloadNFT} params.pl 输入锁定
   * @param {Ripemd160} params.outputOwnerPkh 接收人pkh
   * @param {Ripemd160} params.changePkh 找零地址
   * @param {any} params.opreturnData opreturnData
   *
   * @param {Object} envs 调用环境
   * @param {PrivateKey} envs.privKeyIssuer 发行者私钥
   * @param {Pubkey} envs.publicKeyIssuer 发行者公钥
   *
   * @param {Object} satotxData
   *
   * @returns {Object} Contract
   */
  async unlockTxIssue(
    { tx, pl, outputOwnerPkh, changePkh, opreturnData, metaTxId },
    { privKeyIssuer, publicKeyIssuer },
    satotxData
  ) {
    // 设置校验环境
    const changeAmount = tx.outputs[tx.outputs.length - 1].satoshis;
    const curInputIndex = tx.inputs.length - 1;

    this.nft.setDataPart(this.nftGenesisPart + " " + pl.dump());
    this.nft.txContext = {
      tx: tx,
      inputIndex: curInputIndex,
      inputSatoshis: ScriptHelper.contractSatoshis,
    };

    // 计算preimage
    const preimage = getPreimage(
      tx,
      this.nft.lockingScript.toASM(),
      ScriptHelper.contractSatoshis,
      curInputIndex,
      sighashType
    );
    // 计算签名
    const sig = signTx(
      tx,
      privKeyIssuer,
      this.nft.lockingScript.toASM(),
      ScriptHelper.contractSatoshis,
      curInputIndex,
      sighashType
    );

    // 获取Oracle签名
    let sigInfo = await ScriptHelper.satoTxSigUTXOSpendBy(satotxData);
    let script = new bsv.Script(sigInfo.script);
    let preDataPartHex = ScriptHelper.getDataPartFromScript(script);

    // 创建解锁
    let contractObj = this.nft.issue(
      new SigHashPreimage(toHex(preimage)),
      BigInt("0x" + sigInfo.sigBE),
      new Bytes(sigInfo.payload),
      new Bytes(sigInfo.padding),
      new Bytes(preDataPartHex),
      new Bytes(opreturnData ? opreturnData.toHex() : ""),

      new Sig(toHex(sig)),
      new PubKey(toHex(publicKeyIssuer)),

      new Bytes(metaTxId),
      new Ripemd160(toHex(outputOwnerPkh)),
      ScriptHelper.contractSatoshis,
      new Ripemd160(toHex(changePkh)),
      changeAmount
    );

    if (this.deploy) {
      // unlock other p2pkh inputs
      for (let i = 0; i < curInputIndex; i++) {
        ScriptHelper.unlockP2PKHInput(
          ScriptHelper.privateKey,
          tx,
          i,
          sighashType
        );
        // console.log("sig:", i, tx.inputs[i].script.toASM())
      }
      const unlockingScript = contractObj.toScript();
      tx.inputs[curInputIndex].setScript(unlockingScript);
      // console.log("sig:", curInputIndex, unlockingScript.toASM())
    }

    // 验证
    return contractObj;
  }

  /**
   * unlockTxTransfer
   * 为之前创建的Transfer Tx生成解锁脚本，并签名其他输入
   *
   * @param {Object} params 必要参数
   * @param {Tx} params.tx 用makeTxTransfer创建的Tx对象
   * @param {PayloadNFT} params.pl 输入锁定
   * @param {Ripemd160} params.outputOwnerPkh 新所属人的公钥Hash
   * @param {Ripemd160} params.changePkh 找零地址
   * @param {any} params.opreturnData opreturnData
   *
   * @param {Object} envs 调用环境
   * @param {PrivateKey} envs.privKeyTransfer 之前所属人的私钥
   * @param {PubKey} envs.inputOwnerPk 之前所属人的公钥
   *
   * @param {Object} satotxData
   *
   * @returns {Object} Contract
   */
  async unlockTxTransfer(
    { tx, pl, outputOwnerPkh, changePkh, opreturnData },
    { privKeyTransfer, inputOwnerPk },
    satotxData
  ) {
    const changeAmount = tx.outputs[tx.outputs.length - 1].satoshis;
    const curInputIndex = tx.inputs.length - 1;

    this.nft.setDataPart(this.nftGenesisPart + " " + pl.dump());
    this.nft.txContext = {
      tx: tx,
      inputIndex: curInputIndex,
      inputSatoshis: ScriptHelper.contractSatoshis,
    };

    // 计算preimage
    const preimage = getPreimage(
      tx,
      this.nft.lockingScript.toASM(),
      ScriptHelper.contractSatoshis,
      curInputIndex,
      sighashType
    );

    // 计算签名
    const sig = signTx(
      tx,
      privKeyTransfer,
      this.nft.lockingScript.toASM(),
      ScriptHelper.contractSatoshis,
      curInputIndex,
      sighashType
    );

    // 获取Oracle签名
    let sigInfo = await ScriptHelper.satoTxSigUTXOSpendBy(satotxData);
    let script = new bsv.Script(sigInfo.script);
    let preDataPartHex = ScriptHelper.getDataPartFromScript(script);

    // 创建解锁
    let contractObj = this.nft.issue(
      new SigHashPreimage(toHex(preimage)),
      BigInt("0x" + sigInfo.sigBE),
      new Bytes(sigInfo.payload),
      new Bytes(sigInfo.padding),
      new Bytes(preDataPartHex),
      new Bytes(opreturnData ? opreturnData.toHex() : ""),

      new Sig(toHex(sig)),
      new PubKey(toHex(inputOwnerPk)),

      new Bytes(""),
      new Ripemd160(toHex(outputOwnerPkh)),
      ScriptHelper.contractSatoshis,
      new Ripemd160(toHex(changePkh)),
      changeAmount
    );
    if (this.deploy) {
      // unlock other p2pkh inputs
      for (let i = 0; i < curInputIndex; i++) {
        ScriptHelper.unlockP2PKHInput(
          ScriptHelper.privateKey,
          tx,
          i,
          sighashType
        );
      }
      const unlockingScript = contractObj.toScript();
      tx.inputs[curInputIndex].setScript(unlockingScript);
    }

    return contractObj;
  }
}

module.exports = {
  NFT,
  sighashType,
};
