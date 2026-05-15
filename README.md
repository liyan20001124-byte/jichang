# iKuuu机场每日签到 - 开发文档

## 项目简介

ScriptCat/Tampermonkey 后台脚本，自动完成 iKuuu 机场每日签到，领取免费流量。

- **GitHub**: https://github.com/liyan20001124-byte/jichang
- **许可证**: MIT
- **当前版本**: 1.4.0

## 技术栈

- 用户脚本引擎：ScriptCat（推荐）或 Tampermonkey
- 运行环境：浏览器 Service Worker（后台运行，无需打开目标网页）
- 目标网站：SSPanel 面板（iKuuu 机场）

---

## 文件结构

```
机场签到/
├── iKuuu机场每日签到.js     # 主脚本（安装到脚本管理器）
├── 开发文档.md              # 本文件
├── 脚本说明（上传用）.md    # ScriptCat 发布用的说明文档
└── 首页 — iKuuu VPN.html    # 网页存档（调试用）
```

---

## 脚本头部元数据说明

```javascript
// @crontab      0 */5 * * *        // 定时表达式：每隔5小时执行一次
// @match        https://docs.scriptcat.org/dev/background.html#promise  // 触发页（后台脚本占位）
// @connect      ikuuu.win          // 允许跨域请求的域名（需列出所有备用域名）
// @storageName  iKuuuCheckin_Shared // 持久化存储名（多脚本共享）
```

**注意**：如果新增备用域名，需要同时：
1. 在 `FALLBACK_DOMAINS` 数组中添加
2. 在头部添加对应的 `@connect` 声明

---

## 代码结构

脚本分为五个区域：

### 1. 常量配置（顶部）

```javascript
const FALLBACK_DOMAINS = ["ikuuu.win", "ikuuu.fyi", "ikuuu.nl", "ikuuu.eu", "ikuuu.pw"];
const MAX_RETRIES = 7;              // 最大重试次数
const MAX_TICKS = 32;               // 超时检测上限（×3秒 ≈ 96秒）
const REQUEST_DELAY = [1000, 5000]; // 随机延迟范围
```

- `FALLBACK_DOMAINS`：备用域名列表，按优先级排序。主域名失败时自动切换到下一个
- 修改这些值可以调整脚本行为，无需理解内部逻辑

### 2. 用户设置

通过 `GM_getValue` / `GM_setValue` 持久化存储，数据保存在脚本管理器中：

| 键名 | 类型 | 说明 |
|------|------|------|
| `domain` | string | 当前使用的域名（默认取 FALLBACK_DOMAINS[0]） |
| `email` | string | 登录邮箱 |
| `password` | string | 登录密码 |

### 3. 菜单注册

四个菜单通过 `GM_registerMenuCommand` 注册，在脚本管理器的菜单中可见：

- 设置域名
- 设置账号密码
- 清除设置
- 查看当前设置

### 4. 工具函数

```javascript
function url(path)        // 拼接完整 URL：https://域名 + path
function randomDelay()    // 返回 1000~5000 之间的随机数（毫秒）
function switchDomain()   // 切换到下一个备用域名（来自 Magiclyan 的思路）
```

### 5. 主逻辑（Promise）

脚本返回一个 Promise，ScriptCat 通过 resolve/reject 判断执行结果。

```
执行流程：
┌──────────────────┐
│  GET /user       │  检查登录状态
└────────┬─────────┘
         │
    ┌────┴────┐
    │ 已登录? │
    └────┬────┘
    Yes  │  No → doLogin() → 自动登录
         │                  ↓ 失败 → reject
    doCheckin()  POST /user/checkin
         │
    ┌────┴────┐
    │ 成功?   │
    └────┬────┘
    Yes  │  No → switchDomain() → 重试（最多7次）
         │
    resolve(msg)  → 脚本结束

失败时自动切换备用域名：
  登录检查失败 → switchDomain() → checkLogin()
  签到失败     → switchDomain() → doCheckin()
```

---

## 多域名切换机制

灵感来源：**Magiclyan** 的脚本。

```javascript
const FALLBACK_DOMAINS = ["ikuuu.win", "ikuuu.fyi", "ikuuu.nl", "ikuuu.eu", "ikuuu.pw"];

function switchDomain() {
    const current = FALLBACK_DOMAINS.indexOf(domain);
    const next = (current + 1) % FALLBACK_DOMAINS.length;
    domain = FALLBACK_DOMAINS[next];
}
```

切换时机：
- 登录检查请求失败（网络错误/超时/未知跳转）
- 签到请求失败（非 200 响应）

所有域名轮询一圈后仍失败，脚本 reject 退出。

---

## 关键 API 接口

### 检查登录状态

```
GET https://{domain}/user
```

- 已登录：重定向到 `/user`（200）
- 未登录：重定向到 `/auth/login`

### 登录

```
POST https://{domain}/auth/login
Content-Type: application/x-www-form-urlencoded

email=xxx&passwd=xxx
```

响应：`{ret: 1, msg: "..."}` 表示成功

### 签到

```
POST https://{domain}/user/checkin
Accept: application/json, text/javascript, */*; q=0.01
X-Requested-With: XMLHttpRequest
（无请求体）
```

响应：
- `{ret: 1, msg: "获得了 xxx MB 流量"}` — 签到成功
- `{ret: 0, msg: "今日已签到"}` — 已签到过

**重要**：签到接口不需要 `Content-Type` 和请求体，多了会返回 405。

---

## 常见问题排查

### 签到失败（405 错误）

原因：请求头包含 `Content-Type` 导致服务器拒绝。
解决：确保签到请求不设置 `Content-Type`，不发送 `data`。

### 签到失败（网络错误）

可能原因：
1. 所有备用域名均不可用 → 通过菜单手动设置新域名
2. 未登录 → 检查账号密码设置
3. 代理/VPN 问题 → 检查网络连接

### 如何调试

1. 在 ScriptCat 中手动运行脚本
2. 查看日志输出（GM_log）
3. 使用浏览器 F12 → 网络标签抓包对比

---

## 如何适配其他 SSPanel 机场

此脚本基于 SSPanel 面板，大部分 SSPanel 机场的接口相同。适配步骤：

1. 修改 `FALLBACK_DOMAINS` 为目标机场域名
2. 添加对应的 `@connect` 声明
3. 修改 `@icon` 图标 URL
4. 修改 `@name` 和 `@namespace`
5. 检查登录接口的字段名是否为 `email` 和 `passwd`（部分面板可能不同）

---

## 致谢

- **Vikrant** — 原始脚本作者（v1.1.4），实现了核心签到功能和重试机制
- **Magiclyan** — 提供多域名自动切换的思路，提升了脚本的稳定性

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.4.0 | 2026-05-16 | 新增多域名自动切换（感谢 Magiclyan）、登录检查失败时切换域名重试 |
| 1.3.0 | 2026-05-16 | 精简代码、添加注释、修复竞态条件、适配 ikuuu.win |
| 1.2.0 | 2026-05-16 | 添加设置菜单、自动登录、动态域名 |
| 1.1.4 | - | 初始版本（原作者 Vikrant） |
