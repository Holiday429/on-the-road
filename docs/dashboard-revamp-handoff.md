# Dashboard 改造 · 交接文档(新对话从这里开始)

> 写于 2026-10-10。给新开的 Claude 会话读:读完这一份就能接着干,不需要翻旧对话。
> 用户偏好:**回答简短直接,先给结论,不要事后复述;用中文沟通**。

---

## 0. 一句话现状

网页版 Dashboard / Calendar / Currency 改造的 **Phase 0–4、6 已全部合并到 web `main`**;i18n 与重绘性能的收尾也已合并。
iOS 侧只合并了「Journal 相册」的**独立组件**,**还没接进 Dashboard 的 Journal 卡片**(被别人未提交的 Dashboard 改动挡住)。

| 仓库 | 路径 | `main` 当前 | 备注 |
|---|---|---|---|
| Web | `/Users/Holiday_1/Desktop/Growth/On the Road/website/on-the-road` | `224d556` | 技术栈 Vite 8 + TS + 原生 DOM,dev 端口 5180 |
| iOS | `/Users/Holiday_1/Desktop/Growth/On the Road/iOS` | `709c22f` | SwiftUI,scheme `On the Road` |

两个仓库是**独立的 git 仓库**。外层 `On the Road/` 和 `/Users/Holiday_1` 也是 git 仓库(指向 Marginalia),**不要混淆**。

---

## 1. ⚠️ 先读:Git 与工作区的坑(这是上一轮踩过的)

用户同时开着多个会话在写代码,所以:

1. **工作目录不一定在 `main`。** 上一次发现 web 目录被别的会话切到了 `perf/instant-entry`。动手前先 `git branch --show-current`,并用 `git rev-parse main` 取 `main`,不要拿 `HEAD` 当 `main`。
2. **`main` 工作区里有别人未提交的改动**(web 约 5 个文件、iOS 约 43 个文件)。不要 `git add -A`,不要 `git stash`(stash 栈是共享的),不要 `git checkout .`。
3. **做新工作:`git worktree add -b <branch> ../<dir> main`**(从 `main` 切,不是 `HEAD`),在 worktree 里开发,不碰主工作区。
   - worktree 里要补:`node_modules` 软链(`ln -s ../on-the-road/node_modules node_modules`)、`.env` / `.env.local`(web,被 gitignore)、`GoogleService-Info.plist`(iOS,被 gitignore,否则测试宿主崩溃)。
4. **合并到 `main`:**
   - `main` 没被任何 worktree 检出时,可以在**自己的 worktree 里** `git checkout main && git merge --ff-only <branch>`,这样不会碰别人的目录。
   - 如果目录恰好就在 `main` 且有重叠的未提交文件:先把重叠文件的 diff 存成 patch → 反向 apply → `git reset -q`(合并要求暂存区干净,别人的 staged 删除要事后用 `git rm --cached` 恢复)→ merge → `git apply --3way` 重新应用 patch → 取消暂存。上次的合并就是这么做的,没丢东西。
5. 提交信息结尾带:`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`(以会话当时 system-reminder 为准)。

---

## 2. 已确认的产品决策(不要再讨论)

- **不做阶段化布局。** before/during/after 不切换布局;阶段感通过**内容**体现(地图国家着色、agenda 提示、hero 文案)。理由:74 天、9 国的长途旅行,三阶段布局切换没意义,且会让用户困惑。
- **Currency**:地理定候选币种,近期消费修正(最近 3 天同国 ≥3 笔、主力币种不同 → 用实际币种);Dashboard 只显示 hero 里的一行 `1 EUR = 7.46 DKK ▾`,点击展开换算器。frankfurter.app 只有约 31 种实时币种 → 其余为「估算」或用户自定义(手填汇率)。自定义币种**只在 Expenses 页管理**。
- **Calendar**:侧边栏独立入口(钉在 Dashboard 旁,**仅桌面**,手机从 agenda 的「日历 ›」进);完整双栏版面。iOS 侧边栏本来就有 Calendar。
- **Safety 组件已删**;**Pack 只在下一段有行李限额的交通前 ≤2 天出现**。
- **Journal**:「记一笔」按钮在最下方、黄色填充(同 Spend 的 Save);空白区做成按城市轮播的照片集。

完整方案原文:web 仓库 `docs/dashboard-revamp-plan.md`(已在 `main`)。

---

## 3. Web 已完成的内容与文件地图

