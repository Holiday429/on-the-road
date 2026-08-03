# Execution plan — 产品结构精简(2026-08-02)

五项已确认方向:① Safety 并入 Guide + 新 Profile 页;② Checklist+Pack 合并为 Prepare;
③ Nomad 摘除主导航、咖啡内容并入 Guide;④ Compare 自动打分优化;⑤ Dark mode。
主导航从 11 项收敛到 8 项(Dashboard / Prepare / Compare / Itinerary / Guide / Map /
Expenses / Journal),Profile 走侧栏账号入口不占导航。

统一验收底线:每阶段结束 `npx tsc --noEmit`、`npm run lint`、`npm test`、
`npm run build` 全绿。所有新增用户可见字符串走 `t()`,en + zh 双份。

执行顺序:**P1 dark mode → P2 compare → P3 nomad → P4 safety+profile → P5 prepare 合并**。
P1/P2 独立无依赖;P3 先落地"旧路由重定向"公共设施给 P4/P5 复用;P5 改动最大放最后。

---

## 关键背景事实(已核实,勿重新调研)

- **路由**:`NAV_ITEMS` 在 `src/core/app.ts:31-47`;hash 路由三处入口——boot
  (`app.ts:297-299`,无效 hash 落到 `firstAllowedView()`)、`hashchange`
  (`app.ts:301-304`,**不在 NAV_ITEMS 的 hash 静默无操作**,需显式重写)、
  signed-out 路径 `app.ts:210`(fallback 硬编码 `'prep'`,不一致)。
- **calendar 先例**:从 `NAV_ITEMS` 移除但保留 `ViewId` + `app.html` 静态标题,
  视图仍可路由(`app.html:90-96`)。`renderViewTitleMarkup`(`sidebar.ts:124-130`)
  对不在 NAV_ITEMS 的 id 会因非空断言崩溃——摘除导航时必须检查调用方。
- **分享链接**:`page-collections.ts:18-31` 的 `PAGE_COLLECTIONS` 是 view→集合映射,
  写入 `trip.publicView.collections` 供 rules 放行;`trip-share.ts:25-29` 的
  `PAGE_LABELS` 是手工镜像,须同步改。已存 invite 里的旧 page id 会被
  `setAllowedViews`(`app.ts:55-60`)静默丢弃 → 需要 legacy 映射。
- **max-lines 棘轮**(`eslint.config.js:81-92`):`map.ts` 1803 / `itinerary.ts` 1799 /
  `expenses.ts` 1468 / `guide.ts` 1457 / `dashboard.ts` 1331,**只能减不能加**。
  涉及这些文件的新逻辑一律放新模块再 import,或顺手外移等量代码。
- **innerHTML lint**:`src/core/**` 和 checklist/pack/compare/dashboard 在
  error-tier(`eslint.config.js:37-72`),新 innerHTML 写入需
  `// eslint-disable-next-line no-restricted-syntax -- audited: …`。
- **无 DOM/e2e 测试**,vitest 全是纯逻辑(node env)。新增可测逻辑尽量提炼纯函数
  (参照 `boot-flow.test.ts` 风格)。
- **iOS 端共用 API 和 Firestore 结构**(独立仓库),`/api/safety`、`citySafety`
  文档、`nomadSpots` 不能删,只能加。

---

## P0(并入 P3 第一步)— 旧路由/旧分享 legacy 映射

**目标**:一次性提供 view id 迁移设施,P3/P4/P5 复用。

**步骤**:
1. `src/core/app.ts`:新增 `LEGACY_VIEW_MAP: Record<string, ViewId>`
   (最终态 `{ nomad:'cities', safety:'cities', pack:'prep' }`,各阶段各加各的)。
   三处 hash 入口(`:210`、`:297-299`、`:301-304`)先查映射再校验;
   `hashchange` 对未知 hash 显式 `navigateTo(firstAllowedView())` 修掉静默 no-op;
   `:210` 的 `'prep'` fallback 改 `firstAllowedView()`。
2. `setAllowedViews`(`app.ts:55-60`)与 `boot-invite.ts:119`:过滤前先把
   legacy id 映射成新 id,老 invite 不失效。
3. `sidebar.ts:124-130` `renderViewTitleMarkup`:非空断言改安全查找,查不到回退
   `t('nav.'+id)`。

