# 项目长期备忘

## 项目性质
把教学计划 Excel 做成「可交互的单文件 HTML」工具（选课学分规划、拖拽类小游戏等）。
用户偏好：单文件、零依赖、双击即用、浅色主题、中文界面。

## 配色约定
- **总进度条只有两态**：学分不足 = 红色渐变 `linear-gradient(90deg,#f87171,#dc2626)`；
  达标 = 绿色渐变 `linear-gradient(90deg,#4ade80,#16a34a)`（靠 `#p-bar` 上的 `.allok` 类切换）。
- 框头迷你进度条（必修/选修）独立配色：未完成橙 `#f59e0b`、完成绿 `#22c55e`，**不要被总进度条改动影响**。
- 类别框：未达标红框、达标绿框；必修卡加灰色斜条纹表示锁定。

## 页面基本信息
- **页头结构（用户指定）**：主标题 = 专业名「物联网应用技术（中外合办）」；
  **副标题 = 「选课学分规划」（加粗 15px 深色，手机 14px，要一眼看清网页用途）**；
  右侧「了解详情 ↗」按钮与主标题同行，其右再跟一个 **GitHub 按钮**（`#btn-github`，`#24292f` 深色实心 +
  内联 SVG Octocat logo + 文字「GitHub」，`<a target="_blank" rel="noopener noreferrer">` →
  https://github.com/AkariYueChan/EnoughPoints ，已验 HTTP 200）；手机端两个按钮都整行通栏、GitHub 在下面。
  **两按钮必须显式统一 `line-height:1.45`**：`<button>` 与 `<a>` 的行盒高度算法不同，不统一会有 2px 高度差。
- **页面从上到下顺序**：页头（标题/副标题/了解详情/GitHub）→ **规则卡片** → 总进度条+重置全部 →
  完成横幅 → 两个类别框 → 待选课程池 → 底部「生成选课表」按钮。
- 专业：**物联网应用技术（中外合办）**
- 详情链接（顶部「了解详情」按钮会同时打开这两个新标签页，均已验证 HTTP 200）：
  - https://www.crs.jsj.edu.cn/aproval/localdetail/3195 （中外合作办学监管工作信息平台）
  - https://www.gzhpu.edu.cn/wljsxy/zysz/rzrn2muqyv/content_73936 （学校专业介绍）
- 打开外部多标签的正确写法：在**同一个用户手势内同步**创建多个 `<a target="_blank" rel="noopener noreferrer">` 并 `.click()`；
  不要用 `window.open` + `setTimeout` 错峰（会丢失用户手势，更容易被弹窗拦截）。

## 数据源约定
`~/Downloads/教学一体化服务平台.xlsx` → 子表「课程设置总表」
- 公共基础课（专科）：26 门全必修 = 49 学分（表头「应修 58」与实际列出的 49 不符，**按 49 计**）
- 专业课：必修 16 门 = 74 学分；选修 21 门 = 69 学分；合计 143，表头「应修 89」
- 课程总数 63 门，总计 192 学分
- 列位：C 课程编号 / D 课程名称 / F 课程属性 / G 必修选修 / H 学分 / N 开设学期

## 业务规则
- **必修课 = 固定课**：页面打开时就已自动排入所属类别框，卡片锁定、不可拖动、不可移出（卡片脚注带 🔒）。
  只有**选修课**放在课程池里等用户自己挑。→ 公共基础课框开局即 49/49 达标（绿）；
  专业课框开局 74/89（红），要靠挑选修课补到 ≥89 才变绿。
- 达标判定：公共基础课 = 26 门必修固定计满（49）；专业课 = 必修 74 分 + 选修 ≥ 15 分（总分 ≥ 89）。
- 配色按用户明确要求：未达标 = 红，达标/超额 = 绿（不套用涨红跌绿的行情约定）。
- 学分含 0.2 小数，累加需 `Math.round(x*10)/10`。

## 交互约定
- **所有卡片按学期升序排列 + 多学期课程拆卡**（两个类别框和课程池一视同仁）：
  `expandByTerm()` 把课程按 `term`（如 `'1,2,5'`）拆成「一张卡 = 一个学期」，再按学期号升序排
  （稳定排序，同学期保持原表顺序 → 必修天然在选修前）。
