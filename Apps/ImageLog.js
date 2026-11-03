import fs from "node:fs/promises";
import { createRequire } from "node:module";
import puppeteer from "../../../lib/puppeteer/puppeteer.js";
import path from "node:path";
import hljs from "highlight.js";
import { parseLogCommand, selectLogLines } from "../Model/ImageLog.js";

const dateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const now = () => dateFormat.format(new Date());

/**
* 本js改于TRSS自带的日志.js
* 功能是将日志以图片的形式输出观看更直观的日志
* 狐  QQ：3610159055
* 官网 http://hli.icu
*
* 适用框架：JiuLi（https://github.com/HL-z7/JiuLi）
* 本功能按 JiuLi 的日志路径与浏览器接口适配。
*
* JiuLi 适配：
*  - 日志文件用云崽同名文件 logs/command.<日期>.log（框架已同步写入）、logs/error.log
*  - 浏览器改用框架已就绪的实例（puppeteer.browserInit()），不再自己 launch
*  - 图片直接以内存缓冲区发送；文件不存在时给出提示
*  - 高亮主题 CSS 从本地 highlight.js 包读取并内联，不再依赖 CDN（连不上 CDN 时日志会全灰）
*/

/** 高亮主题 CSS（首次渲染时读取） */
let highlightCss = null;
/** 读不到主题时的最小配色兜底，至少保证不是一片灰 */
const FALLBACK_CSS = `
.hljs-comment,.hljs-quote{color:#6a9955}
.hljs-keyword,.hljs-literal,.hljs-built_in,.hljs-type{color:#569cd6}
.hljs-string,.hljs-attr,.hljs-attribute,.hljs-regexp{color:#ce9178}
.hljs-number,.hljs-symbol,.hljs-bullet{color:#b5cea8}
.hljs-title,.hljs-section,.hljs-name,.hljs-selector-tag{color:#dcdcaa}
.hljs-variable,.hljs-template-variable,.hljs-params,.hljs-meta{color:#9cdcfe}
`;

async function getHighlightCss() {
  if (highlightCss === null) {
    try {
      const file = createRequire(import.meta.url).resolve("highlight.js/styles/vs2015.min.css");
      highlightCss = await fs.readFile(file, "utf8");
    } catch (err) {
      highlightCss = FALLBACK_CSS;
      logger.warn(`[图片日志] 读取 highlight.js 主题失败，用内置配色兜底: ${err.message}`);
    }
  }
  return highlightCss;
}

export class ImageLog extends plugin {
  constructor() {
    super({
      name: "图片日志",
      dsc: "发送最近100条运行日志",
      event: "message",
      priority: -Infinity,
      rule: [
        {
          reg: "^#(?:运行|错误)?图片日志.*$",
          fnc: "sendLog",
          permission: "master"
        }
      ]
    });

  }

  /** 日志文件按当天取，机器人跨天运行也不用重启 */
  logFileOf(err) {
    return err ? "logs/error.log" : `logs/command.${now().slice(0, 10)}.log`;
  }