**验收**:手输 `#nomad`/`#safety`/`#pack` 均正确落到新视图;带旧 pages 的
分享链接仍能看到对应内容。

---

## P1 — Dark mode

**目标**:全站暗色主题,三态切换(浅/深/跟随系统),无闪烁,持久化。

**背景事实**:token 全部在 `src/core/base.css:8-105` 单一 `:root`,仅 24 个颜色值
token;硬编码色值 CSS 390 hex + 154 rgba(62 文件)、TS 209 hex。`#fff` 出现 112 次
(→ `--surface`);成功/危险/警告/信息色系(`#15803d`/`#b91c1c`/`#92400e`/`#0369a1`
及配套浅底)完全没有 token,~100 处。CSS 不内联进 `app.html`(Vite 构建时注入
link),防闪烁必须用 head 内联脚本。语言偏好 key 为 `otr_locale`
(`i18n.ts:54`),同步到 `users/{uid}.locale`(仅在本地无值时读云端)。

**涉及文件**:新建 `src/core/theme.ts`、`src/core/theme.test.ts`;改 `app.html`、
`src/core/base.css`、`src/views/map/map-shared.ts`、`src/data/palette.ts`、
62 个 css 的清扫、`public/manifest.json` 不动。

**步骤**:
1. **token 扩容**(`base.css`):light 侧新增语义 token
   `--success/--success-bg/--danger/--danger-bg/--warning/--warning-bg/--info/--info-bg`;
   新增 `:root[data-theme='dark']` 块覆盖全部颜色 token(24 + 新增 8 组);
   `color-scheme: light dark` 声明。暗色下阴影 token(`--shadow-*`)降为
   边框/深表面方案。
2. **无闪烁启动**:`app.html` `<head>` 最前插入内联脚本——读
   `localStorage['otr_theme']`(`'light'|'dark'|'system'`,缺省 system),结合
   `matchMedia('(prefers-color-scheme: dark)')` 设 `documentElement.dataset.theme`,
   同步改 `<meta name="theme-color">`(`app.html:18`)content。auth-screen
   (`app.html:33`)一并 token 化——它是第一屏。
3. **`src/core/theme.ts`**:纯函数 `resolveTheme(stored, systemPref)` +
   `initTheme()`(监听 system 变化、云端同步到 `users/{uid}.theme`,复用
   `i18n.ts:129-152` 的"本地优先"模式)+ `createThemeToggle(container)`
   (交互复刻 `language-picker.ts`)。测试对齐 `boot-flow.test.ts` 风格。
4. **切换入口**:Dashboard 问候行语言标签旁(`dashboard.ts:1256-1261` 的
   `[data-lang-mount]` 同级加 `[data-theme-mount]`)。⚠️ `dashboard.ts` 顶格 1331 行:
   把现有 lang-picker 挂载块连同 theme 挂载一起抽到新模块
   `src/core/pref-mounts.ts`,dashboard 净行数只减不增。
5. **清扫硬编码色**:按文件批量替换为 var()。优先级顺序(占比最大):
   `base.css`(:root 外 17 hex)→ `journal/styles/*` → `map.css` → `pack.css` →
   `checklist.css` → `itinerary/styles/*` → `popover-share.css` → 其余长尾 +
   `onboarding.css`。TS 内联色:`itinerary-utils.ts`、`dashboard.ts`、`guide.ts`
   (⚠️ 均有棘轮/顶格,改动做到行数中性)、`checklist.ts`、`pack-helpers.ts`、
   `expenses.ts`。
6. **特殊面**:
   - amCharts 地图:`map-shared.ts:5-11` `MAP_COLORS` 常量改主题感知 getter
     (`landing-map` / `dashboard-map` / `map` 三处共用);主题切换时发
     `otr:theme-change` 事件,地图视图重建 chart(监听逻辑放
     `map-shared.ts`,勿碰 `map.ts` 行数上限)。
   - Leaflet 瓦片(`itinerary.ts:608`、`guide.ts:1039`、`capture.ts:394`):v1 用
     `[data-theme='dark'] .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg)
     saturate(.7) brightness(.9) }`,后续再评估 CARTO dark 瓦片。
   - `palette.ts` `NOTE_PALETTE`(近白便签底):新增 `resolveNoteColor` 的暗色
     映射表,**渲染时映射,不迁移存储值**(消费方:journal 模板/卡片、
     checklist 便签、itinerary、pack-helpers)。
   - Journal 分享卡 canvas(`card-spec.ts:30-36`):**保持浅色不动**——导出图片
     是对外分享物,不随 app 主题。