- **拆卡不改学分**：`PLACE` / `compute()` 始终以「课程」为单位去重，拆分只影响展示。
  实测：公基 26 门 = 35 张卡 = 49 分；专业必修 16 门 = 17 张卡 = 74 分；课程池 21 门 = 22 张卡。
- **卡片学期标签格式（用户指定）**：`年级描述 + 真实学期号`，形如 **`大三上 · 第 5 学期`**。
  映射表 `TERM_GRADE = {1:'大一上',2:'大一下',3:'大二上',4:'大二下',5:'大三上',6:'大三下'}`（本专业只到大三下）。
  **禁止**用 `第 2/2 学期` 这类「第几张/共几张」写法（用户明确反馈有歧义）。
  完成度比例（`已修学分 123 / 138`、`已完成 1 / 2 个类别`、`必修 16/16 门`）语义清晰，保留。
- **脚注宽度很紧，改文案必须先量**：脚注 = 左「N学分」+ 右「年级描述 · 第 X 学期」。
  标签字宽 82px（10px 字号），可用空间最窄约 86px（366px 手机仿真双列）。
  为此把 🔒 从脚注移到类型标签（`🔒 必修`），`.c-term/.c-lock` 字号 10px、`.c-foot` gap 5px。
  量法：`canvas.measureText()` 得字宽，减 `c-credit` 实宽与 gap，得真实余量；别只看 `scrollWidth==clientWidth`（元素会收缩到内容宽，看不出余量）。
- 拖任意一张拆分卡 = 整门课选上（点击同理），tooltip 里已说明。
- 卡片位置变化后调用 `revealLastMoved()`，只滚动框内容器把变动卡片带进视野。
- **顶部进度条满格值 = 49 + 89 = 138**（两个类别的目标学分之和），不是全部课程总量 192；达标时正好 138/138。
- **必修卡视觉**：`.card.locked` 用 `::after` + `repeating-linear-gradient(45deg, rgba(100,116,139,.12) 0 5px, transparent 5px 12px)` 叠灰色斜条纹表示「不可修改」，`pointer-events:none` 不挡点击，文字用 `z-index:1` 浮在条纹上。

## 验证套路
单文件 HTML 交付前自检：数据统计脚本 → `node --check` 语法 → DOM 桩跑逻辑断言 → 无头 Chrome 截图复核。
需要「只打印某个图层 / 导出 PDF」时，**必须生成真实 PDF 检查**，别只读 CSS 推断：
1. `chrome --headless=new --print-to-pdf=out.pdf --no-pdf-header-footer --virtual-time-budget=6000 file://...`
2. 用正则读 `MediaBox` 判纸张方向/尺寸、数 `/Type /Page` 得页数；
3. 解压内容流（`zlib.decompress` 所有 `stream...endstream`）统计特征色 `rg` 出现次数 → 校验内容是否完整；
4. 用 **Ghostscript**（本机 `/usr/local/bin/gs`）把指定页渲成图片肉眼复核：
   `gs -dNOPAUSE -dBATCH -dQUIET -sDEVICE=png16m -r110 -dFirstPage=N -dLastPage=N -sOutputFile=p.png in.pdf`。
   （`sips -s format png in.pdf` 只能转第 1 页；手工改 /Kids 拆页会被 CoreGraphics 拒绝。）

## 打印 / 导出 PDF（本项目已实现）
- 打印样式**不能写死在主样式表**：`@page{size:landscape}` 无法用选择器限定范围，会导致主页面打印也变横向。
  正确做法：`openSchedule()` 时注入 `<style media="print" id="schedule-print-scope">`，关闭时移除。
- 打印专用规则：主容器 `.wrap/#toast/.to-top/.modal-mask` 全部 `display:none`；
  `.schedule` 由 `fixed/flex` 改 `static/block`（fixed+flex 容器跨页会被裁成只剩一屏）；
  `.schedule-body` 去掉 `overflow/max-height`；`thead{display:table-header-group}` 让表头每页重复；
  `tr{break-inside:avoid}` 让「一个年级一行」不跨页，`.no-print` 隐藏返回/按钮。
