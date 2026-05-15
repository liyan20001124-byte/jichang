// ==UserScript==
// @name         iKuuu机场每日签到
// @namespace    https://github.com/liyan20001124-byte/jichang
// @version      1.4.0
// @description  iKuuu机场后台自动签到领流量，支持多域名自动切换、账号密码自动登录
// @author       liyan20001124-byte
// @icon         https://ikuuu.win/favicon.ico
// @homepageURL  https://github.com/liyan20001124-byte/jichang
// @supportURL   https://github.com/liyan20001124-byte/jichang/issues
// @license      MIT
// @crontab      0 */5 * * *
// @match        https://docs.scriptcat.org/dev/background.html#promise
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_info
// @grant        GM_log
// @grant        GM_registerMenuCommand
// @connect      ikuuu.eu
// @connect      ikuuu.pw
// @connect      ikuuu.win
// @connect      ikuuu.fyi
// @connect      ikuuu.nl
// @storageName  iKuuuCheckin_Shared
// ==/UserScript==

// ============================================================
// 常量配置
// ============================================================

// 备用域名列表（按优先级排序），主域名失败时自动切换
// 致谢：多域名自动切换功能来自 Magiclyan 的脚本
const FALLBACK_DOMAINS = ["ikuuu.win", "ikuuu.fyi", "ikuuu.nl", "ikuuu.eu", "ikuuu.pw"];
const MAX_RETRIES = 7;              // 签到请求最大重试次数
const MAX_TICKS = 32;               // 超时检测次数上限（×3秒 ≈ 96秒）
const REQUEST_DELAY = [1000, 5000]; // 签到请求随机延迟范围（毫秒）

// ============================================================
// 用户设置（通过油猴菜单持久化存储）
// ============================================================

let domain = GM_getValue("domain", FALLBACK_DOMAINS[0]);
let email = GM_getValue("email", "");
let password = GM_getValue("password", "");

// ============================================================
// 菜单注册
// ============================================================

// 菜单1：修改域名（网站迁移时使用）
GM_registerMenuCommand("设置域名", () => {
	let input = prompt("请输入网站域名（不含https://）：", domain);
	if (!input || !input.trim()) return;
	domain = input.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
	GM_setValue("domain", domain);
	GM_notification({ title: "域名已更新", text: domain, timeout: 3000 });
});

// 菜单2：设置账号密码（用于自动登录）
GM_registerMenuCommand("设置账号密码", () => {
	let inputEmail = prompt("请输入邮箱账号：", email);
	if (inputEmail === null) return;
	email = inputEmail.trim();
	GM_setValue("email", email);

	let inputPass = prompt("请输入密码：", password);
	if (inputPass === null) return;
	password = inputPass;
	GM_setValue("password", password);
	GM_notification({ title: "账号密码已保存", text: email, timeout: 3000 });
});

// 菜单3：恢复默认设置
GM_registerMenuCommand("清除设置", () => {
	domain = FALLBACK_DOMAINS[0];
	email = "";
	password = "";
	GM_setValue("domain", domain);
	GM_setValue("email", email);
	GM_setValue("password", password);
	GM_notification({ title: "设置已清除", text: "恢复为默认值", timeout: 3000 });
});

// 菜单4：查看当前配置
GM_registerMenuCommand("查看当前设置", () => {
	alert("域名: " + domain + "\n账号: " + (email || "未设置"));
});

// ============================================================
// 工具函数
// ============================================================

// 拼接完整URL
function url(path) {
	return "https://" + domain + path;
}

// 随机延迟（防检测）
function randomDelay() {
	return REQUEST_DELAY[0] + Math.random() * (REQUEST_DELAY[1] - REQUEST_DELAY[0]);
}

// 切换到下一个备用域名
// 致谢：此功能思路来自 Magiclyan 的多域名切换脚本
function switchDomain() {
	const current = FALLBACK_DOMAINS.indexOf(domain);
	const next = (current + 1) % FALLBACK_DOMAINS.length;
	domain = FALLBACK_DOMAINS[next];
	GM_log("切换到备用域名：" + domain, "info");
}

// ============================================================
// 主逻辑
// ============================================================