7. 对比度自查:正文 4.5:1、大字 3:1;语义色暗底提亮一档。

**验收**:两种主题 + 跟随系统逐视图过一遍(含 auth 屏、onboarding、paywall、
分享 viewer 模式);刷新无白闪;`theme.test.ts` 覆盖 resolveTheme 分支。

---

## P2 — Compare 优化

**目标**:三步出结论——选类型 → 填原始数字 → 看带归因的 verdict;权重只在
不认同结论时才调。

**背景事实**:加权打分已存在——`defaultDimensions(type)`
(`compare-store.ts:29-73`)就是分类型模板(含默认权重和方向);
`scoreGroup`(`:104-162`)已做归一化+加权。三个缺陷:① number 维度 min-max
归一化在两个候选时恒为 1.0/0.0,量级信息全丢(`:118-123`);② 缺值维度不进分母,
填得少反而分高(`:146-149`);③ verdict(`compare.ts:368-398`)只列冠军不讲原因。
另:`fieldPrice`(`compare-store.ts:78-83`)对千分位数字解析出错;`€` 硬编码 5 处
(`compare.ts:109,110,228,229,232`)而 `rates.ts` 的 `currencySymbol()` +
`trip-context.ts` 的 `baseCurrency()` 闲置;维度添加用原生
`prompt()/confirm()`(`compare.ts:596-606`);`TYPE_FIELDS` 标签硬编码英文而
`compare.fieldXxx` i18n key 已存在(`en.ts:390-402`)。

**涉及文件**:`src/views/compare/compare.ts`(655 行,无棘轮)、
`src/data/stores/compare-store.ts`、新建 `src/views/compare/compare-verdict.ts`、
`src/core/i18n/en.ts`+`zh.ts`。

**步骤**:
1. **打分修正**(`compare-store.ts`):number 维度归一化从 min-max 改为
   比值法——lower-better 取 `best/v`,higher-better 取 `v/best`(值域 (0,1],
   保量级);缺值给中性 0.5 并在矩阵格显示"未填"徽标(替代虚高);
   `fieldPrice` 重写,兼容 `1,200.50` 与 `1.200,50` 两种格式。
2. **自动打分覆盖 duration**:新增 `parseDurationMin('3h40m'|'21:05'…)` 纯函数
   (放 store,补进 `stores.test.ts`);flight/train 的 `duration` 字段自动成为
   lower-better number 维度,用户不再手动打分。
3. **货币**:候选列价格显示用 `currencySymbol(baseCurrency())`,去掉 5 处硬编码 €。
4. **verdict 归因**(新文件 `compare-verdict.ts`):用 `result.cells` 的
   `norm × weight` 算 top1 vs top2 的分维贡献差,输出"A 胜在价格、时长;
   B 在位置领先";若存在某单一维度权重 ±1 即可翻盘,补一句敏感度提示。
5. **交互清理**:`promptAddDimension` 改 `core/modal.ts` 弹窗(类型/方向/权重
   一屏选完);`TYPE_FIELDS` 接上既有 `compare.fieldXxx` key;`Yes/No` i18n 化。
6. 顺手:`compare.ts` 若超 900 行则按 verdict/matrix 拆文件。

**验收**:两候选机票只填价格+时长即出合理结论且分差反映量级;缺值候选不再
虚高;中文界面无英文残留;`stores.test.ts` 新增归一化/解析用例全绿。

---

## P3 — Nomad 摘除导航,咖啡内容并入 Guide

**目标**:主导航去掉 Nomad;Guide 咖啡 tab 升级(AI 生成办公友好度 + 用户已存
打卡点);数据与 iOS/地图/Dashboard 消费方不动。

