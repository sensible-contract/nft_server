const { bsv } = require("scryptlib");
const { app } = require("../app");
const { ErrCode, Nft } = require("../const");
const { IssuerDao } = require("../dao/IssuerDao");
const { NftDao } = require("../dao/NftDao");
const { UtxoDao } = require("../dao/UtxoDao");
const { NFT } = require("../lib/sensible_nft/NFT");
const {
  ISSUE,
  PayloadNFT,
  TRANSFER,
} = require("../lib/sensible_nft/PayloadNFT");
const { ScriptHelper } = require("../lib/sensible_nft/ScriptHelper");
const { CodeError } = require("../util/CodeError");
const { PrivateKeyMgr } = require("./PrivateKeyMgr");
const { UtxoMgr } = require("./UtxoMgr");
const _ = require("lodash");
class Queue {
  constructor() {
    this.isExecute = false;
    this.list = [];
  }
  add(resolve, reject, params) {
    this.list.push([resolve, reject, params]);
    if (this.isExecute) {
      return;
    }
    this.seqHandle();
  }
  async seqHandle() {
    if (this.list.length == 0) {
      this.isExecute = false;
      return;
    }
    this.isExecute = true;
    const [resolve, reject, params] = this.list.shift();
    try {
      let _res = await NftMgr.issue(
        params.genesisId,
        params.metaTxId,
        params.receiverAddress
      );
      resolve(_res);
    } catch (err) {
      reject(err);
    }
    process.nextTick(() => {
      this.seqHandle();
    });
  }
}
class NftMgr {
  static async genesis(genesisMetaTxId, totalSupply) {
    const nft = new NFT(app.get("nftConfig").satotxPubKey);
    const estimateSatoshis =
      app.get("nftConfig").feeb * 4200 * 1 +
      app.get("nftConfig").contractSatoshis * 1;
    const utxos = [UtxoMgr.fetchUtxo(estimateSatoshis)];
    let tx;
    try {
      const utxoTxId = utxos[0].txId;
      const utxoOutputIndex = utxos[0].outputIndex;
      nft.setTxGenesisPart({
        prevTxId: utxoTxId,
        outputIndex: utxoOutputIndex,
      });

      const issuerPrivKey = new bsv.PrivateKey.fromWIF(
        PrivateKeyMgr.privateKey.toWIF()
      );
      const issuerPk = bsv.PublicKey.fromPrivateKey(issuerPrivKey);
      const issuerPkh = bsv.crypto.Hash.sha256ripemd160(issuerPk.toBuffer());

      const opreturnData = new bsv.Script.buildSafeDataOut(genesisMetaTxId);

      let preUtxoTxHex = await ScriptHelper.blockChainApi.getRawTxData(
        utxoTxId
      );

      tx = new bsv.Transaction().from(
        utxos.map((utxo) => ({
          txId: utxo.txId,
          outputIndex: utxo.outputIndex,
          satoshis: utxo.satoshis,
          script: bsv.Script.buildPublicKeyHashOut(
            ScriptHelper.dummyAddress
          ).toHex(),
        }))
      );
      let txGenesis = await nft.makeTxGenesis({
        tx,
        outputIssuerPkh: issuerPkh,
        outputTokenId: 0,
        totalSupply: totalSupply,
        opreturnData,
      });
      tx.fee(Math.ceil(tx._estimateSize() * app.get("nftConfig").feeb));
      txGenesis.sign(PrivateKeyMgr.privateKey);

      let txid = await ScriptHelper.sendTx(txGenesis);

      await IssuerDao.insertIssuer({
        genesisId: txid,
        genesisTxId: utxoTxId,
        genesisOutputIndex: utxoOutputIndex,
        preTxId: utxoTxId,
        preOutputIndex: utxoOutputIndex,
        preTxHex: preUtxoTxHex,
        txId: txGenesis.id,
        outputIndex: 0,
        txHex: tx.serialize(),
        totalSupply,
        currTokenId: 0,
      });

      utxos.forEach((v) => {
        UtxoDao.removeUtxo(
          PrivateKeyMgr.privateKey.toAddress().toString(),
          v.txId,
          v.outputIndex
        );
      });

      return { genesisId: txid };
    } catch (e) {
      console.error(e);
      if (e.resData) {
        if (
          e.resData.body &&
          e.resData.body.includes("too-long-mempool-chain")
        ) {
          utxos.forEach((v) => {
            v.rootHeight++;
            UtxoDao.updateUtxo(
              PrivateKeyMgr.privateKey.toAddress().toString(),
              v.txId,
              v.outputIndex,
              v
            );
          });
        }
      }
      UtxoMgr.recycleUtxos(utxos);

      // console.error(tx);
      // console.error(tx.serialize());
      throw e;
    } finally {
      UtxoMgr.adjustUtxos();
    }
  }