- 文件名：打印对话框默认取 `document.title`，打印期间临时改写、`afterprint` 还原（需 120s 兜底）。
- 局限：脚本无法静默落盘，只能走打印对话框 → 另存为 PDF；Safari 入口是「PDF ▾ → 存储为 PDF」。

## 已踩过的坑（务必避免）
- **卡片网格容器若同时是"有确定高度的滚动容器"，必须显式写 `grid-auto-rows:max-content`**。
  否则（如 `.zone-body{flex:1; max-height:46vh; overflow-y:auto; display:grid}`）Blink 会按 **min-content**
  算自动行高（= 卡片 min-height），内容更高的卡片就会把底部内容（学分）挤到卡片外面。
- **不要用 `-webkit-line-clamp` + `overflow:hidden` 给卡片标题做截断**：
  它的内在高度贡献不可靠（实测 computed display 变成 flow-root），标题会被压成 0 高度而**整块消失**
  （2026-09-25 用户报障「部分卡片课程名缺失」，Chrome/Safari 均中招）。
  现方案：`.c-name{font-size:12px; height:2.8em; overflow:hidden; flex:0 0 auto; min-width:0}` —— 固定两行高度，
  字高贡献确定，卡片高度恒定且不截断任何课程名。
- **flex 列容器的子项要显式写 `flex:0 0 auto`**，否则内容超高时子项会被压扁到不可见。
- **`.zone-body` 的 `max-height:46vh` 会让整页截图高度随窗口高变化**：想用「高视口一次拍全页」定位固定区块会失败
  （窗口 2200 与 3400 时同一元素 y 分别是 2987 与 3639）。要在截图里稳定看到某个区块，
  先注入 `.zone-body{max-height:260px !important}` 压缩框高，再用元素 `getBoundingClientRect().top+scrollY`
  量出坐标后 `sips -c 高 宽 --cropOffset y x` 裁剪。
- **zsh 下 `set -- $var` 不做分词**（zsh 默认不对参数展开做 word splitting），
  写成 `while read -r A B; do ... done <<'EOF'` 传多参数才不会把参数串成一个。
  踩坑表现：`--window-size=$1,900` 拿到 `"1440 file.html,900"`，Chrome 静默失败、诊断块找不到。
- **`.c-meta` 用 `flex-wrap:nowrap` + 长标签 `text-overflow:ellipsis`**，保证标签行永远单行，卡片高度才可控。
- 排查渲染问题的套路：`chrome --headless --dump-dom` 拿真实 DOM → 注入诊断脚本把
  `getBoundingClientRect()`/`scrollHeight` 结果写进 `<pre id="diag">` → 再 dump 回收；
  用「子元素矩形超出父元素内边距盒」做全站溢出扫描（滚动容器内部的纵向越界要排除）。
  定位到可疑规则后用 `!important` 覆盖做 A/B 实验，比读代码猜快得多。
- **无头 Chrome 的 `--window-size` 最小宽度约 500px**：直接传 `--window-size=390,844` 会得到
  「按 500px 渲染 + 只截 390px」的假横向溢出。要验证手机端布局，应把媒体查询临时改成
  `@media all`，并注入 `.wrap{max-width:366px}`（=390 视口 - 左右 12px padding）来仿真。

## 手机端适配约定
- 断点 `@media (max-width:640px)`：topbar 竖排 + 「重置全部」按钮全宽 46px 高；
  `.zh-msg` 独占一行左对齐；卡片网格列宽 146px；Toast 改为贴边通栏并抬到 `bottom:82px`（避开右下角浮动按钮）。
- 触屏提示 `.touch-hint` 用 `@media (hover:none),(pointer:coarse)` 控制显示
  —— HTML5 拖拽在触屏不工作，点击卡片选课/退课才是手机端主路径。
- 手指点按目标：框内小按钮手机端 36px 高，顶部主按钮 46px 高，右下角浮动按钮 50×50。

