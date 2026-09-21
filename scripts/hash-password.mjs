#!/usr/bin/env node
// 生成管理员密码的 sha256，用于写入 .dev.vars 或 wrangler secret put。
//
//   npm run hash-password -- 你的密码
//
// 之所以不在环境变量里直接放明文密码：即使 secret 泄露，也不会直接暴露密码本身。
import { createHash } from 'node:crypto';

const password = process.argv[2];

if (!password) {
  console.error('用法: npm run hash-password -- <密码>');
  process.exit(1);
}

console.log(createHash('sha256').update(password).digest('hex'));