  async sendLog() {
    if (!this.e.isMaster) return false;
    const options = parseLogCommand(this.e.msg);
    if (!options) return false;
    const logFile = this.logFileOf(options.isError);
    let raw;
    try {
      raw = await fs.readFile(logFile, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return this.reply(`还没生成日志文件：${logFile}`);
      logger.error("[JiuLi-Plugin][图片日志] 读取日志失败", error);
      return this.reply("读取日志失败，请检查日志文件权限");
    }
    const log = selectLogLines(raw, options);
    if (!log.length) return this.reply("暂无相关日志");
    try {
      const image = await this.generateLogImage(log);
      if (!image) return this.reply("生成日志图片失败，请查看后台日志");
      return this.reply(segment.image(image), true);
    } catch (error) {
      logger.error("[JiuLi-Plugin][图片日志] 渲染失败", error);
      return this.reply("生成日志图片失败，请查看后台日志");
    }
  }

  async generateLogImage(log) {
    const html = await this.generateLogHtml(log);

    /** 用框架已启动的浏览器：chromium 路径、中文字体、复用都由框架负责 */
    const browser = await puppeteer.browserInit();
    if (!browser) return false;
    if (browser.connected === false || browser.isConnected?.() === false) return false;

    let page;
    let buffer;
    try {
      page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      /** 样式已内联，不需要等外部资源 */
      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      buffer = await page.screenshot({ fullPage: true });
    } catch (error) {
      logger.error(`[图片日志] 截图失败: ${error.message}`);
    } finally {
      await page?.close().catch(() => {});
    }

    return buffer;
  }

  async generateLogHtml(log) {
    const fileName = parseLogCommand(this.e.msg).isError ? "error.log" : path.basename(this.logFileOf(false));
    const date = now();
    const css = await getHighlightCss();

    const logContent = log
      .map((line, idx) => `
        <div class="log-line">
          <span class="line-number">${idx + 1}</span>
          <pre><code>${hljs.highlightAuto(line).value}</code></pre>
        </div>
      `)
      .join('');
    return `
      <html>
        <head>
          <style>
            body {
              font-family: 'Fira Code', monospace, Arial, sans-serif;
              font-size: 14px;
              color: #d4d4d4;
              background: linear-gradient(135deg, #1e1e1e, #252526);
              margin: 0;
              padding: 40px;
              display: flex;
              flex-direction: column;
              align-items: center;
            }
            h1 {
              text-align: center;
              font-size: 20px;
              color: #61dafb;
              margin-bottom: 20px;
              font-weight: normal;
              text-shadow: 0 0 10px rgba(97,218,251,0.5);
            }
            .file-bar {
              width: 90%;
              max-width: 1000px;
              background: #2d2d2d;
              color: #ccc;
              padding: 8px 16px;
              border-radius: 8px 8px 0 0;
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-size: 13px;
              border: 1px solid rgba(255,255,255,0.1);
              border-bottom: none;
              box-shadow: inset 0 -1px 0 rgba(255,255,255,0.1);
            }
            .file-bar .file-name {
              color: #fff;
              font-weight: bold;
            }
            .log-container {
              width: 90%;
              max-width: 1000px;
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px);
              background: rgba(40, 44, 52, 0.75);
              border-radius: 0 0 12px 12px;
              border: 1px solid rgba(255,255,255,0.15);
              border-top: none;
              box-shadow: 0 8px 32px rgba(0,0,0,0.4);
              padding: 0;
              overflow-x: auto;
            }
            .log-line {
              display: flex;
              align-items: flex-start;
            }
            .line-number {
              user-select: none;
              background: rgba(0,0,0,0.3);
              color: rgba(200,200,200,0.6);
              text-align: right;
              width: 50px;
              padding: 4px 8px;
              font-size: 13px;
              border-right: 1px solid rgba(255,255,255,0.1);
            }
            pre {
              margin: 0;
              white-space: pre-wrap;
              word-wrap: break-word;
              flex: 1;
            }
            code {
              display: block;
              padding: 4px 12px;
              background-color: transparent;
              color: #dcdcdc;
              font-size: 14px;
              line-height: 1.5;
            }
            /* 滚动条美化 */
            ::-webkit-scrollbar {
              width: 8px;
              height: 8px;
            }
            ::-webkit-scrollbar-track {
              background: rgba(255,255,255,0.05);
              border-radius: 10px;
            }
            ::-webkit-scrollbar-thumb {
              background: rgba(255,255,255,0.3);
              border-radius: 10px;
            }
            ::-webkit-scrollbar-thumb:hover {
              background: rgba(255,255,255,0.5);
            }
          </style>
          <!-- 高亮主题内联，避免服务器连不上 CDN 时日志变成一片灰 -->
          <style>${css}</style>
        </head>
        <body>
          <h1>JiuLi-Plugin // 图片日志</h1>
          <div class="file-bar">
            <span class="file-name">${fileName}</span>
            <span class="file-date">${date}</span>
          </div>
          <div class="log-container">
            ${logContent}
          </div>
        </body>
      </html>
    `;
  }

}
