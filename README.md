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
| `school login --paper` | Privy **本地 stub**：写入 paper session（假地址可选） |
| `school logout` | 清除本地 session |
| `school status` | 输出 `mode` / `key` / `last_call` |
| `school skills list` | 读取 skills.json，打印 id · group · title |
| `school skills run <id> [--input JSON]` | 跑 P0 skill；`trade_paper` 仅本地模拟成交 |

P0 skill：`alpha_radar` · `alpha_transcript` · `token_security` · `trade_quote` · `trade_paper` · `vault_list`  
登录映射：`school login` → `wallet_login`（CLI/auth，不算业务 skill）

## paper vs live

- **paper（默认）**：本地 session + mock/模拟结果；`trade_paper` **永不签名、不上链**。
- **live**：需要真实 **Privy App ID**。当前未提供，`login` 非 paper 会直接报错并提示 TODO，**不会伪造 Privy 凭证**。

环境变量：

- `SCHOOL_SKILLS_PATH` — skills.json 路径（默认 `../school-skills/skills.json`）
- `SCHOOL_CLI_CONFIG` — session 文件（默认 `~/.school-cli/config.json`）
- `PRIVY_APP_ID` — 有了再接真登录（TODO）

## 阻塞

1. Mac 落盘 / Git 远程地址（本仓目前在 box：`/workspace/school-cli`）
2. **Privy App ID** — 未到位前只能 paper stub

## 与 Design 对齐

CLI 状态条字段：`mode` · `key` · `last_call`（见 Figma「学习demo」状态条）。
