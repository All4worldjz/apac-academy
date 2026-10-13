# APAC 领航学院 · 加密站点

站点内容以密文形式发布在 GitHub Pages 上。访问者必须输入用户名和口令，才能在自己的浏览器里解密查看。

## 目录

| 路径 | 作用 |
|---|---|
| `site/index.html` | 登录页：登录、首次强制改口令、把新密钥发布到 GitHub |
| `site/vault.json` | 用口令包裹的内容密钥，不含明文 |
| `site/content.enc.json` | 加密后的学院内容 |
| `tools/vault.mjs` | 本地命令行：初始化、更新内容、改口令、验证 |
| `.github/workflows/pages.yml` | 推送到 main 后自动检查并部署 |
| `plain/` | 本地明文，已被 `.gitignore` 排除，**永远不要提交** |

## 加密方式

- 口令通过 PBKDF2-SHA256（60 万次迭代、随机盐）派生出密钥加密密钥。用户名也参与派生。
- 内容密钥是随机的 AES-256 密钥，由上面派生出的密钥以 AES-256-GCM 包裹后存入 `vault.json`。
- 学院内容先 gzip 压缩，再用内容密钥做 AES-256-GCM 加密，存入 `content.enc.json`。
- 每次改口令都会生成新的内容密钥并重新加密全部内容，旧口令和旧密钥对新文件都无效。
- 口令不会离开浏览器。登录后，内容密钥只保存在当前标签页的 sessionStorage 里；点「锁定」或关闭标签页即失效。

## 第一次部署

1. 在 GitHub 新建仓库，例如 `apac-academy`。**强烈建议设为私有仓库**，原因见下面的安全说明；私有仓库开 Pages 需要 GitHub Pro 或团队版。
2. 把本目录全部文件推送到 `main` 分支（`plain/` 不会被提交）。
3. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
4. 等待 Actions 中「发布加密站点」运行完成，打开站点地址。
5. 用 `all4world` / `passwd123` 登录，系统会强制设置新口令。
6. 在「保存新口令」页选择一种方式：
   - **直接发布到 GitHub**：填写仓库和一个细粒度令牌（Fine-grained PAT，只授予该仓库 Contents 的读写权限）。令牌只在这一次请求中使用，不会被保存。
   - **下载两个文件**：下载 `vault.json` 和 `content.enc.json`，替换仓库 `site/` 下的同名文件后提交。
7. Pages 重新部署后（约 1–2 分钟），旧口令在所有设备上失效。

## 日常操作

```bash
# 更新学院内容（口令从 VAULT_PASS 或交互输入读取）
node tools/vault.mjs update --in plain/academy.html
git add site && git commit -m "Update content" && git push

# 修改口令（同时轮换内容密钥）
node tools/vault.mjs passwd
git add site && git commit -m "Rotate password" && git push

# 验证当前文件能否用口令解密
node tools/vault.mjs verify

# 从站点文件导出明文到本地（不要提交）
node tools/vault.mjs decrypt --out plain/academy.html
```

登录后，页面右上角（电脑上是左下角）有「锁定」和「改口令」两个按钮。改口令和首次登录走同一套流程。

## 安全说明（请务必读）

- **这是静态站点上的客户端加密。** 密文是公开的，安全性完全取决于口令强度，所以新口令至少 10 位、要同时包含字母和数字，越长越好。
- **公开仓库会在 Git 历史里留下初始版本。** 第一次提交的 `vault.json` 用 `passwd123` 包裹，任何人都能从历史记录取回它，并解密当时那一版内容。改口令只保护之后的版本。因此：
  - 最佳做法：使用私有仓库，Pages 站点只对外提供当前文件，历史不可见；
  - 如果必须用公开仓库：先在本地运行 `node tools/vault.mjs passwd` 改好口令再首次推送，或改口令后用一个只含当前文件的新分支重建历史（`git checkout --orphan` 后强制推送）。
- 失败 5 次后，登录页会逐步延长等待时间。但这只是界面层面的限制，真正的保护来自 60 万次迭代的密钥派生。
- 需要按人发放、随时吊销访问权限时，应在 Pages 前面加一层身份认证，例如 Cloudflare Access。
