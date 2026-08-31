# 运动打卡周报生成脚本

从微信云开发的打卡数据生成周报图片（PNG）。支持两种数据来源：

- **云端拉取**（推荐）：通过微信官方「云开发 HTTP API」直接查询 `checkins` + `users` 集合，
  和小程序 `pages/history` 的查询方式一致，但走服务端接口、无客户端 20 条限制，无需手动导出。
- **文件读取**：读取从云开发控制台导出的 JSON 文件。

## 快速开始

### 方式一：云端拉取（推荐）

1. **准备凭证**：在小程序后台（mp.weixin.qq.com）→ 设置 → 开发设置，获取 **AppID** 和 **AppSecret**；
   云开发环境 ID 见云开发控制台。

2. **创建配置**（复制示例并填写，该文件已加入 `.gitignore`，不会被提交）：

   ```bash
   cp weekly-report/cloud-config.example.json weekly-report/cloud-config.json
   # 编辑 cloud-config.json 填入 appid / secret / env
   ```

   也可以不建文件，改用环境变量：`WX_APPID` / `WX_APPSECRET` / `WX_ENV`。

3. **安装依赖并生成**：

   ```bash
   cd weekly-report
   npm install
   npm run report          # 有云配置时默认走 cloud 模式
   ```

   图片输出到 `weekly-report/output/周报.png`。

### 方式二：文件读取

1. **导出数据**：微信开发者工具 → 云开发控制台 → 数据库 → `checkins` 集合 → 导出，
   保存为 `weekly-report/data/checkins.json`（替换示例数据）。

2. **安装依赖并生成**：

   ```bash
   cd weekly-report
   npm install
   node generate.js --source file
   ```

## 命令参数

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--source` | 数据来源：`cloud`（云端拉取）或 `file`（导出文件） | 有云配置时 `cloud`，否则 `file` |
| `--input` | 导入的数据文件路径（仅 file 模式） | `data/checkins.json` |
| `--output` | 输出图片路径 | `output/周报.png` |
| `--date` | 周报所在周的任意一天（`YYYY-MM-DD`） | 今天 |
| `--title` | 周报标题 | `运动打卡周报` |

示例：

```bash
node generate.js --source cloud --title "爬山群周报"
node generate.js --source file --date 2026-08-30 --output output/爬山群周报.png
```

> 若 `--date` 所在周没有打卡数据，脚本会自动向前回溯最近一个有数据的周（最多 8 周）。

## 数据说明

- **云端拉取**：`checkins` 记录只存 `userId`，脚本会同时拉取 `users` 集合联表补上昵称，
  与小程序 `history` 页的行为一致（见 `app.js` 的 `getCheckinsByMonth`）。
- **文件格式**（file 模式）：支持数组 / `{ "data": [...] }` / 每行一个对象的 NDJSON。
  记录字段与小程序 `checkins` 集合一致：`userId`(或 `_openid`)、`nickName`、`content`、`dateStr`、`time`、`timestamp`。

## 周报内容

- 概览卡片：本周打卡次数 / 参与人数 / 单日最多打卡
- 柱状图：周一 ~ 周日每天打卡人数（最高一天高亮）
- 排行榜：每人本周打卡次数、最长连续打卡天数（Top12）

## 每周自动生成（GitHub Actions）

仓库已包含 `.github/workflows/weekly-report.yml`，每周一 09:00（北京时间）自动拉取数据并生成周报。

1. **把代码推到 GitHub**（私有仓库即可）。
2. **配置 Secrets**：仓库 → Settings → Secrets and variables → Actions → 新建三个：
   - `WX_APPID`：小程序 AppID
   - `WX_APPSECRET`：小程序 AppSecret
   - `WX_ENV`：云开发环境 ID（如 `cloud1-xxx`）
3. 到点后进入仓库的 **Actions** 页面，点开最新一次运行，在底部 **Artifacts** 下载周报图片（保留 30 天）。

> 立即手动测试：Actions 页面 → 左侧选中「运动打卡周报」→ 右侧 **Run workflow** 按钮。

工作流要点：
- 用 `--date` 固定为「上周日」，确保周报始终是上一个完整自然周
- Linux 运行环境会先安装中文字体，避免中文渲染成方框
- 生成的图片以 Artifact 形式保存，30 天后自动清理