## 浮动按钮 / 弹框约定
- 右下角浮动按钮（返回顶部）：`fixed; right:20px; bottom:max(24px, 20vh); 46×46`；
  **距底部 = 视口高度的 1/5**（用户指定「往上挪到网页五分之一处」，实测三档视口偏差均为 0）；
  **必须用深色实心 + 白图标**（白底白边叠在白色卡片上会看不见）。手机端 `right:14px` + `bottom:max(18px,20vh)` + 50×50。
- 显隐判定统一收口到一个 `update()`（读实时 `scrollY` + 顶部栏 `getBoundingClientRect`），
  由 scroll / resize / IntersectionObserver 共同调用，不要多个触发源各自判断。
- 弹框用 `hidden` 属性 + `.show` 类做过渡；`role="dialog" aria-modal`；支持点遮罩 / Esc 关闭；
  状态标志位（如 `prevElecOk`）必须声明在 state 区，否则 `resetAll()` 顶层调用会踩 let 的 TDZ。
  **注意：淡出用的 `hidden=true` 在 240ms 定时器里，写完立刻断言会拿到旧值。**

## 图层层级约定（z-index）
- `.zone` 常规内容 → 弹窗 toast `99` → 返回顶部浮动按钮 `120` → 提示框遮罩 `200` → **全屏白色图层 `.schedule` `300`**。
- 全屏图层统一用 `position:fixed; inset:0` + flex 竖排（固定头部 + `flex:1` 可滚动主体），
  这样头部按钮常驻、内容区独立滚动，`<thead>` 用 `position:sticky; top:0` 吸顶。
- 弹窗显隐统一走公共的 `showModal(id)/hideModal(id)`（按 id 各记一个定时器），
  淡出用 `hidden=true` 延迟 220~240ms 执行，**写完立刻断言会拿到旧值**。
- Esc 关闭优先级：全屏选课表 > 达标弹窗 > 学分不足弹窗。

## 选课表（学期映射）
- 横排 上学期/下学期 × 竖排 大一/大二/大三 → 第 1~6 学期：
  `[{大一,[1,2]},{大二,[3,4]},{大三,[5,6]}]`。
- 表格数据直接复用 `expandByTerm()` 把框内课程按学期拆开，与卡片展示口径一致。

## 待选课程池筛选器（重要约束）
- 目前两个，**都只能作用于选修**：必修课若被删，26 门公基必修 / 16 门专业必修 / 总分 138 的达标条件将永远无法满足。
  1. **排除全英文授课**（`btn-exclude-en`）：名称含「全英文」的课共 **16 门 = 必修 12（公共必修 2 + 专业必修 10）+ 选修 4**。
  2. **排除企业课程**（`btn-exclude-com`）：名称含「企业」的课共 **4 门，全部是专业选修**
     （企业订单班课程初级/中级、企业定制课程(综合)、企业订制模块课（自动驾驶技术及应用）），合计 13 学分。
- 两个筛选器互不干扰、可叠加：都开时池 21 门 → 13 门（排除 8 门），剩余选修学分仍 ≥ 42 分，不会把玩法卡死。
- 开启筛选还会把已选进专业课框的同类选修一并退课，并重置 `prevElecOk`；关闭则全部恢复。
  开关状态用 `.opt-chip` 的 `aria-pressed` 表达。
- **代码结构（便于再加筛选器）**：改 `FILTERS` 数组即可——`{key, btn, label, match}`；
  状态在 `FILTER_ON[key]`，渲染用 `isFilteredOut(c)`，交互由 `setupFilter()` 遍历绑定，无需改 render。
- 计数文案按筛选器分列：`（已排除 8 门：全英文 4 + 企业 4）`。
- **「重置筛选」按钮**（`btn-filter-reset`，`.opt-chip.plain`：无圆点 + 虚线边框）紧跟两个筛选器之后，
  一键把所有 `FILTER_ON` 置 false；无筛选开启时加 `.empty` 置灰。
  语义：**只重置筛选器状态，不会把开启筛选时退掉的课自动选回**（那些课只是重新出现在池里可再选）。