**背景事实**:`nomadStore` 被 `map.ts:395`、`dashboard.ts:1316` 消费,必须保留;
Guide→Nomad 桥已存在(`guide.ts:754-777`,咖啡/餐厅卡"存为 spot"),但有两个
bug:ratings 全 0、`ownerId: ''`(对照 `nomad.ts:236`);`cafesPrompt` 在
`api/guide.ts:263-267`;`GuideCardSchema` 在 `src/data/schema/guide.ts:8-26`。

**步骤**:
1. **P0 全套**(见上)+ `LEGACY_VIEW_MAP` 加 `nomad → 'cities'`。
2. **摘导航**(calendar 先例):删 `NAV_ITEMS` nomad 行(`app.ts:42`)、
   `main.ts:46` 注册与 `:28,31` 预取;`ViewId` 保留;`app.html` `#view-nomad`
   块保留但内容不再可达(下阶段回收)。`PAGE_COLLECTIONS` 删 `nomad` key,
   `cities` 改 `['cityIntel','nomadSpots']`;`PAGE_LABELS` 同步。
3. **AI 办公友好度**:`GuideCardSchema` 加可选 `work?: string`(一句话:
   wifi/插座/久坐氛围);`cafesPrompt` JSON 模板加该字段并在提示词中限定
   "仅当适合办公才填";`applySection`/渲染不需改结构,卡片正面加一个
   💻 chip(有 `work` 才显示)。
4. **打卡点上浮**:Guide 咖啡 tab 顶部加"我的咖啡打卡"横条——
   `nomadStore.subscribeForTrip(null)` 按当前城市过滤,复用
   `nomad-types.ts` 的 `composite()` 显示综合分;空态不渲染。桥接 bug 修复:
   `ownerId` 传真实 uid,ratings 留空提示去评分。⚠️ `guide.ts` 顶格 1457 行:
   横条渲染+订阅放新文件 `src/views/guide/guide-nomad-strip.ts`。
5. `views/nomad/` 文件暂保留不删(视图代码只是不可达;`nomad-modal.ts` 的
   Places 详情弹窗被打卡横条复用作详情查看)。

**验收**:导航无 Nomad;`#nomad` 跳 Guide;新生成的 city guide 咖啡卡带 💻
信息;有历史 spot 的城市在咖啡 tab 看到打卡横条,点开详情正常;地图 nomad
图层、Dashboard widget 不受影响。

---

## P4 — Safety 并入 Guide + Profile 页

**目标**:Safety 从导航消失;安全内容成为 city guide 一部分(单次生成、单次
计费);紧急电话保静态数据源 + 离线可达;emergency card / 语言 / 主题 / 账号
归并进新 Profile 页。

**背景事实**:`citySafety` 与 `cityIntel` 同为 `trips/{tripId}/…/{slugId(city)}`,
**同 key 零迁移**;emergency card 在 `users/{uid}/safetyProfile/me`
(user 级,**零迁移**),UI 是 `profile-sheet.ts`(405 行,依赖仅
`uploadSafetyDoc`、`nationalities.ts`、i18n);`/api/safety` 的 geocode 模式无鉴权
免费,generate 模式计 1 credit;`/api/guide` 是 8 条并行管线的 SSE,整体 1 credit;
静态电话库 `safety-static/countries.ts` 是电话号码唯一可信源(AI 提示词已含
"不确定勿猜");账号弹窗 `core/account.ts`(邮箱/plan/购买记录);
Safety 视图无 credit pill(不一致)。essentials(通用行前安全常识)正是用户
要求砍掉的内容。

**步骤**:
1. **生成合流**(`api/guide.ts`):新增第 9 条管线 `safety`——prompt 取
   `api/safety.ts` 的精简版(只要 city 特有:emergencyNumbers/embassy/hospitals/
   areasToAvoid/commonScams,**明确指示跳过通用建议**;号码不确定留空);
   emit `{section:'safety'}`。客户端 `applySection` 收到后写入
   `safetyStore.save()`(保持独立 `citySafety` 文档,iOS 兼容、分享集合不变)。
   `/api/safety` 端点原样保留(iOS + geocode)。顺手:给 `api/safety.ts` 补
   `config.maxDuration`(现默认 10s,有超时隐患)。
2. **Guide Safety tab**:`TABS`(`guide.ts:53-62`)加 `safety`(非 isDo);渲染
   放新文件 `src/views/guide/guide-safety-tab.ts`——顶部电话条(数据优先级:
   `countries.ts` 静态库 > citySafety 文档,`tel:` 直拨)+ 折叠的
   embassy/hospitals/areas/scams;条目为空整段隐藏。credit pill 逻辑不变
   (生成入口已统一到 Guide)。
