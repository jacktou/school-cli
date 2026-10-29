# school-cli

School.fun AI Agent 命令行（纸盘优先）。技能契约来自旁路仓库 `school-skills/skills.json`，本仓不改写 skills。

登录交互对齐 **OKX Agentic Wallet**：Agent 驱动 `school login` → 浏览器完成 Privy → 本地 callback 收 token → 换 gateway JWT。**用户不用开 DevTools，也不要把 token 贴进聊天。**

## 安装 / 运行

```bash
cd /workspace/school-cli   # 或你的本地目录
npm install                # 当前无第三方依赖，可跳过
npm link                   # 全局得到 `school` 命令
# 或不 link：
node bin/school.js --help
```

## 命令

| 命令 | 说明 |
|------|------|
| `school login` | **Live（产品路径）**：本地起 callback → 打印 `loginUrl` → 打开浏览器 → poll 到完成 |
| `school login --init` | 只 init：后台起登录页，打印 `{ loginUrl, sessionId, expires_at }` 给 Agent |
| `school login --poll --session <id>` | 等该 session 完成（或超时） |
| `school login --paper` | 本地 paper session（stub 地址） |
| `school login --token <T>` | **DEBUG/DEV ONLY**：用手持 Privy token 换 JWT（也可用 `PRIVY_TOKEN`） |
| `school logout` | 清除本地 session |
| `school status [--probe]` | `mode` / `auth` / `has_jwt` / `expires_at` / `last_call`（**不打印 jwt**）；`--probe` 打 `GET /time` |
| `school gateway time` | 探测 `GET {SCHOOL_API_BASE}/time` |
| `school gateway markets` | 探测 `GET {SCHOOL_API_BASE}/query/markets` |
| `school skills list` | 读取 skills.json |
| `school skills run <id> [--input JSON]` | 跑 P0 skill；`trade_paper` 仅本地模拟 |

P0 skill：`alpha_radar` · `alpha_transcript` · `token_security` · `trade_quote` · `trade_paper` · `vault_list`  
登录映射：`school login` → `wallet_login`（CLI/auth，不算业务 skill）

### 必填 `--input` 字段

| skill | 必填 | 示例 |
|-------|------|------|
| `token_security` | `ca` | `--input '{"ca":"So1111…"}'` |
| `trade_quote` / `trade_paper` | `pair`, `side`, `size` | `--input '{"pair":"SOL/USDC","side":"buy","size":1}'` |

别名（仅当规范字段缺失时映射）：`mint`→`ca`，`amount`→`size`，`token`→`pair`。不会为必填字段编造默认值。

## Agent 登录流（产品）

对标 OKX `onchainos wallet login` 的 init / poll：

```bash
# 同进程：先打出 phase=init（含 loginUrl），再阻塞直到完成
school login
# stdout 先：
# { "ok": true, "phase": "init", "loginUrl": "http://127.0.0.1:<port>/login", "sessionId": "...", "expires_at": "..." }
# 用户点开 loginUrl，在浏览器完成 Privy
# stdout 再：
# { "ok": true, "phase": "done", "mode": "live", "auth": "jwt", "has_jwt": true, ... }  # 从不回显 jwt / privy token

# 或拆成两步（Agent 更灵活）：
school login --init
# → 把 loginUrl 发给用户
school login --poll --session <sessionId>
```

- `school status` 可查是否已登录 / 是否过期（只看 `has_jwt` / `expires_at`，不打印密钥）。
- **交易确认（后续）**：`trade_quote` 先出预览卡，用户明确「确认」再签名（OKX Confirming）；本 CLI 暂不下单。

### 限制（已知）

- 本地登录页会带 `?school_cli_callback=http://127.0.0.1:.../callback` 打开 school.fun；**站点若尚未支持该 deep link，需产品侧补回调**。届时页面仍可在带 `#token=` / `?privy_token=` 的回跳下把凭证 POST 到本机 callback。
- 没有凭证时 CLI **不会伪造** token / JWT。

## paper vs live

- **paper**：`school login --paper` — 本地 session + mock；`trade_paper` **永不签名、不上链**。
- **live**：浏览器 Privy → 本地 callback → `POST {SCHOOL_API_BASE}/auth/privy` → 存 gateway JWT。只读探测可用 `school gateway time`（无需登录）。

### 环境变量

| 变量 | 默认（来自 school.fun 网页公开捕获） | 说明 |
|------|--------------------------------------|------|
| `SCHOOL_API_BASE` | `https://school.fun/dex/gateway/v1` | Gateway 前缀 |
| `PRIVY_APP_ID` | `cmub8c7cw00p30bjwjmplktib` | Privy App ID（公开） |
| `SCHOOL_ORG_ID` | `org_cnbdq6b0jcUhF5KM` | `x-org-id` |
| `SCHOOL_TENANT_ID` | `tnt_FaMPg11lEX98rTYW` | `x-tenant-id` |
| `KUANT_API_BASE` | `https://api.kuant.ai` | 后续 `token_security` |
| `SCHOOL_LOGIN_TIMEOUT_MS` | `240000` | 浏览器登录超时 |
| `SCHOOL_LOGIN_NO_OPEN` | — | `1` = 不自动 `xdg-open`/`open` |
| `PRIVY_TOKEN` | — | **DEBUG ONLY** |
| `SCHOOL_JWT` | — | 可选：临时叠加 Bearer |
| `SCHOOL_SKILLS_PATH` | `../school-skills/skills.json` | skills 契约 |
| `SCHOOL_CLI_CONFIG` | `~/.school-cli/config.json` | session 文件 |

## 测试

```bash
npm test
# 等同于：node scripts/smoke.js
# paper 路径离线绿；live init 只断言 loginUrl 形状 + 本地 server（可用 SCHOOL_LOGIN_DRY_RUN=1）
```

### 试一下

```bash
# paper
school login --paper
school status
npm test

# live（产品）：Agent 展示 loginUrl，用户浏览器登录
school login --no-open          # 或默认自动打开
# / school login --init && school login --poll --session …

# 只读探测（无需 JWT）
school gateway time
school status --probe

# DEBUG ONLY（不要当产品文档教用户）
# school login --token '<privy_jwt>'
```

## 与 Design 对齐

状态条：`mode` · `auth`（`jwt`|null，**不是** API Key）· `has_jwt` · `expires_at` · `last_call`。旧字段 `key` 已弃用并固定为 `null`。登录卡：「打开登录页 → 等待完成」，无「粘贴 token」。
