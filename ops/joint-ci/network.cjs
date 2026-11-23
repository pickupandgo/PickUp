'use strict';
const assert = require('node:assert/strict');
const net = require('node:net');
const dgram = require('node:dgram');
function blocked(host, port) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    s.once('connect', () => {
      s.destroy();
      reject(new Error('FORBIDDEN_NETWORK_ACCESS'));
    });
    s.once('error', () => {
      s.destroy();
      resolve();
    });
    s.setTimeout(800, () => {
      s.destroy();
      resolve();
    });
  });
}
(async () => {
  const targets = [
    ['1.1.1.1', 443],
    ['169.254.169.254', 80],
    ['172.29.63.1', 80],
    ['127.0.0.11', 53],
    ['2606:4700:4700::1111', 443],
  ];
  for (const [h, p] of targets) await blocked(h, p);
  await new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    const timeout = setTimeout(() => {
      s.close();
      resolve();
    }, 800);
    s.on('message', () => {
      clearTimeout(timeout);
      s.close();
      reject(new Error('DNS_ESCAPED'));
    });
    s.on('error', () => {
      clearTimeout(timeout);
      s.close();
      resolve();
    });
    // Fixed DNS query for example.invalid. Never send production account names.
    s.send(
      Buffer.from(
        '123401000001000000000000076578616d706c6507696e76616c69640000010001',
        'hex',
      ),
      53,
      '127.0.0.11',
    );
  });
  console.log(
    JSON.stringify({
      result: 'PASS',
      negative_network_checks: targets.length + 1,
      Internet: false,
      metadata: false,
      host_gateway: false,
      Docker_DNS: false,
      IPv6: false,
    }),
  );
})().catch(() => {
  console.error('NETWORK_ISOLATION_FAILED');
  process.exitCode = 1;
});