  static waitIssue(genesisId, metaTxId, receiverAddress) {
    return new Promise((resolve, reject) => {
      this.issueQueue.add(resolve, reject, {
        genesisId,
        metaTxId,
        receiverAddress,
      });
    });
  }
  static async issue(genesisId, metaTxId, receiverAddress) {
    let issuer = await IssuerDao.getIssuer(genesisId);
    if (!issuer) throw new CodeError(ErrCode.EC_GENESISID_INVALID);

    const genesisOutpointTxId = issuer.genesisTxId;
    const genesisOutpointIdx = issuer.genesisOutputIndex;
    const preUtxoTxId = issuer.preTxId;
    const preUtxoOutputIndex = issuer.preOutputIndex;
    const preUtxoTxHex = issuer.preTxHex;
    const spendByTxId = issuer.txId;
    const spendByOutputIndex = issuer.outputIndex;
    const spendByTxHex = issuer.txHex;
    const currTokenId = issuer.currTokenId;

    const nft = new NFT(app.get("nftConfig").satotxPubKey);

    const estimateSatoshis =
      app.get("nftConfig").feeb * 4200 * 3 +
      app.get("nftConfig").contractSatoshis * 3;
    const utxos = UtxoMgr.fetchUtxos(estimateSatoshis);
    console.log("to use utxos", utxos);
    let tx;
    try {
      nft.setTxGenesisPart({
        prevTxId: genesisOutpointTxId,
        outputIndex: genesisOutpointIdx,
      });

      const issuerPrivKey = new bsv.PrivateKey.fromWIF(
        PrivateKeyMgr.privateKey.toWIF()
      );
      const issuerPk = bsv.PublicKey.fromPrivateKey(issuerPrivKey);
      const issuerPkh = bsv.crypto.Hash.sha256ripemd160(issuerPk.toBuffer());

      const address = bsv.Address.fromString(
        receiverAddress,
        app.get("nftConfig").network == "main" ? "livenet" : "testnet"
      );
      const receiver1Pkh = address.hashBuffer;

      let totalSupply = issuer.totalSupply;

      const opreturnData = null;
      // const opreturnData = new bsv.Script.buildSafeDataOut(
      //   JSON.stringify({
      //     issuer: "satoplay.com",
      //     title: "Hello Game NFT",
      //     desc: "issue tokenId " + (currTokenId + 1),
      //     totalSupply,
      //   })
      // );
      ////////////////
      // 创建并解锁issue
      let txIssuePl = new PayloadNFT({
        dataType: ISSUE,
        ownerPkh: issuerPkh,
        tokenId: currTokenId,
        metaTxId,
        totalSupply: totalSupply,
      });

      tx = new bsv.Transaction().from(
        utxos.map((utxo) => ({
          txId: utxo.txId,
          outputIndex: utxo.outputIndex,
          satoshis: utxo.satoshis,
          script: bsv.Script.buildPublicKeyHashOut(
            ScriptHelper.dummyAddress
          ).toHex(),
        }))
      );
      let txIssue = await nft.makeTxIssue(
        tx,
        {
          prevTxId: spendByTxId,
          outputIndex: spendByOutputIndex,
          pl: _.cloneDeep(txIssuePl),
        },
        {
          outputOwnerPkh: receiver1Pkh,
          outputTokenId: currTokenId + 1,
          changeAddress: ScriptHelper.dummyAddress,
          opreturnData,
        }
      );
      tx.fee(
        Math.ceil((tx._estimateSize() + 4200) * app.get("nftConfig").feeb)
      );
      // unlock
      let verifyData = await nft.unlockTxIssue(
        {
          tx: txIssue,
          pl: _.cloneDeep(txIssuePl),
          outputOwnerPkh: receiver1Pkh,
          changePkh: ScriptHelper.dummyPkh,
          opreturnData,
          metaTxId,
        },
        {
          privKeyIssuer: issuerPrivKey,
          publicKeyIssuer: issuerPk,
        },
        {
          index: preUtxoOutputIndex,
          txId: preUtxoTxId,
          txHex: preUtxoTxHex,
          byTxId: spendByTxId,
          byTxHex: spendByTxHex,
        }
      );
      let ret = verifyData.verify();
      if (ret.success == false) {
        console.error(ret);
        throw new CodeError(ErrCode.EC_CONTRACT_VERIFY_FAILED);
      }
      let txid = await ScriptHelper.sendTx(txIssue);

      await IssuerDao.updateIssuer(genesisId, {
        preTxId: spendByTxId,
        preOutputIndex: spendByOutputIndex,
        preTxHex: spendByTxHex,
        txId: txid,
        outputIndex: 0,
        txHex: tx.serialize(),
        currTokenId: currTokenId + 1,
      });

      let dbNft = {
        genesisId,
        genesisTxId: issuer.genesisTxId,
        genesisOutputIndex: issuer.genesisOutputIndex,
        preTxId: spendByTxId,
        preOutputIndex: spendByOutputIndex,
        preTxHex: spendByTxHex,
        txId: txid,
        outputIndex: 1,
        txHex: tx.serialize(),
        tokenId: currTokenId + 1,
        nftId: genesisId + (currTokenId + 1),
      };
      await NftDao.insertNft(dbNft);
      utxos.forEach((v) => {
        UtxoDao.removeUtxo(
          PrivateKeyMgr.privateKey.toAddress().toString(),
          v.txId,
          v.outputIndex
        );
      });
      return {
        nftId: dbNft.nftId,
        txId: txid,
        tokenId: currTokenId + 1,
      };
    } catch (e) {
      console.error(e);
      if (e.resData) {
        if (
          e.resData.body &&
          e.resData.body.includes("too-long-mempool-chain")
        ) {
          utxos.forEach((v) => {
            v.rootHeight++;
            UtxoDao.updateUtxo(
              PrivateKeyMgr.privateKey.toAddress().toString(),
              v.txId,
              v.outputIndex,
              v
            );
          });
        }
      }
      UtxoMgr.recycleUtxos(utxos);

      // console.error(tx);
      // console.error(tx.serialize());
      throw e;
    } finally {
      UtxoMgr.adjustUtxos();
    }
  }

