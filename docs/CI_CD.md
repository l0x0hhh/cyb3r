# GitHub Actions 自动部署

目标：推送 `main` → CI 测试和构建通过 → SSH 发布同一个完整提交 SHA → 健康检查。PR 只检查，首次配置完成前部署任务跳过。当前生产目标是 `ubuntu@43.138.146.44`，公网入口为 `https://cyb3r.art`。

本地实现不等于已启用：必须先提交所需改动、配置服务器入口与 GitHub Secrets，然后打开 `CD_ENABLED`。不要将密码、私钥、数据库或真实借用记录提交到 Git。

## 1. 发布如何工作

- CI 在 GitHub 托管的 Linux runner 上使用 Node.js 22.x、锁文件安装、串行测试及 Vite 构建。
- 部署 job 依赖 `verify` 成功，只允许 `main` 的 push 或手动运行；不为 PR 提供部署密钥。不设每次人工审批。
- GitHub 使用 `device-deploy` 账号连接服务器。该密钥只有固定的 `deploy <SHA>` 入口，不能打开 shell、上传文件或转发端口。现有 `ubuntu` 管理账号不受影响。
- 服务器用原有的只读 GitHub Deploy Key 拉取 `main`，确认 SHA 属于该历史，只构建请求的 SHA；晚到的旧提交不会覆盖已经发布的新提交。
- 源码从 Git 归档到 `/opt/device-management-releases/<SHA>-<时间>-<随机值>`，以 `deviceapp` 安装依赖和构建。准备失败时旧应用继续运行。不会上传本地 `frontend/dist` 或 `node_modules`。
- 准备完成后短暂停止应用，把 `/opt/device-management` 切为新版本的符号链接，再启动和检查 `/borrow`、`/admin`、`/api/categories`。应用重启会清空内存登录会话，需要重新登录。
- 首次发布把原应用整目录保留为 releases 下的 `legacy-*`，后续每次保留上一版源码和依赖。构建完成前不移动旧目录。
- 切换或健康检查失败会尝试恢复旧代码链接并启动旧版，发布任务仍显示失败；恢复失败会明确报告 `ROLLBACK FAILED`。强制杀进程、断电等不能保证自动恢复，需管理员检查目录链接和服务。
- `/var/lib/device-management`、`/etc/device-management.env`、Nginx 和证书不会被发布脚本复制、覆盖或回滚。代码回退不撤销数据库写入；不兼容数据库迁移必须单独安排，不能依赖代码回退恢复数据。
- 两层锁防止并发发布。旧版本暂不自动删除，磁盘可用不足 1 GiB 会在停机前拒绝发布；需定期核对 `readlink -f /opt/device-management`、发布日志中的上一版路径及 `du -sh /opt/device-management-releases/*`，人工保留当前和上一版后再清理确定无用的版本。不要删除 `legacy-*` 中唯一的历史备份。

## 2. 首次提交前

当前工作区有其他未提交的功能改动。先审核 `git status` 和差异，决定本次发布包含哪些已完成的代码；不要使用 `git add .` 自动混入所有文件。CI/CD 涉及文件见本次交付清单。

GitHub `main` 中必须包含完整、相互匹配的前端配置、组件和 package 锁文件；只提交引用新组件的配置而遗漏组件会让 CI 构建失败。CI 不通过不会触发发布。

本次按用户要求不在本地执行测试或构建，首轮 GitHub Actions 结果仍需确认。

## 3. 在自己的电脑生成专用密钥并上传初始化文件

PowerShell，在项目根目录执行：

```powershell
Set-Location 'E:\AIstudy\设备管理'
$cdKey = Join-Path $env:USERPROFILE '.ssh\device-management-cd'
if ((Test-Path -LiteralPath $cdKey) -or (Test-Path -LiteralPath "$cdKey.pub")) { throw '专用密钥文件已存在，请先确认用途，勿覆盖。' }
New-Item -ItemType Directory -Force -Path (Split-Path $cdKey) | Out-Null
ssh-keygen -t ed25519 -f $cdKey -C 'device-management-github-actions'
```

这是专用于无人值守发布的密钥；询问 passphrase 时直接回车，确认时再回车。私钥只保存在本机和 GitHub Secret，上传服务器的是 `.pub` 公钥。不要把个人日常 SSH 私钥复用于这里。

```powershell
ssh ubuntu@43.138.146.44 'install -d -m 0700 /home/ubuntu/device-cd-bootstrap-20261020-01/deploy'
scp deploy/update-from-git.sh deploy/setup-cd.sh ubuntu@43.138.146.44:/home/ubuntu/device-cd-bootstrap-20261020-01/deploy/
scp "$cdKey.pub" ubuntu@43.138.146.44:/home/ubuntu/device-management-cd.pub
```

首次连接核对新腾讯云主机指纹；不关闭 SSH 主机校验。`.gitattributes` 已固定脚本为 LF；如果从其他编辑器复制后出现 `\r` 错误，核对文件换行后只重传这两个脚本。

## 4. 新腾讯云一次性安装发布入口

在 `ubuntu@43.138.146.44` 上执行：

```bash
sudo apt-get update
sudo apt-get install -y git curl util-linux sudo
sudo bash /home/ubuntu/device-cd-bootstrap-20261020-01/deploy/setup-cd.sh \
  /home/ubuntu/device-management-cd.pub
```