return new Promise((resolve, reject) => {
	let retryCount = 0;   // 当前重试次数
	let tickCount = 0;    // 超时检测计数
	let finished = false; // 是否已完成（防止竞态重复执行）
	let scan;             // setInterval 句柄

	// --- 自动登录 ---
	function doLogin() {
		if (!email || !password) {
			GM_notification({ title: "未登录", text: "请在菜单中设置账号密码，或手动登录", timeout: 10000 });
			GM_openInTab(url("/auth/login"));
			return reject("未登录且未配置账号密码");
		}

		GM_log("尝试自动登录...", "info");
		GM_xmlhttpRequest({
			method: "POST",
			url: url("/auth/login"),
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			data: "email=" + encodeURIComponent(email) + "&passwd=" + encodeURIComponent(password),
			responseType: "json",
			timeout: 10000,
			onload: (xhr) => {
				// SSPanel 登录成功时 ret 为真值
				if (xhr.status == 200 && xhr.response && xhr.response.ret) {
					GM_log("自动登录成功", "info");
					scan = setInterval(checkTimeout, 3000);
					doCheckin();
				} else {
					let msg = (xhr.response && xhr.response.msg) || "登录失败";
					GM_notification({ title: "自动登录失败", text: msg, timeout: 5000 });
					reject("自动登录失败: " + msg);
				}
			},
			onerror: () => reject("登录请求出错"),
			ontimeout: () => reject("登录请求超时"),
		});
	}

	// --- 签到请求 ---
	function doCheckin() {
		if (finished) return;
		setTimeout(() => {
			GM_xmlhttpRequest({
				method: "POST",
				url: url("/user/checkin"),
				headers: { "Accept": "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" },
				responseType: "json",
				timeout: 5000,
				onload: (xhr) => {
					if (xhr.status == 200 && xhr.response) {
						finished = true;
						clearInterval(scan);
						// ret=0 表示已签到过，ret=1 表示签到成功
						resolve(xhr.response.ret === 0 ? "今日已签到" : xhr.response.msg);
					} else {
						GM_log("签到失败(" + xhr.status + ")，重试 " + (retryCount + 1) + "/" + MAX_RETRIES, "warn");
						if (++retryCount < MAX_RETRIES) {
							switchDomain(); // 切换备用域名重试
							doCheckin();
						}
					}
				},
				ontimeout: () => { GM_log("签到超时，重试", "info"); if (++retryCount < MAX_RETRIES) { switchDomain(); doCheckin(); } },
				onerror: () => { GM_log("签到出错，重试", "info"); if (++retryCount < MAX_RETRIES) { switchDomain(); doCheckin(); } },
			});
		}, randomDelay());
	}

	// --- 超时/重试上限检测（每3秒检查一次）---
	function checkTimeout() {
		if (finished) return;
		if (++tickCount >= MAX_TICKS || retryCount >= MAX_RETRIES) {
			finished = true;
			clearInterval(scan);
			if (retryCount >= MAX_RETRIES) {
				GM_notification({ title: "签到失败", text: "所有域名均失败，请检查网络或手动设置域名", timeout: 10000 });
			}
			reject(retryCount >= MAX_RETRIES ? "重试次数过多" : "脚本运行超时");
		}
	}

	// --- 入口：检查登录状态 ---
	function checkLogin() {
		GM_xmlhttpRequest({
			method: "GET",
			url: url("/user"),
			timeout: 10000,
			onload: (xhr) => {
				if (xhr.finalUrl.includes("/auth/login")) {
					// 未登录，尝试自动登录
					doLogin();
				} else if (xhr.finalUrl.includes("/user")) {
					// 已登录，直接签到
					scan = setInterval(checkTimeout, 3000);
					doCheckin();
				} else {
					// 未知跳转，切换域名重试
					GM_log("登录检查异常，切换域名重试", "warn");
					if (++retryCount < MAX_RETRIES) {
						switchDomain();
						checkLogin();
					} else {
						reject("所有域名均无法访问");
					}
				}
			},
			onerror: () => {
				GM_log("登录检查失败，切换域名重试", "warn");
				if (++retryCount < MAX_RETRIES) {
					switchDomain();
					checkLogin();
				} else {
					reject("所有域名均无法访问");
				}
			},
			ontimeout: () => {
				GM_log("登录检查超时，切换域名重试", "warn");
				if (++retryCount < MAX_RETRIES) {
					switchDomain();
					checkLogin();
				} else {
					reject("所有域名均超时");
				}
			},
		});
	}

	// 启动
	checkLogin();
});
