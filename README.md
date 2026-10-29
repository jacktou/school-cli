# school-cli

School.fun AI Agent 命令行（纸盘优先）。技能契约来自旁路仓库 `school-skills/skills.json`，本仓不改写 skills。

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
| `school login --paper` | Privy **本地 stub**：写入 paper session |
| `school login --privy [--token T]` | 用 Privy access token 换 gateway JWT（需真 token，不编造） |
| `school logout` | 清除本地 session |
| `school status [--probe]` | 输出 `mode` / `auth` / `has_jwt` / `expires_at` / `last_call`；`--probe` 打 `GET /time` |
| `school gateway time` | 探测 `GET {SCHOOL_API_BASE}/time` |
| `school gateway markets` | 探测 `GET {SCHOOL_API_BASE}/query/markets`（带 org/tenant） |
| `school skills list` | 读取 skills.json，打印 id · group · title |
| `school skills run <id> [--input JSON]` | 跑 P0 skill；`trade_paper` 仅本地模拟成交 |

P0 skill：`alpha_radar` · `alpha_transcript` · `token_security` · `trade_quote` · `trade_paper` · `vault_list`  
登录映射：`school login` → `wallet_login`（CLI/auth，不算业务 skill）

### 必填 `--input` 字段

| skill | 必填 | 示例 |
|-------|------|------|
| `token_security` | `ca` | `--input '{"ca":"So1111…"}'` |
| `trade_quote` / `trade_paper` | `pair`, `side`, `size` | `--input '{"pair":"SOL/USDC","side":"buy","size":1}'` |

别名（仅当规范字段缺失时映射）：`mint`→`ca`，`amount`→`size`，`token`→`pair`。不会为必填字段编造默认值。

## 测试

```bash
npm test
# 等同于：node scripts/smoke.js
# 使用 fixtures/skills.json + 临时 SCHOOL_CLI_CONFIG，不污染 ~/.school-cli
```

## paper vs live

- **paper（默认）**：本地 session + mock/模拟结果；`trade_paper` **永不签名、不上链**。
- **live**：`school login --privy` 需要浏览器/设备拿到的 **Privy access token**，再 `POST {SCHOOL_API_BASE}/auth/privy` 换 gateway JWT。没有 token 时 CLI 只打印用法，**不会伪造凭证**。不下单、不调 order 接口。

### 环境变量

| 变量 | 默认（来自 school.fun 网页公开捕获） | 说明 |
|------|--------------------------------------|------|
| `SCHOOL_API_BASE` | `https://school.fun/dex/gateway/v1` | Gateway 前缀 |
| `PRIVY_APP_ID` | `cmub8c7cw00p30bjwjmplktib` | Privy App ID（公开） |
| `SCHOOL_ORG_ID` | `org_cnbdq6b0jcUhF5KM` | `x-org-id` |
| `SCHOOL_TENANT_ID` | `tnt_FaMPg11lEX98rTYW` | `x-tenant-id` |
| `KUANT_API_BASE` | `https://api.kuant.ai` | 后续 `token_security` |
| `PRIVY_TOKEN` | — | `login --privy` 用的 Privy access token |
| `SCHOOL_JWT` | — | 可选：临时叠加 Bearer（不经 login 写入） |
| `SCHOOL_SKILLS_PATH` | `../school-skills/skills.json` | skills 契约 |
| `SCHOOL_CLI_CONFIG` | `~/.school-cli/config.json` | session 文件 |

### 试一下

```bash
# paper 冒烟
school login --paper
school status
npm test

# live 骨架（缺 token 时打印说明，exit 1）
school login --privy

# 有 Privy access token 时：
PRIVY_TOKEN='<from browser>' school login --privy
# 或
school login --privy --token '<from browser>'

# 只读探测（无需 JWT）
school gateway time
school status --probe
```

## 与 Design 对齐

状态条：`mode` · `auth`（`jwt`|null，**不是** API Key）· `has_jwt` · `expires_at` · `last_call`。旧字段 `key` 已弃用并固定为 `null`。
