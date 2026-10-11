# Dashboard 改造 · 交接文档(新对话从这里开始)

> 更新于 2026-10-11(Dashboard v2 六个阶段完成后)。给新开的 Claude 会话读:读完这一份就能接着干。
> 用户偏好:**回答简短直接,先给结论,不要事后复述;用中文沟通**。
> 方案原文:`docs/dashboard-v2-plan.md`(v2,已执行完)、`docs/dashboard-revamp-plan.md`(v1,更早)。

---

## 0. 一句话现状

网页版 Dashboard 已从「看板」改成「操作中心」(v2,阶段 1–6 全部完成,分支 `feat/dashboard-feedback-1`)。
用户说:**阶段 6 收尾后,会再让你「统一优化细节」** —— 见第 6 节待办清单。
iOS 侧只合并过 Journal 相册的独立组件,**还没接进 Dashboard**(被别人未提交的 Dashboard 改动挡住),v2 的新设计也**没同步到 iOS**。

| 仓库 | 路径 | 备注 |
|---|---|---|
| Web | `/Users/Holiday_1/Desktop/Growth/On the Road/website/on-the-road` | Vite 8 + TS + 原生 DOM,dev 端口 5180 |
| Web 工作树 | `.../website/on-the-road-fb` | `feat/dashboard-feedback-1` 检出在这里 |
| iOS | `/Users/Holiday_1/Desktop/Growth/On the Road/iOS` | SwiftUI,scheme `On the Road` |

两个仓库是**独立的 git 仓库**。外层 `On the Road/` 和 `/Users/Holiday_1` 也是 git 仓库(指向 Marginalia),**不要混淆**。

---

## 1. ⚠️ Git 与工作区的坑

用户同时开着多个会话,所以:

1. **主工作区不一定在 `main`,且常有别人未提交的改动**(当前:`scripts/notion-sync.mjs`、`src/sw.ts`、`src/views/journal/shared/utils.ts`)。不要 `git add -A`,不要 `git stash`(栈是共享的),不要 `git checkout .`。
2. 做新工作:`git worktree add -b <branch> ../<dir> main`,在 worktree 里开发。worktree 里要补 `node_modules` 软链(`ln -s ../on-the-road/node_modules node_modules`)和 `.env` / `.env.local`(被 gitignore)。
3. **合并到 `main` 的做法(本轮一直这么做)**:先确认 `git merge-base --is-ancestor main <branch>`;若 `main` 前进了,先在 worktree 里 `git merge main`;然后在主目录 `git merge --ff-only <branch>`。主目录里别人未提交的文件只要和分支改动不重叠就不受影响(先 `git diff --name-only main <branch>` 对一下)。**合并只在本地,从未 push。**
4. 提交信息结尾带 `Co-Authored-By: …`(以会话当时 system-reminder 为准)。

---

## 2. v2 已确认的产品决策(不要再讨论)

延续 v1:不做阶段化布局(阶段感靠内容);Currency/Calendar/Journal 决策见 `dashboard-revamp-plan.md`。v2 新增:

- 全页「看详情」统一走**右侧抽屉**(窄屏变底部半屏)。
- 横幅:天气 | 表盘+国家 | 今晚住宿 / 下一班交通(带倒计时)| 这里/家 两个时钟 | 小人。
- 「家的时区」存用户级,缺省按出发城市推断(哈尔滨 → 北京时间),**不用浏览器时区**。
- 行李**永远显示**(不再「临近飞行才出现」)。
- Nomad 并入 Where to go 的「办公」标签;Where to go 无任何数据时整块不渲染。
- **布局(用户在阶段 3 后改过)**:第二行 日历(6)/待办(3)/行李(3);第三、四行:**地图在左(6 栏,跨两行),花费叠在 Journal 上(右 6 栏,等宽)**;底部 Where to go。方案图里原本是 4/4/4 三列并排,已被用户推翻。
- 容器 < 900px 两列:横幅 → 日历 → 待办+行李 → 地图 → 花费 → Journal → Where to go;< 420px 单列。

---

## 3. 文件地图(v2 新增/改动)

### 通用
- `src/core/drawer.ts` / `drawer.css` — `openDrawer({title, subtitle?, body, footer?, returnFocus?, onClose?})` → `{root, body, setBody, close}`;`closeDrawer()`、`isDrawerOpen()`。同时只开一个,Esc/遮罩/✕ 关,焦点锁在内,尊重 reduced-motion。z-index 1100(低于 modal 的 1200)。