脚本检查现有生产数据库、运行用户、GitHub 只读密钥，然后安装：

| 位置 | 用途 |
| --- | --- |
| `/usr/local/sbin/device-management-deploy` | root 所有的固定发布入口 |
| `/usr/local/bin/device-management-cd-command` | 校验 SSH 原始命令和 SHA |
| `/home/device-deploy/.ssh/authorized_keys` | 发布专用公钥，强制命令并禁用转发/终端 |
| `/etc/sudoers.d/device-management-cd` | 仅允许调用固定发布入口，入口再次限制参数 |

不会在这一步重启应用、修改域名或 Nginx。若提示 `/var/lib/device-management/.ssh/github_deploy` 或 `known_hosts` 缺失，先排查迁移后的原只读 GitHub Deploy Key；它和刚生成的“GitHub → 服务器”部署密钥方向不同。不要替换为个人私钥，也不要关闭主机校验。

安装末尾会输出 `43.138.146.44 ssh-ed25519 ...`，这是直接读取本机公钥生成的 known_hosts 行，用于下一步。不要用未经核实的 `ssh-keyscan` 输出代替。

## 5. 配置 GitHub

仓库 `l0x0hhh/cyb3r` → **Settings → Secrets and variables → Actions**。使用 Repository Secrets / Variables，不要求私有仓库具有 Environments 功能。入口与字段可对照 [GitHub 官方 Secrets 文档](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)。

Secrets 页分别添加：

| 名称 | 值 |
| --- | --- |
| `DEPLOY_PRIVATE_KEY` | 本机新生成的 `device-management-cd` 私钥完整内容（含 BEGIN/END 行） |
| `DEPLOY_KNOWN_HOSTS` | 上一步服务器输出的 `43.138.146.44 ssh-ed25519 ...` 整行 |

在本机 PowerShell 复制私钥到剪贴板后直接粘贴到 Secret，不发送到聊天：

```powershell
Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.ssh\device-management-cd') -Raw | Set-Clipboard
```

Variables 页添加：

| 名称 | 值 |
| --- | --- |
| `DEPLOY_HOST` | `43.138.146.44`（可省略，工作流默认此地址） |
| `CD_ENABLED` | `true`（确认服务器入口和两个 Secrets 都就绪后才设置） |

腾讯云防火墙和系统防火墙必须允许 GitHub runner 访问 SSH 22；如果目前仅允许个人 IP，连接会超时，需要按实际网络策略调整。80/443 与现有 HTTPS 保持原样，不开放应用 3000。不在生产服务器安装自托管 runner。

## 6. 首次触发与日常使用

把审核后的所需改动提交并推送 `main`。若代码早已推送、现在才打开开关，进入 **Actions → CI → Run workflow → main** 触发。

成功应看到 `verify`、`deploy` 两个 job 都通过，SSH 日志包含 `Deployment completed at <本次 SHA>`。`Already deployed` 是幂等重试；`Skipping stale deployment` 表示请求已过时，并未重新发布。仅 CI 绿灯但部署 skipped 不代表已部署，应检查开关和触发分支。

日常操作：

```powershell
git status
# 按实际改动逐文件 git add，确认差异后提交。
git commit -m '描述本次修改'
git push origin main
```

在 Actions 中查看发布结果，并人工验收桌面端和手机端、登录、借还、图片及邮件。不在生产服务占用 3000 时运行 `npm test`。

服务器排查：

```bash
readlink -f /opt/device-management
sudo systemctl status device-management --no-pager
sudo journalctl -u device-management -n 60 --no-pager
curl --noproxy '*' -fI http://127.0.0.1:3000/borrow
```

## 7. 停用、失败恢复与更新发布工具

临时停用自动部署：把仓库变量 `CD_ENABLED` 设为 `false`，后续 CI 照常运行，部署跳过。这不会取消已经开始的发布；等已运行任务结束后再维护。

切换失败但日志显示已恢复上一版时，检查旧版健康情况，修复代码后推送一个新提交，不要覆盖数据库。如果日志显示 `ROLLBACK FAILED`，先保全 `/var/lib/device-management`，检查应用符号链接、日志与旧版本路径，人工恢复代码；不要重新初始化数据或回切旧服务器。

安装后的发布工具是 root 所有的固定快照。以后修改 `deploy/update-from-git.sh` 或 `deploy/setup-cd.sh`，推送仅更新版本里的源码，不会自动修改 `/usr/local`、sudoers、Nginx、systemd 或密钥。管理员须审核后按第 3、4 节重新上传这两个文件并运行 setup-cd.sh（同一公钥会重新安装，换公钥会替换原部署授权），再触发 CI；不要在发布进行中重新安装。

手工重试仅使用已经通过 CI 的完整 SHA：

```bash
sudo /usr/local/sbin/device-management-deploy <40位已通过CI的提交SHA>
```

此入口同样拒绝旧版本覆盖新版和分叉历史。需要主动回退时优先把代码修复或 `git revert` 为新的 main 提交并通过 CI；不要用 `git reset --hard` 改动生产目录，更不要恢复旧数据库覆盖新借还记录。
