# dsh-plugin-kmanager

DeepSeek Harness 的插件管理器:在浏览器里可视化地管理官方插件与自制插件——查看、启用/禁用、拖拽排序,并从 GitHub / ZIP / 本地文件夹安装、卸载插件;同时支持导入 agent 预设(如 dsh-router-standard)到 `~/.dsh/.agent-presets`。

> **个人用插件,公开供大伙试用。** 功能与交互尽量贴近日常使用习惯,但未经大规模环境验证。使用前请阅读文末免责声明。

## 功能

- **双页签**:`系统`(harness 内置官方插件)与 `自制`(手动安装的插件)分开管理。
- **网格布局**:每个插件一个方块,颜色按分类区分(核心/界面/宿主/网关/模型/会话/执行/任务/交互/未分类)。
- **启用/禁用**:点击方块切换运行状态;禁用后变灰,底部保留一条分类色。
- **拖拽排序**:拖住方块到目标位置实时插入;排序持久化,重启后保持。
- **右键重命名**:在任意插件方块上右键 →「重命名」,可设置一个仅用于显示的标签;不修改文件夹、包名或任何原文件,留空即可恢复默认名称。
- **右上角排序**:支持「按颜色 / 分类」与「按名称」两种临时排序。
- **安装插件**,支持三种来源:
  - **GitHub 项目地址**(`git clone`,如 `https://github.com/user/repo`)
  - **本地文件夹路径**(复制整个文件夹)
  - **本地 ZIP 路径**(自动解压),也支持直接把 `.zip` 文件拖进页面
- **卸载**:在「自制」页签下把方块拖入页面底部的垃圾桶即可。
- **预设页签**:扫描预设源(GitHub / ZIP / 本地文件夹)里的 `agent.cordis.yml` 目录并导入;导入时用与 harness 一致的 js-yaml 规范化 `preset.yml`,坏文件也会被治愈,确保系统预设选择器能显示描述。
- **操作反馈**:安装/卸载均有进度,ZIP 上传显示真实百分比。

## 安装方式

### 前置要求

- 一个可用的 DeepSeek Harness 环境(Web 或 CLI)。
- Node.js、git、pnpm(按构建需要)。

### 一、作为源码开发的插件(推荐)

```bash
# 1. 克隆本仓库到 harness 源码同级的 mypackages 目录
#    例如 harness 在 D:/deepseek-harness,则放到 D:/mypackages/dsh-plugin-kmanager
git clone https://github.com/Kitup666/dsh-plugin-kmanager.git

# 2. 构建(Windows)
cd dsh-plugin-kmanager
powershell -File scripts/build.ps1

# 3. 在 harness home 的 cordis.patch.yml 中加入插件行
#    - id: dsh-plugin-kmanager
#      name: '@deepseek-ai/dsh-plugin-kmanager'
```

### 二、通过管理器自身安装

在页面「自制」页签点「+」,填 GitHub 地址或本地路径即可,管理器会克隆/复制到 `mypackages` 并写入 patch 行。

## 构建

```bash
# Windows
powershell -File scripts/build.ps1

# macOS / Linux
bash scripts/build.sh
```

构建产物在 `lib/`(已 gitignore),由 `tsc`(types) + `tsdown`(bundle)生成。

## 测试

```bash
node tests/smoke.mjs
```

## 免责声明

本插件为个人开发,未经大规模环境验证。使用过程中如遇问题,欢迎提 issue,但请自行评估风险。