### Phase 0 清理
- 删 Safety;Pack 条件渲染(`packVisible()` 在 `dashboard.ts`)。
- To-do 的 Add 改黄色;组件标题/链接/Journal 文案全部走 i18n;hero 天气加降水概率 `☔`。
- 侧边栏**收窄态**:日期数字按位数缩字号(`data-len` → 22/18/14px),图标 36px、间距加大,分组标题变细分割线(`mobile-nav.css` 与 `responsive.css` 两处同步)。

### Phase 1 Currency
- `src/data/country-currency.ts`:完整国家→币种表,`currencyForCountry()` / `knownCurrencyForCountry()`。
- `src/data/rates.ts`:`CURRENCIES`(31 个实时)+ `EXTRA_CURRENCIES`(18 个静态估算)+ 自定义币种;读取时 `finalize()` 叠加估算与手填汇率;请求 frankfurter 时**不带 `symbols`**(避免某币种被下架导致整个请求 422)。
- `src/data/schema/user-trip.ts`:`TripSchema.customCurrencies`;`trip-context.ts`:`customCurrencies()` / `setCustomCurrency()`,并通过 `registerCustomCurrencySource` 注入 rates(避免循环依赖)。
- `src/views/expenses/expense-defaults.ts`:`suggestedCurrency()`。
- `src/views/expenses/currency-manager.ts`:Expenses 页「＋」弹窗(增删自定义币种)。
- Dashboard:hero 一行 `renderRateLine()`,展开面板 `renderRatePanel()`。

### Phase 2 Agenda(核心)
- **`src/data/day-agenda.ts`**:按**日期**聚合的纯函数,移植自 iOS `CalendarStore.day(on:)`。`agendaForDay(iso, src)`、`kindsByDate(src)`、`undatedTodos()`、`AGENDA_COLORS`。**Dashboard agenda 与 Calendar 视图共用它,不要写第二份聚合。** 换城市当天 `leg` 取"当天开始的那一程",同时给出 `leavingLeg`;`flags` 提供抵达日/离开前一天/最后一天等。
- `src/views/dashboard/dashboard-agenda.ts`:左侧紧凑月历 + 右侧当日日程;今天/明天切换;点月历任一天;今天无内容时跳到「Next up」;行程项/待办可内联勾选。
- 删除了旧的 Upcoming feed、月历小组件、hero 的交通/住宿 chips。

### Phase 3 Calendar
- `src/core/app.ts` `NAV_ITEMS` 增 `calendar`(emoji 🗓️,`section:'pinned'`,`desktopOnly:true`);`sidebar.ts` 的 `NavItem` 增 `desktopOnly`,手机底栏过滤掉。
- `src/views/calendar/calendar.ts` + `calendar.css` 整体重写:左侧月历 + 图例 + 本月统计 + 全部待办;右侧常驻日面板(航班/住宿/行程/日记/待办/消费,可展开详情、可点进对应页);窄屏堆叠。支持 `navigateTo('calendar', { date })` 的 intent(含已挂载时的 `otr:nav-intent`)。**补上了消费聚合**(网页此前缺)。

### Phase 4 用内容表达阶段
- `src/views/map/map-status.ts`:`legStatus` / `countryStatuses`;Dashboard 地图国家按 过去(灰)/当前(绿)/未来(琥珀)着色(`dashboard-map.ts`),图例走 i18n。
- hero 文案按阶段(`dash.hero.*`),after 阶段有「查看旅行回顾」按钮 → Journal。
- `src/data/trip-phase.ts` 的 `todayIso()` 从 UTC 改成**本地日期**(影响全 app,是修 bug)。

### Phase 6 Journal 相册(网页)
- `src/views/dashboard/journal-places.ts`(纯分组,有测试)+ `dashboard-journal.ts`(轮播渲染/定时器,尊重 `prefers-reduced-motion`,图片懒加载)+ `styles/journal-album.css`。
- 规则:place = `entry.destination`,否则当天所在行程城市;多个城市 → 每城一张、最新在前;只有一个城市 → 展开成该城的单张照片;最多 8 张。

### 收尾(已合并 `224d556`)
- i18n:`day-agenda.ts` / `calendar.ts` 的副标题、详情标签、图例走 `t()`,**en + zh**(其他语言回退英文)。
- 性能:`dashboard-render.ts` —— `createRenderScheduler`(store 回调合并成一次渲染)、`swapHtml`(保留地图 canvas 节点)、`captureUiState/restoreUiState`(保留输入内容与焦点)、`mapSignature`(只有地图相关的行程字段变化才重建地图)。

