#!/usr/bin/env node
// 站点加密工具：与 site/index.html 使用同一套格式（PBKDF2-SHA256 → AES-256-GCM 包裹内容密钥，内容 gzip 后 AES-256-GCM 加密）
// 用法：
//   node tools/vault.mjs init    --in plain/academy.html [--user all4world] [--pass passwd123]   初始化，首次登录强制改口令
//   node tools/vault.mjs update  --in plain/academy.html                                         用现有口令更新内容（口令从 VAULT_PASS 或交互输入读取）
//   node tools/vault.mjs passwd                                                                  修改口令并轮换内容密钥
//   node tools/vault.mjs verify                                                                  用口令解密验证
//   node tools/vault.mjs decrypt --out plain/academy.html                                        解密导出明文（只在本地使用）
// 通用参数：--site site（站点目录，默认 site）
import { webcrypto as crypto } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline';

const ITER = 600000;
const te = new TextEncoder(), td = new TextDecoder();
const b64e = u8 => Buffer.from(u8).toString('base64');
const b64d = s => new Uint8Array(Buffer.from(s, 'base64'));
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const aadWrap = u => te.encode('apac-vault/v1/wrap/' + u);
const AAD_C = te.encode('apac-vault/v1/content');

const args = process.argv.slice(2);
const cmd = args[0];
const opt = k => { const i = args.indexOf('--' + k); return i > 0 ? args[i + 1] : undefined; };
const SITE = opt('site') || 'site';
const VAULT = join(SITE, 'vault.json'), CONTENT = join(SITE, 'content.enc.json');

async function kek(user, pass, salt, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(user + '\u0000' + pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}
async function unwrapDek(v, user, pass) {
  const k = await kek(user, pass, b64d(v.kdf.salt), v.kdf.iter);
  return crypto.subtle.unwrapKey('raw', b64d(v.wrap.ct), k, { name: 'AES-GCM', iv: b64d(v.wrap.iv), additionalData: aadWrap(v.user) }, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}
async function makeVault(user, pass, dek, mustChange) {
  const salt = rnd(16), iv = rnd(12);
  const k = await kek(user, pass, salt, ITER);
  const w = await crypto.subtle.wrapKey('raw', dek, k, { name: 'AES-GCM', iv, additionalData: aadWrap(user) });
  return { v: 1, user, kdf: { name: 'PBKDF2', hash: 'SHA-256', iter: ITER, salt: b64e(salt) }, wrap: { alg: 'AES-256-GCM', iv: b64e(iv), ct: b64e(new Uint8Array(w)) }, mustChange: !!mustChange, updated: new Date().toISOString() };
}
async function encryptContent(html, dek) {
  const iv = rnd(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD_C }, dek, gzipSync(te.encode(html), { level: 9 }));
  return { v: 1, alg: 'AES-256-GCM', gz: true, iv: b64e(iv), ct: b64e(new Uint8Array(ct)) };
}
async function decryptContent(c, dek) {
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(c.iv), additionalData: AAD_C }, dek, b64d(c.ct)));
  return td.decode(c.gz ? gunzipSync(pt) : pt);
}
const newDek = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
const readJSON = p => JSON.parse(readFileSync(p, 'utf8'));
function write(vault, content) {
  mkdirSync(SITE, { recursive: true });
  if (vault) writeFileSync(VAULT, JSON.stringify(vault, null, 2) + '\n');
  if (content) writeFileSync(CONTENT, JSON.stringify(content) + '\n');
}
function ask(q, hidden) {
  return new Promise(res => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(q)) process.stdout.write(s); };
    rl.question(q, a => { rl.close(); if (hidden) process.stdout.write('\n'); res(a); });
  });
}
async function currentPass() { return process.env.VAULT_PASS ?? opt('pass') ?? await ask('当前口令：', true); }
function strong(p, user, old) {
  return p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p) && p !== old && p !== 'passwd123' && !p.toLowerCase().includes(user.toLowerCase());
}
function guardPlain(html) {
  if (!/<html|<body|<script/i.test(html)) throw new Error('输入文件看起来不是 HTML');
}

async function main() {
  if (cmd === 'init') {
    const inp = opt('in'); if (!inp) throw new Error('缺少 --in');
    const user = opt('user') || 'all4world', pass = opt('pass') || 'passwd123';
    if (existsSync(VAULT) && !args.includes('--force')) throw new Error(VAULT + ' 已存在；如确需重新初始化，请加 --force');
    const html = readFileSync(inp, 'utf8'); guardPlain(html);
    const dek = await newDek();
    write(await makeVault(user, pass, dek, true), await encryptContent(html, dek));
    console.log(`已初始化 ${SITE}/：用户名 ${user}，首次登录必须修改口令。`);
  } else if (cmd === 'update') {
    const inp = opt('in'); if (!inp) throw new Error('缺少 --in');
    const v = readJSON(VAULT), html = readFileSync(inp, 'utf8'); guardPlain(html);
    const dek = await unwrapDek(v, v.user, await currentPass()).catch(() => { throw new Error('口令不正确'); });
    write(null, await encryptContent(html, dek));
    console.log('内容已用现有密钥重新加密：' + CONTENT);
  } else if (cmd === 'passwd') {
    const v = readJSON(VAULT), c = readJSON(CONTENT);
    const old = await currentPass();
    const dek = await unwrapDek(v, v.user, old).catch(() => { throw new Error('口令不正确'); });
    const html = await decryptContent(c, dek);
    const np = process.env.VAULT_NEW_PASS ?? opt('new') ?? await ask('新口令：', true);
    if (!strong(np, v.user, old)) throw new Error('新口令至少 10 位，需同时包含字母和数字，不能等于旧口令或包含用户名');
    if (!process.env.VAULT_NEW_PASS && !opt('new') && np !== await ask('再输入一次：', true)) throw new Error('两次输入不一致');
    const d2 = await newDek();
    write(await makeVault(v.user, np, d2, false), await encryptContent(html, d2));
    console.log('口令已修改，内容密钥已轮换。');
  } else if (cmd === 'verify') {
    const v = readJSON(VAULT), c = readJSON(CONTENT);
    const dek = await unwrapDek(v, v.user, await currentPass()).catch(() => { throw new Error('口令不正确'); });
    const html = await decryptContent(c, dek);
    console.log(`验证通过：用户 ${v.user}，强制改口令=${v.mustChange}，更新于 ${v.updated}，明文 ${html.length} 字符。`);
  } else if (cmd === 'decrypt') {
    const out = opt('out'); if (!out) throw new Error('缺少 --out');
    const v = readJSON(VAULT), c = readJSON(CONTENT);
    const dek = await unwrapDek(v, v.user, await currentPass()).catch(() => { throw new Error('口令不正确'); });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, await decryptContent(c, dek));
    console.log('已导出明文到 ' + out + '（不要提交到仓库）');
  } else {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).join('\n'));
    process.exit(cmd ? 1 : 0);
  }
}
main().catch(e => { console.error('错误：' + e.message); process.exit(1); });