  static async transfer(nftId, receiverAddress, senderWif) {
    let nftUtxo = await NftDao.getNft(nftId);
    if (!nftUtxo) throw new CodeError(ErrCode.EC_NFT_NOT_EXISTED);

    const genesisOutpointTxId = nftUtxo.genesisTxId;
    const genesisOutpointIdx = nftUtxo.genesisOutputIndex;
    const preUtxoTxId = nftUtxo.preTxId;
    const preUtxoOutputIndex = nftUtxo.preOutputIndex;
    const spendByTxId = nftUtxo.txId;
    const spendByOutputIndex = nftUtxo.outputIndex;

    const nft = new NFT(app.get("nftConfig").satotxPubKey);
    const estimateSatoshis =
      app.get("nftConfig").feeb * 4200 * 2 +
      app.get("nftConfig").contractSatoshis * 2;
    const utxos = UtxoMgr.fetchUtxos(estimateSatoshis);
    let tx;
    try {
      nft.setTxGenesisPart({
        prevTxId: genesisOutpointTxId,
        outputIndex: genesisOutpointIdx,
      });

      const senderPrivKey = new bsv.PrivateKey.fromWIF(senderWif);
      const senderPk = bsv.PublicKey.fromPrivateKey(senderPrivKey);
      const senderPkh = bsv.crypto.Hash.sha256ripemd160(senderPk.toBuffer());

      let receiver1Pkh;
      if (receiverAddress) {
        const address = bsv.Address.fromString(
          receiverAddress,
          app.get("nftConfig").network == "main" ? "livenet" : "testnet"
        );
        receiver1Pkh = address.hashBuffer;
      } else {
        receiver1Pkh = Buffer.from(
          "0000000000000000000000000000000000000000",
          "hex"
        );
      }

      let preUtxoTxHex = await ScriptHelper.blockChainApi.getRawTxData(
        preUtxoTxId
      );

      let spendByTxHex = await ScriptHelper.blockChainApi.getRawTxData(
        spendByTxId
      );

      let spendDataPartHex = ScriptHelper.getDataPart(
        spendByTxHex,
        spendByOutputIndex
      );

      let metaTxId = spendDataPartHex.slice(29 * 2, 29 * 2 + 32 * 2);
      const opreturnData = null;
      // const opreturnData = new bsv.Script.buildSafeDataOut(
      //   JSON.stringify({
      //     name: "NFT-EXAMPLE",
      //     desc: `TRANSFER. TOKENID ${nftUtxo.tokenId}`,
      //     issuer: "sensible-nft-cmd",
      //   })
      // );
      ////////////////
      // 创建并解锁issue
      let txTransferPl = new PayloadNFT({
        dataType: TRANSFER,
        ownerPkh: senderPkh,
        tokenId: nftUtxo.tokenId,
        metaTxId,
      });

      tx = new bsv.Transaction().from(
        utxos.map((utxo) => ({
          txId: utxo.txId,
          outputIndex: utxo.outputIndex,
          satoshis: utxo.satoshis,
          script: bsv.Script.buildPublicKeyHashOut(
            ScriptHelper.dummyAddress
          ).toHex(),
        }))
      );
      let txTransfer = await nft.makeTxTransfer(
        tx,
        {
          prevTxId: spendByTxId,
          outputIndex: spendByOutputIndex,
          pl: _.cloneDeep(txTransferPl),
        },
        {
          outputOwnerPkh: receiver1Pkh,
          outputTokenId: nftUtxo.tokenId,
          changeAddress: ScriptHelper.dummyAddress,
          opreturnData,
        }
      );
      tx.fee(
        Math.ceil((tx._estimateSize() + 4200) * app.get("nftConfig").feeb)
      );
      // unlock
      let verifyData = await nft.unlockTxTransfer(
        {
          tx: txTransfer,
          pl: _.cloneDeep(txTransferPl),
          outputOwnerPkh: receiver1Pkh,
          changePkh: ScriptHelper.dummyPkh,
          opreturnData,
        },
        {
          privKeyTransfer: senderPrivKey,
          inputOwnerPk: senderPk,
        },
        {
          index: preUtxoOutputIndex,
          txId: preUtxoTxId,
          txHex: preUtxoTxHex,
          byTxId: spendByTxId,
          byTxHex: spendByTxHex,
        }
      );
      let ret = verifyData.verify();
      if (ret.success == false) {
        console.error(ret);
        throw new CodeError(ErrCode.EC_CONTRACT_VERIFY_FAILED);
      }

      let txid = await ScriptHelper.sendTx(txTransfer);

      NftDao.updateNft(nftUtxo.nftId, {
        preTxId: spendByTxId,
        preOutputIndex: spendByOutputIndex,
        txId: txid,
        outputIndex: 0,
      });
      utxos.forEach((v) => {
        UtxoDao.removeUtxo(
          PrivateKeyMgr.privateKey.toAddress().toString(),
          v.txId,
          v.outputIndex
        );
      });
      return {
        txId: txid,
      };
    } catch (e) {
      console.error(e);
      if (e.resData) {
        if (
          e.resData.body &&
          e.resData.body.includes("too-long-mempool-chain")
        ) {
          utxos.forEach((v) => {
            v.rootHeight++;
            UtxoDao.updateUtxo(
              PrivateKeyMgr.privateKey.toAddress().toString(),
              v.txId,
              v.outputIndex,
              v
            );
          });
        }
      }
      UtxoMgr.recycleUtxos(utxos);

      // console.error(tx);
      // console.error(tx.serialize());
      throw e;
    } finally {
      UtxoMgr.adjustUtxos();
    }
  }
}

NftMgr.issueQueue = new Queue();

module.exports = {
  NftMgr,
};