3. **Dashboard 紧急小卡**:当前 leg(`routeStore.currentLeg()`)国家 →
   静态库电话,一行小卡 + `tel:`;无 leg 时显示 112。放新模块
   `src/views/dashboard/emergency-card.ts`(dashboard.ts 顶格)。电话条相关
   静态数据进 SW precache 本来就含 js chunk,离线天然可用。
4. **Profile 页**(新 `src/views/profile/`):calendar 先例——`ViewId` 加
   `'profile'`,不进 `NAV_ITEMS`,`app.html` 加 `#view-profile` 静态块。
   四个分区:
   - 账号:并入 `openAccountModal` 内容(邮箱/plan/trip 额度/购买记录/升级按钮),
     `account.ts` 改为该分区的渲染模块;侧栏账号按钮(`sidebar.ts:254-256`)与
     移动端账号项(`:332-341`)改 `navigateTo('profile')`。
   - 紧急卡:`profile-sheet.ts` 移入 `views/profile/` 直接复用(改挂载方式,
     从 drawer 改为页内分区,编辑逻辑不动)。
   - 偏好:语言 picker + 主题切换(P1 的组件)第二挂载点;默认货币
     (`setBaseCurrency`)。
   - i18n:新 `profile.*` 命名空间,emergency card 相关 key 从 `safety.*` 平移。
5. **摘除 Safety 视图**:`LEGACY_VIEW_MAP` 加 `safety → 'cities'`;删
   `NAV_ITEMS`/`main.ts` 注册/`app.html` 块;`PAGE_COLLECTIONS` 删 `safety`,
   `cities` 增 `'citySafety'`;`PAGE_LABELS` 同步。`views/safety/` 下:
   `city-modal.ts` 内容并入 guide-safety-tab 后删除;`safety.ts`/`landing.ts`/
   `essentials*.ts` 删除(essentials 数据留库不动,UI 下线);`generate.ts`
   的静态优先逻辑移到 guide-safety-tab 的读取侧。修 `generate.ts:60-62`
   enrichWithAi 不落库的旧 bug(合并后自然消失,确认即可)。

**验收**:生成新 guide 时 Safety tab 有内容且只计 1 credit;电话条号码与静态库
一致;Dashboard 小卡直拨可用;Profile 页四分区可用、emergency card 编辑/上传
保单正常;`#safety` 与老分享链接正确重定向;iOS 端 `/api/safety` 回归不受影响。

---

## P5 — Checklist + Pack 合并为 Prepare(最大改动,单独分支)

**目标**:一个导航项、一屏看全"事项 + 行李",顶部相位条给"现在该做什么";
两侧原有 detail 交互**原样保留**,不做二次入口。

**设计要点(回应"不能只是两个 button")**:合并后的 landing 是**一页纵向滚动**:
相位条 → 行前清单区(原 checklist 卡片网格)→ 行李区(天气卡 + pack 网格 +
Core Kit),内容全部直接可见,sticky 锚点条负责跳转——入口层级不增反减
(原来两个导航项,现在一项且不用先选)。点击卡片进 detail 的体验与现在完全
一致,老用户零学习成本。

**背景事实**:两视图零代码耦合(`LAUNCH_CHECKLIST.md:35` 已列为已知债务);
双方都是 `screen` 变量 + list/detail 两屏 + `STANDALONE_TRIP_ID` 双订阅模式,
结构同构可并;`prep-store.ts` 是死代码但其 `PrepTaskSchema` 已有
`'60d'|'30d'|'14d'|'7d'|'1d'` phase 枚举(`schema/checklist.ts:5-13`)可日后复活;
`packing-formula.ts:64-72` 的 `weightCurve` 注释明言"为 Pack timeline 预留";
Pack 的 Pointer-Events 拖拽(`pack.ts:1173-1283`)远优于 Checklist 的 HTML5 拖拽;
checklist CSS ~40 个无前缀全局类是合并冲突主险;`checklist-store.ts` 的
`removeGroup`/`toggleItem`(`:153-157`,`:194`)直取 `clStore()`,standalone
清单下有 bug;deep-link 到已挂载视图时 pack/compare 没监听
`otr:nav-intent`(只有 itinerary 有,`itinerary.ts:1795`);Dashboard 只有 pack
widget、无 checklist 感知、无出发倒计时。