### 数据层(`src/data/`,纯函数 + 测试)
- `trip-now.ts` — 横幅模型:`currentStop`、`tonightStay`、`tripTransports`(把交通的当地时刻按「出发地时区」转成时刻)、`nextTransport`、`countdownTo`、`tripDial`、`tripSpan`。
- `tz-math.ts` / `country-timezone.ts` / `home-timezone.ts` — 时区运算、国家/城市→IANA、家的时区解析(设置 → 行程 homeCity → 第一班交通出发地)。
- `stores/user-prefs-store.ts` + `schema/user-trip.ts` 的 `UserPrefsSchema` — `users/{uid}/userPrefs/me`,目前只有 `homeTimezone`。Profile 页「偏好设置」里有下拉框(`views/profile/profile-home-tz.ts`)。
- `pack-summary.ts` + `packing-formula.ts` 的 `baggageLimitG` — 行李三态(none / near / idle)。**限额口径 = 托运 + 随身(旧的单值算随身)**。原因:行程编辑器现在只写分项字段、不再写旧的 `baggageAllowanceG`,原先只读旧字段的逻辑读不到新录入的航班。
- `todo-order.ts` — 选中日到期 → 逾期 → 之后 → 无日期。
- `plan-days.ts` — `planDaysFor`(一晚一天,和行程页一致)、`pickPlanDay`(退房日/范围外就近落点)、`legForDate`。
- `day-map.ts` — 「这一天」地图模型(住宿 + 当天计划项 + 换城市当天的出发城市),坐标走同步解析器,解析不了的进 `pending`。
- `whereto-model.ts` — 标签与卡片;`tripHasRecommendations` 决定整块渲不渲染。
- `day-agenda.ts` — v1 就有,**Dashboard agenda 与 Calendar 视图共用,不要写第二份聚合**。

### 视图(`src/views/dashboard/`)
- `dashboard.ts` — 编排:state、layout、wire、init。仍是最大的文件。
- `dashboard-banner.ts`(渲染 + 20 秒 tick 更新指针/倒计时,不整页重渲染)、`banner-drawers.ts`(住宿/交通抽屉)、`banner-format.ts`。
- `dashboard-agenda.ts` + `agenda-drawer.ts` — 紧凑月历 + 当日日程;计划/交通/住宿行点开抽屉(计划项有「地图 ↗」和一行「记一笔」),其余类型照旧跳页;`+` 通过 `openAddPlanModal` 加到当天。
- `dashboard-todo.ts`、`dashboard-pack.ts`(含行李抽屉)。
- `dashboard-map.ts`(amCharts,「整个旅程」)、`dashboard-daymap.ts`(Leaflet,「这一天」,**懒加载**)。模式切换在卡片头部;默认「这一天」,旅程结束后默认「整个旅程」。
- `spend-drawer.ts` — 花费 `+`(表单在前)/点总额(列表在前)。
- `dashboard-journal.ts` + `journal-places.ts` — 三张城市方形缩略图 + 城市抽屉(旧轮播已删)。
- `dashboard-whereto.ts` — 标签 + 横向卡片轨道,轨道滚动位置跨重渲染保留。
- `dashboard-modals.ts` — 待办弹窗、行李变动弹窗、`openAddPlanModal`(Where to go 的 `+` 也用它)。
- 样式:`styles/{grid,banner,agenda,widgets-*,journal-album}.css`;共用的圆形 `+` 在 `widgets-list.css` 的 `.td-plus`。

### i18n
`src/core/i18n/{en,zh}.ts` 已覆盖 Dashboard v2 全部新文案(含待办/行李弹窗);es/fr/ja/ko 回退英文。
`src/core/i18n/dashboard-keys.test.ts` 扫描 Dashboard 相关源码里所有 `t('…')`(含条件式和已登记的模板键),断言 en 与 zh 都存在 —— **新增文案漏了翻译会直接红**。模板键要在该测试的 `EXPANSIONS` 里登记。

---

## 4. 验证方法

