# sensible_nft_server

## Protocol

【ISSUE 合约-NFT 的定义和发行工具】

```
[code part](variable,end with OP_RETURN(0x6a))
[data part](all 79 bytes)
	[genesis part](all 41 bytes)
		prefix 				(1 bytes)	表示接下来的数据长度：0x28=40
		pre_txid 			(32 bytes) 	溯源txid
		output_index 		(4 bytes) 	溯源outputIndex
		issue_output_index 	(4 bytes)	溯源初始发起的Issue输出的outputIdx
	[payload for ISSUE](all 38 bytes)
		prefix 				(1 bytes)  	表示接下来的数据长度：0x25=37
		issuer_pkh  		(20 bytes)  发行者的pkh
		token_id 			(8 bytes) 	当前发行NFT序号
		total_supply 		(8 bytes) 	最大供应量
		data_type 			(1 bytes)  	协议类型,ISSUE=00,
```

【TRANSFER 合约-实际可进行交易的独立 NFT】

```
[code part](variable,end with OP_RETURN(0x6a))
[data part](all 111 bytes)
	[genesis part](all 41 bytes)
		prefix 				(1 bytes)	表示接下来的数据长度：0x28=40
		pre_txid 			(32 bytes) 	溯源txid
		output_index 		(4 bytes) 	溯源outputIndex
		issue_output_index 	(4 bytes)	溯源初始发起的Issue输出的outputIdx
	[payload for TRANSFER](all 62 bytes)
		prefix 				(1 bytes)  	表示接下来的数据长度：0x3d=61
		token_address 		(20 bytes)  NFT所属的地址
		token_id 			(8 bytes) 	当前的NFT序号
		meta_txid 			(32 bytes)	metaid根节点的txid，表示当前的状态
		data_type 			(1 bytes)  	协议类型,TRANSFER=01
```

## How to Build

```
npm install
npm gen-desc
```

## How to Run

- mongo
- a private key of bitcoin for you
- satotx support

Here is a example for config

```
src/config/nft.json
{
  "default": {
    "wif": "cN2gor4vF2eQ1PmzTzJEwps6uvTK4QToUgTxGHN1xUxZ34djL8vR",//发行私钥
    "apiTarget": "whatsonchain",//可选api：whatsonchain,metasv
    "network": "test",//可选网络：test,main
    "feeb": 0.5,//手续费率
    "minSplit": 80,//utxo最低拆分数量
    "maxSplit": 100,//utxo最大拆分数量
    "unitSatoshis": 10000,//拆分的每个utxo所含金额
    "contractSatoshis": 1000, //合约输出所含金额
    "satotxApiPrefix": "https://api.satotx.com"//签名器API，可以自行部署 https://github.com/sensing-contract/satotx
  },
  "production": {//可以追加其他的配置，在启动的时候需要指定 env=production
    "wif": "xxxxxx",
    "apiTarget": "whatsonchain",
    "network": "main",
    "feeb": 0.5,
    "minSplit": 80,
    "maxSplit": 100,
    "unitSatoshis": 30000,
    "contractSatoshis": 3000,
    "satotxApiPrefix": "https://api.satotx.com"
  }
}
```

and then just run

```
node src/app.js
```

or

```
node src/app.js env=production
```

## <span id="apimethod">Api Method</span>

- [genesis](#genesis)
- [issue](#issue)
- [transfer](#transfer)
- [melt](#melt)

### <span id="genesis">genesis</span>

- params

| param       | required | type   | note           |
| ----------- | -------- | ------ | -------------- |
| metaTxId    | true     | string | metaid         |
| totalSupply | true     | number | max 0xffffffff |

- req

```shell
curl -X POST -H "Content-Type: application/json" --data '{
    "metaTxId":"e624fd69683d27c48982e3e62e1e73b276e7b4c7763c514c00091cbcff19f700",
    "totalSupply":100
}' http://127.0.0.1:8092/api/nft/genesis
```

- rsp

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "genesisId": "fd7117f26c7fedb2a5e9bb17ed94f42142e2f2d51cd6b80e25cb7874625dadd5"
  }
}
```

### <span id="issue">issue</span>

- params

| param           | required | type   | note             |
| --------------- | -------- | ------ | ---------------- |
| genesisId       | true     | string | genesisId        |
| metaTxId        | true     | string | metaid           |
| receiverAddress | true     | string | receiver address |

- req

```shell
curl -X POST -H "Content-Type: application/json" --data '{
    "genesisId":"fd7117f26c7fedb2a5e9bb17ed94f42142e2f2d51cd6b80e25cb7874625dadd5",
    "metaTxId":"5465e83661f189fe2ae2389a98bc9eca3170a39a1a2912d541b25b4f4660f475",
    "receiverAddress":"mpYgjTbJ6aKx9m26ZHoGfQ5VyE2nWyDiVT"
}' http://127.0.0.1:8092/api/nft/issue
```

- rsp

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "nftId": "fd7117f26c7fedb2a5e9bb17ed94f42142e2f2d51cd6b80e25cb7874625dadd51",
    "txId": "f386bbf17a82047694e19f4fdc7ea209b66bb10ce7fdb31e1afd755a95e93f00"
  }
}
```

### <span id="transfer">transfer</span>

- params

| param           | required | type   | note             |
| --------------- | -------- | ------ | ---------------- |
| nftId           | true     | string | nftId            |
| senderWif       | true     | string | sender wif       |
| receiverAddress | true     | string | receiver address |

- req

```shell
curl -X POST -H "Content-Type: application/json" --data '{
    "nftId":"fd7117f26c7fedb2a5e9bb17ed94f42142e2f2d51cd6b80e25cb7874625dadd51",
    "senderWif":"cN2gor4vF2eQ1PmzTzJEwps6uvTK4QToUgTxGHN1xUxZ34djL8vR",
    "receiverAddress":"mpYgjTbJ6aKx9m26ZHoGfQ5VyE2nWyDiVT"
}' http://127.0.0.1:8092/api/nft/transfer
```

- rsp

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "txId": "4d83502c13568c24485a2af9bfb5dd5cd764232c9b8b11b287151d10b6995810"
  }
}
```

### <span id="melt">melt</span>

- params

| param     | required | type   | note       |
| --------- | -------- | ------ | ---------- |
| nftId     | true     | string | nftId      |
| senderWif | true     | string | sender wif |

- req

```shell
curl -X POST -H "Content-Type: application/json" --data '{
    "nftId":"fd7117f26c7fedb2a5e9bb17ed94f42142e2f2d51cd6b80e25cb7874625dadd51",
    "senderWif":"cN2gor4vF2eQ1PmzTzJEwps6uvTK4QToUgTxGHN1xUxZ34djL8vR"
}' http://127.0.0.1:8092/api/nft/melt
```

- rsp

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "txId": "b584e8250a48b4034059c9dee5829393e403666f6872e82a69b89f79c886a3fa"
  }
}
```
