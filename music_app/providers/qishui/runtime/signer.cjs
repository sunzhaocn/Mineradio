// 使用本机已安装汽水客户端的请求签名 SDK；不涉及媒体加密/解密。
// 输入只走 stdin，签名只由父进程读取，不把 Cookie 放进命令行。
const fs = require('node:fs');
const path = require('node:path');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const directory = input.sdkDirectory;
process.env.PATH = directory + path.delimiter + process.env.PATH;
const sdk = require(path.join(directory, 'bdms.node'));
sdk.init({ deviceId: input.deviceId });
let attempts = 0;
function sign() {
  const output = sdk.generateHttpSignatureHeaders(input.url, input.headers || '');
  if (!output && ++attempts < 20) return setTimeout(sign, 100);
  // Avoid Node's Socket-based stdout wrapper under Wine's inherited pipes.
  fs.writeSync(1, '\nQISHUI_SIGNATURE:' + JSON.stringify({output}) + '\n');
  process.exit(0);
}
sign();