- Web:`npx tsc --noEmit`、`npx vitest run`(当前 765 通过)、`npx vite build`。
- `npx eslint src` 有 **2 处不在本轮改动范围的既有报错**:`src/core/utils.ts:50`(innerHTML)和 `src/views/expenses/expenses.ts` 的 max-lines。
- **没有登录也能看 UI**:建临时 `_harness/*.html`,先 `import '/src/data/trip-context.ts'`,再 import `base.css`/`app.css`,给 `routeStore/journalStore/todoStore/expenseStore/packStore/cityStore` 打桩(`s.peek = () => rows; s.subscribe = cb => { cb(rows); return () => {}; }`),`nomadStore.peek` 和 `nomadStore.subscribeForTrip` 单独打桩;页面容器要加 `class="view active"`(否则 `.view` 是 display:none,截图是空白);固定「今天」就覆盖 `globalThis.Date`;`vite --port <p>` 起服务后:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --window-size=W,H --virtual-time-budget=9000 --screenshot=out.png "http://localhost:<p>/_harness/x.html"`
  - **点击后截抽屉**:在页面里 `setTimeout(() => document.querySelector(sel)?.click(), 1500)`,并给页面加 `.otr-drawer-scrim,.otr-drawer{animation:none!important}`(否则无头截图可能截到动画起点,抽屉不可见)。
  - 窄屏用给 `#view-today` 设固定 `width` 来模拟(无头 Chrome 窗口最窄约 500px)。
  - 沙箱里 OSM 瓦片和 Nominatim 被拦,**地图底图是灰的、住宿点出不来**;frankfurter 汇率也会报 CORS。
  - zsh 下 `--include=*.ts` 这类通配要加引号。
  - 用完删 `_harness/`,提交时别带上。
- Vitest 默认 `environment: 'node'`;要 DOM 的测试文件顶部加 `/** @vitest-environment jsdom */`。测 `data/` 里依赖 `trip-phase.ts` 的模块时,要 `vi.mock('./trip-context.ts')` 和 `vi.mock('./stores/route-store.ts')`。

---

## 5. 代码约定速记

- 原生 DOM + 字符串模板;所有插值走 `esc()`(`escHtml`),外部 URL 走 `safeUrl()`(只放行 http/https,**data: URI 会被拒**);`innerHTML` 处加 `eslint-disable-next-line no-restricted-syntax -- audited` 注释。
- 抽屉/弹窗的点击处理要「点击时再取最新数据」(`get: () => state`),不要闭包捕获渲染时的数组。
- 设计 token:`var(--amber-*)`、`--ink-*`、`--surface-*`、`--rule-soft`;按钮 `btn btn-primary`(黄)/`btn btn-ghost`。
- Dashboard 整页是 `render()` 整体重绘 + `swapHtml` 保留地图画布节点;store 回调走 `scheduleRender`(合并),用户动作直接 `render()`。
- iOS:`Color.otr*`、`OTRRadius`、`OTRCachedImage`;`SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`。

---

## 6. 待办

### 用户已说「阶段 6 后统一优化」的细节(按我记下的清单)
1. **日历卡片「垂直高度回到改版前」没法精确做** —— 没量过改版前的像素高度,目前约 345px(原来约 370)。需要用户给目标值或看截图判断。
2. Journal 标题右上角 `+` 与底部「Write an entry」按钮功能重复(方案原话两个都要)。
3. 窄屏下横幅的两个时钟会单独占一行,偏占高度。
4. 抽屉内容不随 store 更新(打开后数据变了要关了再开)。
5. 天气块两位数温度时折成两行(原有行为,方案要求不动)。
6. 窄屏下 Journal 缩略图在 2 列/单列时变得很大。

### 需要在真实环境验证(沙箱里做不到)
- 地图底图(OSM 瓦片)是否加载、街道级缩放观感;住宿地理编码定位流程(Nominatim)。
- 地理编码结果目前只缓存在 localStorage,**没有写回 Firestore**(行程页原有逻辑会写回计划项坐标)。
- 登录态下:Profile「家的时区」保存、`customCurrencies` 写 Firestore、花费/「记一笔」真正写入、行李 `+`/`−` 弹窗保存、「+ 添加到这一天」弹窗。
- 滑入动画与 `prefers-reduced-motion` 只看过静态截图;没有真机/手机实测。

### 其他
- 交通数据没有预订链接字段,所以交通抽屉**没有**「打开预订 ↗」(住宿有)。要做得先在行程页加字段与编辑入口。
- es/fr/ja/ko 补 v2 文案(现在回退英文)。
- 把 v2 设计同步到 iOS;iOS 把相册接进 Dashboard Journal 卡(前置:`main` 上别人的 Dashboard 未提交改动先提交)。
- 日程 `plan` 副标题还是原始分类 id(如 `food`);`day-agenda.ts` 的 `contextItems` 里 "Day N of M in …" 仍是硬编码英文(目前 Dashboard 不展示它,Calendar 视图可能用到)。