**涉及文件**:新建 `src/views/prepare/`(`prepare.ts` 编排 + `checklist-section.ts`
+ `pack-section.ts` + `phase-strip.ts` + `styles/` 目录,dashboard 的 `styles/`
拆分先例);改 `app.ts`、`main.ts`、`app.html`、`page-collections.ts`、
`trip-share.ts`、`checklist-store.ts`、i18n。

**步骤**:
1. **文件重组**:`views/checklist/checklist.ts` → `views/prepare/
   checklist-section.ts`,`views/pack/pack.ts` → `views/prepare/pack-section.ts`;
   两文件导出 `renderListInto(el)` / `openDetail(id)` / `bind…`,模块内
   screen 状态上收到 `prepare.ts` 的
   `'landing'|'cl-detail'|'pk-detail'|'celebrate'|'pack-check'`。CSS 合并进
   `views/prepare/styles/{checklist,pack,landing}.css`,借机给 checklist 无前缀
   类补 `prep-` 前缀(`.add-item-row`、`.detail-topbar`、`.celebrate-*`、
   `.icon-btn`、`.ai-panel`、`.modal-overlay`、`.tag-chip` 等)。每个子文件
   控制在 ~700 行内,勿造巨石。
2. **landing 编排**(`prepare.ts`):相位条 + 两内容区 + sticky 锚点条。
   相位条 `phase-strip.ts`:从 `routeStore` 取首 leg `dateFrom` 算倒计时,
   映射到建议焦点(>14d "搭清单" / 3–14d "开始采购装箱" / ≤3d "Pack Check" /
   途中 "记录行李变化"),chip 点击滚动到对应区或直开 pack-check;无行程时
   隐藏相位条只显示两区。纯函数 `resolvePhase(daysToGo)` 进测试。
3. **路由**:保留 id `'prep'`(nav label 改 "Prepare",`nav.prep` i18n 改文案);
   删 `NAV_ITEMS` pack 行;`LEGACY_VIEW_MAP` 加 `pack → 'prep'`;`#pack` 深链
   带 `NavIntent {focus:'pack'}` 滚动到行李区,Dashboard pack widget 的
   `data-intent`(`dashboard.ts:864` `listId`)继续工作(prepare 转发给
   pack-section 直开 detail);补 `otr:nav-intent` 监听,修"已挂载视图深链
   失效"。`PAGE_COLLECTIONS`:`prep` 并入原 pack 集合,删 `pack` key;
   `PAGE_LABELS` 同步。
4. **联动 v1**:①清单条目行加"→ 装箱"动作:调 `packStore` 往第一个
   pack list 的 Unassigned 加同名 item(category 映射:清单组名含
   Tech→electronics 等,兜底 other),成功后条目自动勾选;②相位条 ≤3d 的
   chip 直开 Pack Check 模式;③celebrate 文案区分"清单完成"与"全部就绪"。
5. **store 修缮**:`checklist-store.ts` `removeGroup`/`toggleItem` 改
   `this.storeFor(checklistId)` 修 standalone bug(先行,可并入 P2 批次)。
6. **P2 余量(本阶段不做,记录)**:per-item phase 标签(复活 PrepTaskSchema
   枚举)、航司行李额联动(`Leg.arrivalTransport.baggageAllowanceG` 已在
   schema)、`weightCurve` 时间轴图、Dashboard 合并版 Prepare widget。

**验收**:landing 一屏可见两区、原 detail 全部交互(拖拽/称重/AI 建议/模板/
庆祝)回归通过;`#pack` 旧链接与 Dashboard widget 深链可用;standalone
清单删组/勾选不再报错;分享链接含 pack 内容;移动端底栏项数减一后不再
横向滚动(或明显改善)。

---

## 阶段间提交约定

每阶段独立分支(`p1-dark-mode` … `p5-prepare-merge`),阶段内小步提交,
合并前跑全量验收底线。P4/P5 涉及 `page-collections`/invite 映射的改动,
合并后需在生产验证一条旧分享链接。
