const { Logger } = require("hns-logger-plugin");
const { Http } = require("hns-http-plugin");
const { Dao } = require("hns-dao-plugin");
const { Application } = require("hns-app");
exports.app = new Application();
var app = exports.app;
(async () => {
  try {
    app.loadConfig("loggerConfig", require("./config/logger.json"));
    app.logger = new Logger(app, app.get("loggerConfig"));
    app.logger.replaceConsole();

    app.loadConfig("daoConfig", require("./config/dao.json"));
    app.dao = new Dao(app, app.get("daoConfig"));
    await app.dao.init();

    app.loadConfig("httpConfig", require("./config/http.json"));
    app.http = new Http(app, app.get("httpConfig"));
    app.http.setExceptionHandler((req, res, e) => {
      let errString;
      if (typeof e == "string") {
        errString = e;
        console.error(e);
      } else {
        errString = e.message;
        console.setStack(e.stack).error(e.message);
      }

      res.json({
        code: 500,
        message: errString,
      });
    });

    app.http.start();

    //todo
    const { PrivateKeyMgr } = require("./domain/PrivateKeyMgr");
    const { AES } = require("./lib/crypto");
    app.loadConfig("nftConfig", require("./config/nft.json"));
    let wif = app.get("nftConfig").wif;
    if (!wif) {
      let cryptedWif = app.get("nftConfig").cryptedWif;
      wif = AES.decrypt_aes(cryptedWif, process.env.WIF_PWD);
    }
    PrivateKeyMgr.init(wif);

    const { ScriptHelper } = require("./lib/sensible_nft/ScriptHelper");
    const { BlockChainApi, API_NET } = require("./lib/blockchain-api");
    ScriptHelper.prepare(
      new BlockChainApi(
        app.get("nftConfig").apiTarget,
        app.get("nftConfig").network == "main" ? API_NET.MAIN : API_NET.TEST
      ),
      PrivateKeyMgr.privateKey,
      app.get("nftConfig").contractSatoshis,
      app.get("nftConfig").satotxApiPrefix
    );

    const { UtxoMgr } = require("./domain/UtxoMgr");
    await UtxoMgr.loadUtxos();

    console.log("start completed");
  } catch (e) {
    console.error("start failed", e);
  }
})();
