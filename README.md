<div align="center">

![JiuLi-Plugin](Resources/Readme/banner.svg)

# JiuLi-Plugin

**常用工具，一处就绪。**

为 JiuLi / Yunzai 带来二维码处理、QQ 账号档案、文档渲染与运行管理。

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES_Modules-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
[![GitHub](https://img.shields.io/badge/GitHub-主仓库-181717?style=flat-square&logo=github)](https://github.com/RainFoam0693/JiuLi-Plugin)
[![GitCode](https://img.shields.io/badge/GitCode-国内镜像-EF4058?style=flat-square)](https://gitcode.com/RainFoam0693/JiuLi-Plugin)

[快速开始](#快速开始) · [功能一览](#功能一览) · [指令手册](#指令手册) · [图片日志](#图片日志) · [问题排查](#问题排查)

</div>

---

## 功能一览

| 日常工具 | 内容呈现 | 运行管理 |
| :--- | :--- | :--- |
| **二维码** — 生成、识别与图片回复解析 | **Markdown** — 将文档渲染为图片 | **图片日志** — 查看运行记录与错误信息 |
| **QQ 档案** — 查询注册时间和公开资料 | **代码高亮** — 查看文件、URL 与指定行段 | **远程命令** — Shell / JavaScript 执行 |
| **系统信息** — 状态查看与系统测试 | **消息表达式** — 单条、多条与转发消息 | **文件管理** — 查看、上传与下载 |

QQ 账号档案需要 **ICQQ** 适配器；图片日志专为 **[JiuLi](https://github.com/HL-z7/JiuLi)** 的日志目录与浏览器接口适配。

## 快速开始

### 01 / 准备环境

| 项目 | 要求 |
| :--- | :--- |
| 机器人 | 已正常运行的 JiuLi / Yunzai |
| Node.js | 18 及以上 |
| 包管理器 | pnpm |
| 图片渲染 | 宿主 Puppeteer 服务可用 |

### 02 / 安装插件

[GitHub](https://github.com/RainFoam0693/JiuLi-Plugin) 为主仓库，问题反馈与功能建议统一提交至 [GitHub Issues](https://github.com/RainFoam0693/JiuLi-Plugin/issues)。[GitCode](https://gitcode.com/RainFoam0693/JiuLi-Plugin) 为国内加速镜像，方便国内用户安装和更新。

在**机器人根目录**执行，选择一个来源即可。

**GitHub 主仓库（默认）**

```bash
git clone https://github.com/RainFoam0693/JiuLi-Plugin.git plugins/JiuLi-Plugin
pnpm install
```

<details>
<summary><b>使用 GitCode 国内加速镜像</b></summary>

```bash
git clone https://gitcode.com/RainFoam0693/JiuLi-Plugin.git plugins/JiuLi-Plugin
pnpm install
```

</details>

### 03 / 重启并使用

重启机器人，确认后台出现 `JiuLi-Plugin` 加载完成提示。常规功能无需单独配置文件，主人权限沿用宿主设置；插件安装器的配置见下文。

发送 `二维码你好`，即可体验二维码生成。

<details>
<summary><b>更新插件 / 从旧目录迁移</b></summary>

在机器人根目录更新：

```bash
git -C plugins/JiuLi-Plugin pull --ff-only
pnpm install
```

更新会沿用安装时选择的仓库来源，完成后重启机器人。GitCode 镜像可能存在同步延迟，需要最新改动时可使用 GitHub。

已有实例请先停止机器人，将插件目录改为 `JiuLi-Plugin`，保留目录中的资源文件，并确认只安装了一份插件。

需要切换下载来源时，选择以下一条命令执行即可。

**切换至 GitHub 主仓库：**

```bash
git -C plugins/JiuLi-Plugin remote set-url origin https://github.com/RainFoam0693/JiuLi-Plugin.git
```

**切换至 GitCode 国内镜像：**

```bash
git -C plugins/JiuLi-Plugin remote set-url origin https://gitcode.com/RainFoam0693/JiuLi-Plugin.git
```

</details>

## 指令手册

以下示例中的“路径”“URL”“命令”和“表达式”请替换为实际内容。

### 日常工具

| 功能 | 指令 | 使用说明 |
| :--- | :--- | :--- |
| 生成二维码 | `二维码你好` | 生成文字对应的二维码 |
| 识别二维码 | `识别二维码` / `解析二维码` | 随指令发图、回复图片，或按提示补发图片；本地解码 |
| QQ 账号档案 | `#QQ注册时间12345678` | 支持 @目标；不指定目标时查询自己；仅 ICQQ |
| 系统状态 | `系统信息` / `系统信息图片` | 查看系统信息，依赖宿主工具 |
| 系统测试 | `系统测试` | 依赖宿主安装的测试工具 |

QQ 档案以协议返回的公开资料为准；图片渲染失败时会回退为文本。

### 文档与代码 · 主人权限

| 功能 | 指令 | 使用说明 |
| :--- | :--- | :--- |
| Markdown 渲染 | `md路径或URL` | 将文档输出为图片 |
| 代码高亮 | `sc路径或URL` | 渲染代码内容 |
| 代码行段 | `sc10~30路径或URL` | 查看指定行段 |

### 远程管理 · 主人权限

| 功能 | 文本输出 | 图片输出 |
| :--- | :--- | :--- |
| Shell 命令 | `rc命令` | `rcp命令` |
| JavaScript | `rj代码` | `rjp代码` |
| 单条消息表达式 | `dm表达式` | `dmp表达式` |
| 多条消息表达式 | `mm表达式` | `mmp表达式` |
| 转发消息表达式 | `fm表达式` | `fmp表达式` |

文件操作：`文件查看路径` · `文件上传路径` · `文件下载路径`。

脚本执行：`脚本执行命令`，需要宿主环境提供对应安装脚本。远程命令和文件操作均使用宿主的主人权限。

## 插件安装器

插件列表直接读取 [Yunzai-Bot-plugins-index](https://gitee.com/yhArcadia/Yunzai-Bot-plugins-index) 的 `Function-Plugin.md`、`Game-Plugin.md` 和 `WordGame-Plugin.md`，不使用插件列表接口或平台仓库搜索 API。索引缓存 10 分钟，刷新失败时使用已有内存缓存。

| 指令 | 用途 |
| :--- | :--- |
| `#插件列表` / `#插件列表2` | 卡片图片展示全部索引，每页 6 项；官机附安装及翻页回调按钮 |
| `#搜索插件关键词` | 图片卡片展示名称、分类、简介与安装指令；支持名称、作者、备注与别名搜索，最多 30 项，每张 6 项 |
| `#安装插件名称` | 按索引名称、目录名或别名安装 |
| `#安装插件仓库地址,分支名` | 从 HTTPS / SSH 仓库克隆，可省略分支 |
| `#已安装插件` / `#已安装插件2` | 图片展示本地插件，每页 6 项；官机支持按钮翻页 |
| `#插件换分支插件名,分支名` | 保留本地改动检查并切换分支 |
| `#插件强制切换分支插件名,分支名` | 丢弃冲突改动并强制切换分支 |
| `#卸载插件目录名` | 删除指定插件目录，保护核心组件及本插件 |
| `#搜索github仓库关键词` / `#搜索gitcode仓库关键词` | 仅搜索索引中对应平台的条目 |
| `#插件管理器重载配置` / `#插件管理器重置配置` | 重载配置 / 备份后恢复默认配置 |

以上指令仅主人可用。安装器使用 Git 克隆并通过 pnpm 安装依赖，安装后重启生效。配置首次使用时生成于 `plugins/JiuLi-Plugin/config/PluginManager.yaml`，可设置安装目录、超时、依赖源和私库认证。默认不填写令牌，配置文件已加入 Git 忽略规则。

## 图片日志

> **为 [JiuLi](https://github.com/HL-z7/JiuLi) 适配。** 读取框架日志并复用已启动的浏览器，其他宿主需适配日志路径与浏览器接口。

**本地高亮** · **行号展示** · **关键词筛选** · **内存发送，无临时图片**

| 想查看什么 | 发送指令 |
| :--- | :--- |
| 当天最近的运行记录 | `#图片日志` |
| 最近 50 行运行日志 | `#运行图片日志50` |
| 最近 50 行错误日志 | `#错误图片日志50` |
| 包含“登录”的最近 50 行记录 | `#图片日志50登录` |
| 包含“超时”的错误信息 | `#错误图片日志超时` |

仅主人可用。默认 **100 行**，上限 **1000 行**；先按关键词筛选，再取最近的记录。

<details>
<summary><b>日志来源与旧脚本迁移</b></summary>

| 类型 | 读取位置 |
| :--- | :--- |
| 运行日志 | `logs/command.YYYY-MM-DD.log`，按北京时间取当天 |
| 错误日志 | `logs/error.log` |

如仍启用 `plugins/example/图片日志.js`，请停用旧脚本后使用本插件，避免相同指令被重复处理。

</details>

## 问题排查

<details>
<summary><b>插件加载失败，或提示找不到模板</b></summary>

确认插件位于 `plugins/JiuLi-Plugin`，没有重复安装；在机器人根目录执行 `pnpm install` 后重启，结合后台错误日志检查。

</details>

<details>
<summary><b>文档、代码或日志无法生成图片</b></summary>

检查宿主 Puppeteer 服务、浏览器、中文字体与模板资源。图片日志依赖 JiuLi 的浏览器接口，日志文件尚未生成时会提示文件不存在。

</details>

<details>
<summary><b>QQ 档案查询不可用</b></summary>

确认使用 ICQQ 适配器，检查目标 QQ 号和后台接口返回。公开资料缺失时，以协议实际返回为准。

</details>

<details>
<summary><b>系统工具、脚本执行或依赖安装失败</b></summary>

系统信息和脚本执行需要宿主提供相关工具；运行 Bash 脚本需要可用的 Bash 环境。Windows 如遇原生依赖编译错误，请按报错安装 Microsoft C++ 生成工具。进程被系统终止时，检查内存与交换空间。

</details>

反馈问题时请附上**使用指令、运行环境、相关日志与复现步骤**，并隐藏账号凭据。

[前往 GitHub 提交问题](https://github.com/RainFoam0693/JiuLi-Plugin/issues)

## 致谢

基于 **TimeRainStarSky** 的插件代码继续维护，保留原作者署名。图片日志改编自 **狐** 的脚本，原作者说明保留在代码中。感谢 [JiuLi](https://github.com/HL-z7/JiuLi) 与相关宿主、开源工具的支持。

---

<div align="center">

**JiuLi-Plugin**

常用工具，一处就绪。

[GitHub 主仓库](https://github.com/RainFoam0693/JiuLi-Plugin) · [GitCode 国内镜像](https://gitcode.com/RainFoam0693/JiuLi-Plugin)

</div>
