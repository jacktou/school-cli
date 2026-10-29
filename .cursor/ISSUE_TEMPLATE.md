---
title: "Auto-review 层故障：审批卡无法弹出"
labels: bug, cloud-agent, auto-review
assignees: 
---

## 问题描述

当通过 **Grok Bot → Cursor Cloud Agent** 调用链路触发 Cloud Agent 时，Auto-review 审核层报错，审批卡无法弹出。

### 错误信息

```
An error occurred while reviewing this cloud agent action
```

### 预期行为

- Auto-review 层应该弹出审批卡
- 用户可以看到需要审批的操作
- 用户可以点击"批准"或"拒绝"按钮
- 批准后 Cloud Agent 继续执行操作（如 git push）

### 实际行为

- Auto-review 层直接报错
- 审批卡完全不出现
- Cloud Agent 被阻塞，无法继续执行需要权限的操作
- 用户无法通过任何方式批准操作

### 影响范围

- ❌ 无法执行 git push
- ❌ 无法执行其他需要审批的操作
- ❌ 在 1:1 对话中也能复现
- ❌ 影响 Grok Bot 集成的所有自动化工作流

## 复现步骤

1. 通过 Grok Bot 触发 Cursor Cloud Agent
2. Cloud Agent 尝试执行需要审批的操作（如 git push）
3. 观察到 Auto-review 层报错
4. 审批卡未出现

**注意**: 在 1:1 对话中也能复现这个问题。

## 环境信息

### Cloud Agent 信息

- **运行 ID**: bc-28134830-bfa8-4919-bdc1-af27195d47f1
- **Agent URL**: https://cursor.com/agents/bc-28134830-bfa8-4919-bdc1-af27195d47f1
- **仓库**: github.com/jacktou/school-cli
- **启动方式**: Grok Bot → Cloud Agent
- **模型**: claude-4.5-sonnet-thinking
- **用户**: jacktou666@gmail.com
- **环境类型**: Personal

### 系统信息

- **OS**: Linux 6.12.94+
- **日期**: 2026-10-29
- **时区**: UTC+8

### 相关日志

```
# 从 get-events 获取
事件数: 0
（无异常事件记录）
```

## 可能的原因

1. **审核服务故障**
   - Auto-review 服务本身存在 bug
   - 审批卡渲染逻辑出错
   - 审核请求未正确传递到前端

2. **权限配置问题**
   - Grok Bot 调用时的权限传递链路有问题
   - Service Account 或 OAuth token 验证失败
   - 跨服务调用的认证机制故障

3. **前后端同步问题**
   - 前端未正确接收审核请求
   - WebSocket 或长轮询连接断开
   - 审批卡 UI 组件加载失败

4. **平台集成问题**
   - Grok Bot 与 Cursor Cloud 的集成接口有问题
   - 消息格式或协议不匹配

## 当前临时解决方案

用户目前通过以下方式绕过这个问题：

1. 在本地手动执行 git 操作
2. 直接在 https://cursor.com/agents 创建新 agent
3. 使用辅助脚本（已创建）

## 建议的修复

### 短期修复

1. **添加详细错误日志**
   - 记录审批请求的完整链路
   - 提供错误发生时的上下文
   - 在前端显示具体的错误信息

2. **添加降级机制**
   - 当审批卡无法渲染时，提供命令行审批选项
   - 或者在聊天界面中直接请求审批
   - 提供"继续/中止"的简单选项

3. **改进错误提示**
   - 明确告知用户具体哪个环节失败
   - 提供替代方案的链接
   - 显示如何手动完成操作的指引

### 长期修复

1. **审核机制重构**
   - 解耦审核逻辑和 UI 渲染
   - 实现更健壮的审批状态管理
   - 添加重试和超时机制

2. **改进集成架构**
   - 标准化 Bot → Cloud Agent 的调用接口
   - 实现更可靠的权限传递机制
   - 添加健康检查和熔断器

3. **增强监控和告警**
   - 实时监控审核链路的成功率
   - 在故障发生时自动告警
   - 提供详细的诊断仪表板

## 其他信息

### 相关文档

- 完整诊断报告: `/workspace/CLOUD_AGENT_REVIEW_BUG_REPORT.md`
- 解决方案文档: `/workspace/.cursor/REVIEW_BUG_WORKAROUND.md`
- 辅助脚本: `/workspace/.cursor/workaround-scripts.sh`

### 需要的额外信息

如需进一步诊断，请告知需要提供：
- [ ] Cursor Desktop 日志
- [ ] 浏览器控制台错误
- [ ] Grok Bot 的调用日志
- [ ] 其他相关日志

---

**报告时间**: 2026-10-29 08:20 (UTC+8)  
**报告者**: jacktou666@gmail.com  
**严重程度**: 高（阻塞关键功能）