### 网格布局(`styles/grid.css`)
12 栏:agenda(1–6)/ spend(1–6)/ map(7–12,跨两行);journal(1–8)/ todo(9–12);pack(1–4,仅临近飞行)+ whereto(5–12,无 pack 时 1–12);nomad(12,有数据才显示)。三档容器查询(680/580/420)。

---

## 4. iOS 状态

- 已合并(`709c22f`),**全是新增独立文件**,无 UI 变化:
  - `Features/Dashboard/JournalPlaces.swift`(分组,`PlaceSlide`)
  - `Features/Dashboard/JournalAlbumStore.swift`(订阅 journalEntries + legs)
  - `Features/Dashboard/JournalAlbumCarousel.swift`(轮播视图)
  - `On the RoadTests/JournalPlacesTests.swift`(7 个测试,已通过)
- **未做:接入 Dashboard。** 待 `main` 上那批未提交的 Dashboard 改动(`DashboardMiniCard` / `BagQuickCard` / 新 Hero 等,当时是 untracked 或 modified)提交后,基于最新 `main` 重建分支,在半宽 Journal 卡里持有一个 `JournalAlbumStore`,把「N entries」数字区换成 `JournalAlbumCarousel`;无照片时保持原样。轮播**实际画面还没人看过**(预览用的是假 URL)。
- iOS 测试要点:`xcodebuild` 部署目标是 iOS 26.5,需要 26.5 模拟器;没有现成设备时 `xcrun simctl create` 一个,用完 `simctl delete`。

---

## 5. 下一步(按优先级)

1. **iOS:把相册接进 Dashboard Journal 卡**(前置:`main` 上 Dashboard 改动已提交 —— 先问用户是否已提交)。
2. 其他语言(es/fr/ja/ko)补 agenda / calendar / currency / hero 的新文案(现在回退英文)。
3. 真机/真数据走查:登录态、`customCurrencies` 写 Firestore、Expenses「＋」弹窗(这些**没有**实际验证过)。
4. 可选:Calendar 在手机上的入口体验、agenda 的 plan 副标题还是原始分类 id(如 `food`)。

---

## 6. 验证方法(可直接复用)

- Web:`npx tsc --noEmit`、`npx vitest run`(当前 673 通过)、`npx vite build`。
- **没有登录也能看 UI 的办法**:建一个临时 `_harness/*.html`,import 真实模块,给 `routeStore/journalStore/todoStore/expenseStore/packStore/nomadStore/cityStore` 打桩(`s.peek = () => rows; s.subscribe = cb => { cb(rows); return () => {} }`),用 `vite --port <p>` 提供,再用 headless Chrome 截图:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --window-size=1250,1500 --virtual-time-budget=15000 --screenshot=out.png "http://localhost:<p>/_harness/x.html"`
  - 注意 ① 要先 `import '/src/data/trip-context.ts'`,否则 `db.ts ↔ trip-context.ts` 循环依赖会报 `_myTripIdsResolver` 未初始化;② 想"固定今天"就覆盖 `globalThis.Date`;③ headless Chrome 窗口最窄约 500px,要测手机宽度请给容器设固定 `width`;④ 用完删除 `_harness/`,提交时用 `git add -A -- . ':(exclude)_harness'`。
- Vitest 默认 `environment: 'node'`;需要 DOM 的测试文件顶部加 `/** @vitest-environment jsdom */`。
- Vite 8 的 `*.test.ts` 里 `localStorage` 不存在(代码里读写都包了 try/catch)。

---

## 7. 代码约定速记

- Web:原生 DOM + 字符串模板;所有插值走 `esc()`(`escHtml`);`innerHTML` 处有 `eslint-disable-next-line no-restricted-syntax -- audited` 注释。
- i18n:`src/core/i18n/{en,zh,es,fr,ja,ko}.ts`;`t(key, vars)` 缺失时回退 en。新文案**至少补 en + zh**。
- 设计 token:`var(--amber-*)`、`--ink-*`、`--surface-*`、`--rule-soft`;按钮 `btn btn-primary`(黄)/`btn btn-ghost`。
- 地图:amCharts5(CDN 懒加载),Dashboard 缩略图在 `dashboard-map.ts`;完整 `/map` 用自己的"逐国点亮"调色板,**没改**。
- iOS:`Color.otr*` 自适应色板、`OTRRadius`、`OTRCachedImage`;`SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`(纯值类型的静态成员/测试要注意隔离)。
