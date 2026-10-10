# Dashboard 改版实施计划

> 执行者:Sonnet。owner 已逐项确认下列决策,**不要重新讨论方案**,按阶段实施。
> 每个阶段结束后 `npx tsc --noEmit` 必须通过,并在浏览器(`npm run dev -- --port 5180`)确认效果再进入下一阶段。

## 已确认的决策

| # | 决策 |
|---|---|
| 1 | Currency 用**混合策略**(地理定调 + 消费修正),补齐主流国家表,**增加用户自定义币种**,该能力同步到 Expenses 页。Dashboard 上只显示一行,**按需展开**换算器 |
| 2 | Upcoming 用 **B+C 结合**:内容为今天+明天,形态参考「日历 + 日程」合体组件。一次性做到位,对齐 iOS |
| 3 | Calendar 给**独立入口**(侧边栏钉在 Dashboard 下方),点进去是**完整版面**,每天所有情况(住宿/交通/行程/日记/待办/消费)都要看到。版面需重新设计 |
| 4 | **不做阶段化布局**。版面保持一致,阶段变化通过**内容**体现(地图配色、Upcoming 提示、顶部 banner) |

## 全局前提

- 两处改动点:网页版 `/website/on-the-road`(本次主体),iOS 仅在 Phase 5 对齐入口。
- 所有新文案走 i18n(`src/core/i18n/*.ts`,六种语言 en/zh/es/fr/ja/ko)。`nav.calendar` 六语已存在,直接用。
- 不要引入新依赖。
- 每阶段独立提交。

---

# Phase 0 · 低风险清理(先做,立刻见效)

### 0.1 删除 Safety 组件
- 删 `renderSafetyMini()`([dashboard.ts:737-780](../src/views/dashboard/dashboard.ts#L737))及其在 `layout()` 中的调用。
- `safetyStore` 的 import 和 subscribe 一并移除(`dashboard.ts:1273`)。
- `.td-w-safety` 样式删除。
- **保留 `safetyStore` 本身和 `/safety` 相关数据**,只是不在 dashboard 露出。

### 0.2 Pack 改条件渲染
`renderPackWidget()` 当前在 `_packLists[0]` 存在时总是渲染。改为:

```
仅当「下一段有 baggageAllowanceG 的交通」距今 <= 2 天时渲染,否则返回 null
```

已有 `nextLegWithAllowance` 变量([dashboard.ts:795](../src/views/dashboard/dashboard.ts#L795)),加日期判断即可。
Safety 删除后 `.td-w-mini-col` 只剩 Pack,直接让 Pack 独占该格;Pack 为 null 时整个 mini-col 不渲染。

### 0.3 To-do 的 Add 按钮改黄色
`btn btn-ghost` → `btn btn-primary`([dashboard.ts:731](../src/views/dashboard/dashboard.ts#L731)),与 Spend 的 Save、Journal 的「记一笔」统一。

### 0.4 i18n 统一
`en.ts` 里 `dash.widget.spend` / `routeMap` / `upcoming` / `journal` / `todo` / `whereToGo` 等 key **已定义但没被调用**。把所有硬编码的组件标题换成 `t(...)`。同时为中文 UI 文案(「记一笔」「照片或一句话都行」)补上 i18n key,不要再硬编码中文。

### 0.5 To-do 的「All tasks ›」指向修正
当前指向 `calendar`。Phase 3 之后 calendar 是完整视图,这个链接保留指向 calendar 是合理的,但要带上 intent 让它落到「待办」区。此项**推迟到 Phase 3 一起做**,Phase 0 先不动。

### 0.6 天气补充降水
`fetchWeather()` 已拿到 wttr.in 全量 JSON。额外取 `data.weather[0].hourly` 的 `chanceofrain` 最大值,存入 `_weather.rainChance`。当 >= 40% 时在 hero 天气块显示 `☔ 60%`。

**验收**:dashboard 组件数从 11 降到 9(非飞行日 8),首屏更干净,按钮视觉统一,无硬编码文案。

---

# Phase 1 · Currency 重构

## 1.1 扩充币种数据

`src/data/rates.ts`:

**CURRENCIES 补齐到 frankfurter 支持的全集**(共 31 个,这是 API 的硬上限):
```
EUR USD JPY BGN CZK DKK GBP HUF PLN RON SEK CHF ISK NOK TRY
AUD BRL CAD CNY HKD IDR ILS INR KRW MXN MYR NZD PHP SGD THB ZAR
```
每个补上 symbol 和 flag。`EUR_PER_UNIT` fallback 表同步补齐(用近似值即可,仅离线兜底用)。

> ⚠️ **重要**:frankfurter.app **只支持上述 31 种**。RSD/ISK 之外的巴尔干币种、UAH、GEL 等**拿不到实时汇率**。这决定了 1.3 的自定义币种必须支持手动汇率。

## 1.2 补齐国家 → 币种映射

`COUNTRY_CURRENCY`([dashboard.ts:132](../src/views/dashboard/dashboard.ts#L132))目前只有 10 条,且是 `leg.country.includes(k)` 的模糊匹配,很脆。

**移到新文件 `src/data/country-currency.ts`**,建成完整表:
- 欧洲全覆盖(含欧元区 20 国 + 非欧元区:GB/CH/NO/SE/DK/IS/CZ/PL/HU/RO/BG/TR/RS/UA 等)
- 主流亚洲/美洲/大洋洲
- 导出 `currencyForCountry(country: string): string | null`
- 匹配逻辑保留 `includes` 容错,但**优先精确匹配**,避免 "Georgia"(国家)误中 "Georgia"(美国州)这类问题

## 1.3 用户自定义币种

**存储**:跟 `countryBudgets` 同样的模式,存在 Trip 文档上。

`src/data/schema/user-trip.ts` 的 `TripSchema` 增加:
```ts
customCurrencies: z.record(z.string(), z.object({
  symbol: z.string(),
  flag: z.string().optional(),
  manualRate: z.number().optional(),   // 1 单位该币种 = ? base 单位
})).optional(),
```

`src/data/trip-context.ts` 增加 `customCurrencies()` / `setCustomCurrency(code, def | null)`,照搬 `setCountryBudget` 的写法([trip-context.ts:148](../src/data/trip-context.ts#L148))。

**汇率解析优先级**(在 `rates.ts` 里实现 `resolveRate(code, base)`):
```
1. frankfurter 实时表(31 币种内)
2. 用户填的 manualRate
3. EUR_PER_UNIT 静态兜底
4. 返回 null → UI 显示「—」并提示「汇率不可用,请手动填写」
```

**UI 入口**:自定义币种的增删改**只放在 Expenses 页**(设置区),dashboard 不放管理入口,只消费结果。Expenses 页的币种选择器要能选到自定义币种。

## 1.4 智能推荐那一行

新函数 `suggestedCurrency(): string`,按确认的混合策略:
```
1. 当前 leg 的国家 → currencyForCountry() → 候选 C
2. 若最近 3 天内、该国境内有 >= 3 笔 expense,
   且其主力币种 M !== C  →  返回 M
3. 候选 C 为 null → 回退到最近一笔 expense 的币种 → 再回退 EUR
```

## 1.5 Dashboard 上的形态

**删除整个 Currency 组件格子**。改为 hero 区域内一行:

```
1 EUR = 7.46 DKK  ▾
```

- 点击 `▾` 原地展开换算器(hero 下方滑出一个 panel,不是 modal)
- 展开后内容 = 现在的 `td-cur-converter`(输入框 + from/to 选择 + swap)
- 展开态不持久化,刷新后收起
- 自定义币种也出现在 from/to 下拉里

**验收**:第一行空出一格;新国家落地当天就显示正确币种;住几天后若实际刷卡币种不同会自动切换;Expenses 页能添加「塞尔维亚第纳尔」并手填汇率。

---

# Phase 2 · Upcoming → 「日历 + 日程」合体组件

这是本次改动的**核心组件**,参考 owner 提供的 macOS 日历小组件形态(左侧紧凑月历,右侧当日日程),并对齐 iOS 的日面板内容。

## 2.1 数据层:按日期聚合(关键)

**不要**在现有 `renderPlanFeed(leg)` 上打补丁——它是按 leg 聚合的,换城市当天拿不到跨 leg 数据。

新建 `src/data/day-agenda.ts`,**移植 iOS `CalendarStore.day(on:)` 的聚合逻辑**(见 `iOS/On the Road/Features/Calendar/CalendarStore.swift`):

```ts
export type AgendaKind = 'context' | 'transport' | 'stay' | 'plan' | 'todo' | 'spend' | 'journal';

export interface AgendaItem {
  id: string;
  kind: AgendaKind;
  time: string | null;        // 'HH:MM',无时间的排在最后
  title: string;
  subtitle?: string;
  icon: string;
  legId?: string;
  done?: boolean;             // plan / todo
  navTo?: ViewId;             // 点击去哪
  intent?: NavIntent;
}

export function agendaForDay(iso: string, src: {
  legs, journal, todos, expenses
}): {
  leg: StoredLeg | null;
  dayInLeg: { n: number; total: number } | null;
  isArrival: boolean;
  isDeparture: boolean;
  planDayLabel: string | null;
  items: AgendaItem[];
  journalEntries: StoredJournalEntry[];
}
```

聚合来源,**严格对齐 iOS**:
- **context** — 「Day 3 of 4 in Rome」/「Arrival day」/「Departure day」/ planDay.label
- **transport** — 任意 leg 的 `arrivalTransport.date === iso`(注意:交通属于它自己的日期,不一定在 leg 区间内)
- **stay** — accommodations 的 `checkIn === iso`(入住)/ `checkOut === iso`(退房),分别是两个条目
- **plan** — `leg.plans` 中 `dayId === 'day-' + iso`
- **todo** — `dueDate === iso`
- **spend** — 该日 expenses,聚合成**一条汇总**(「今日消费 ¥340 · 5 笔」),不要逐笔列
- **journal** — `happenedOn === iso`,单独返回(渲染成缩略图行,不混在 items 里)

排序:有时间的按时间升序在前,无时间的按 kind 优先级(context → transport → stay → plan → todo → spend)在后。

> 这个模块是 Phase 2 和 Phase 3 **共用**的。Calendar 完整版直接复用它,不要写第二份。

## 2.2 组件形态

替换 `renderUpcomingWidget()`,新组件 `td-w-agenda`,占 **6 栏**(与 Spend 同宽),左右两栏布局:

```
┌──────────────────────────────────────────────────┐
│ 📅 10月 2026            [今天] [明天]      全部 ›│
├─────────────────┬────────────────────────────────┤
│  S M T W T F S  │  Wednesday, 12 August          │
│        1  2  3  │  🇮🇹 Day 1 of 4 in Rome · 抵达 │
│  4  5  6 (7) 8  │                                │
│ ...             │  14:55 ✈️ Lisbon → Rome        │
│  紧凑月历,      │        TP836                   │
│  有事的日子带点  │  ──────────────────────────    │
│                 │  🏠 Surfbird 退房 · Lisbon     │
│                 │  🏠 Room in Rome 入住          │
│                 │  ☑️ 买 Roma Pass               │
│                 │  💶 今日消费 €86 · 3 笔        │
└─────────────────┴────────────────────────────────┘
```

**行为**:
- 右上「今天 / 明天」是 **segmented 切换**,默认「今天」。切换只换右侧日程,不换月历。
- 左侧月历**可点任意一天**,点了右侧就显示那天(此时 segmented 取消选中)。点击非当前月不翻页(保持紧凑)。
- 月历每格下方的点 = 该日有哪些 kind,**最多 3 个点**,颜色沿用 iOS 配色:
  `travel 绿 / stay 蓝 / journal 紫 / spend 黄`(见 iOS 截图图例)
- 右侧条目可点:行程项点击切换 done(沿用现有 `data-toggle-plan`),其余点击 `navigateTo` 到对应视图。
- 「全部 ›」→ Phase 3 的 Calendar 完整视图。
- 空状态:当天无任何条目 → 「今天没有安排 · 去看看推荐 ›」指向 Guide。

## 2.3 顺带处理

- 删除 hero 里的 transport / accommodation chips([dashboard.ts:189-218](../src/views/dashboard/dashboard.ts#L189))——这些信息现在在 agenda 里有更好的呈现,留着是重复。
- 删除旧的 `renderCalendarWidget()` 月历组件(它的职责被 agenda 的左侧月历取代)。
- 删除 `renderPlanFeed()` / `ensurePlanDaysLocal()` / `categoryByIdLocal()` 中仅服务旧 Upcoming 的部分。

**验收**:换城市当天能同时看到「退房 + 航班 + 入住」三条跨 leg 信息;点月历任意一天能看那天日程;今天/明天一键切换。

---

# Phase 3 · Calendar 独立入口 + 完整版面

## 3.1 入口

`src/core/sidebar.ts`:把 Calendar 加进 **pinned items**(和 Dashboard 同级,在三个阶段分组之上),用已有的 pinned 机制([sidebar.ts:380](../src/core/sidebar.ts#L380))。

```
[头像]
[Trip pill]
🏠 Dashboard
🗓️ Calendar      ← 新增
──────────────
Before you go
  ...
```

图标沿用 `assets/` 里的风格(找一个日历类插画,或复用 iOS 的日历图标风格)。
文案用已存在的 `nav.calendar`(六语齐全)。
收窄态下和其他 icon 一样只显示图标——Phase 0 的侧边栏改动已经处理好间距。

## 3.2 完整版面重新设计

现有 `src/views/calendar/calendar.ts`(575 行)已经有月历 + 日面板 modal,但**版面要重做**:从「月历为主 + 点击弹 modal」改成 **「月历 + 常驻日面板」双栏**,对齐 iOS 体验(iOS 是上下布局,网页宽屏应该左右)。

```
┌───────────────────────────────┬──────────────────────────────┐
│  ‹  2026 年 8 月  ›           │  Wednesday, 12 August  🇮🇹Rome│
│                               │  ┌──────────────────────────┐│
│  S  M  T  W  T  F  S          │  │ Day 1 of 4 · 抵达日      ││
│     1  2  3  4  5  6          │  └──────────────────────────┘│
│  ...                          │                              │
│  (有事的日子带彩色点)          │  14:55 ✈️ Lisbon → Rome      │
│  (今天高亮,选中日填充)        │         TP836 · €89          │
│                               │  ───────────────────────     │
│  ● Travel ● Stay              │  🏠 Surfbird 退房            │
│  ● Journal ● Spend            │  🏠 Room in Rome 入住        │
│  ● Plan   ● To-do             │  ☑️ 买 Roma Pass             │
│                               │  📝 两篇日记 [缩略图][缩略图] │
│  [本月统计]                   │  💶 今日 €86 · 3 笔          │
│  12 天行程 · 8 篇日记         │                              │
│  €1,240 消费                  │  [+ 加待办] [+ 记一笔]       │
└───────────────────────────────┴──────────────────────────────┘
```

**要点**:
- **复用 Phase 2 的 `agendaForDay()`**,不要重复实现聚合。
- **补上消费聚合** —— 这是网页版相对 iOS 唯一缺的(iOS 有 `spendItems(on:)`,网页 `eventsForDay()` 没有 expenses)。`agendaForDay` 已含,直接用。
- 每个条目**可点进入对应视图**(航班→Itinerary、日记→Journal、消费→Expenses)。
- 右侧面板底部放快捷操作:加待办、记一笔。
- 左下角加**本月统计**(行程天数 / 日记篇数 / 消费总额),这是 iOS 没有、宽屏值得有的。
- 窄屏(容器 < 720px)降级回「月历 + 点击弹面板」的现有形态,不要强行双栏。
- 月历支持**跨月翻页**(现有代码只渲染当月,要加 `‹ ›`)。

## 3.3 清理

- Phase 0.5 遗留:To-do 的「All tasks ›」加 intent,落到 Calendar 右侧面板的待办区。
- `page-collections.ts:36` 注释说 calendar 不可单独分享,保持不变。

**验收**:侧边栏能直接进 Calendar;任意一天的住宿/航班/行程/日记/待办/消费一屏看全且可点;跨月翻页正常。

---

# Phase 4 · 用内容表达阶段(不改布局)

owner 明确:**不做阶段化布局**,版面保持一致。阶段感通过内容体现。

### 4.1 地图配色反映进度
`dashboard-map.ts` + `/map` 视图:
- **已完成**的国家/路段 → 灰色(`#a8a29e`)
- **当前**所在国 → 绿色高亮(`#22c55e`)
- **未来**路段 → 琥珀色(`#f9b830`)

图例已有这三色([dashboard.ts:522-524](../src/views/dashboard/dashboard.ts#L522)),但实际着色逻辑要确认有没有真的按日期区分。没有就补上。

### 4.2 Agenda 的阶段提示
在 `agendaForDay` 的 context 条目里加入阶段语义(已在 2.1 设计中):
- 抵达日 → 「🛬 今天抵达罗马」
- 离开前一天 → 「🧳 明天离开 · 14:55 飞里斯本」(这也自然触发 Phase 0.2 的 Pack 组件出现)
- 旅程最后一天 → 「🏁 旅程最后一天」

### 4.3 Hero banner 分阶段文案
`renderHero()` 已有 before/during/after 三分支,**保持结构不变**,只丰富文案:
- **before** — 「还有 12 天出发 · 下一站 🇩🇰 哥本哈根」
- **during** — 「🇮🇹 罗马 · 第 3 程/16 · 第 1 天/4」(已有,保持)
- **after** — 「旅程完成 · 74 天 · 9 国 · 16 站」+ 一个「看看旅行者画像 ›」按钮(指向未来的回顾功能,现在可先指向 Journal 的相册页)

**验收**:不切换布局的前提下,出发前/路上/到达新城/回国这几个时刻,dashboard 的内容有明显差异。

---

# Phase 5 · iOS 对齐(最后做,改动最小)

- iOS 侧边栏(`App/SideMenuView.swift`)加 Calendar 入口,和网页版一致(目前 iOS 的 Calendar 只能从 dashboard 右上角进)。右上角图标**保留**,两个入口并存在 iOS 上是可接受的(移动端发现性更重要)。
- iOS 的 Journal 组件参考网页版 Phase 6 的相册形态(如果 owner 届时确认要做)。

---

# Phase 6 · Journal 相册(原始需求,最后做)

Phase 0-2 完成后 Journal 会从 3 栏变成更宽的格子,此时相册才有意义。

方案(上轮已提,owner 认可方向):
- 按 `entry.destination` 分组,每城一张卡,封面取该城最新一篇的 `entryCover`
- 底部渐变 + 城市名 + 「3 篇 · 5–6 Sept」
- 4 秒淡入淡出轮播 + Ken Burns,圆点指示,hover 暂停,点击进该城日记
- `prefers-reduced-motion` 时不自动播放
- 只有一个城市时改为该城多图轮播
- 空状态:插画占位
- **封面用缩略图**,不要加载原图

「记一笔」按钮已在本次改为黄色填充并置底,保持。

---

# 执行顺序与依赖

```
Phase 0 (独立,先做)
   ↓
Phase 1 (独立)      Phase 2 (依赖 0.1/0.2 腾出的格子)
   ↓                    ↓
   └──────┬─────────────┘
          ↓
      Phase 3 (依赖 Phase 2 的 day-agenda.ts)
          ↓
      Phase 4 (依赖 Phase 2 的 agenda context)
          ↓
      Phase 5 / Phase 6 (可并行)
```

**建议分批交付**:Phase 0 单独一个提交先上;Phase 1+2 一批;Phase 3 一批;Phase 4 一批。

# 技术债(本次不做,但要知道)

**Dashboard 全量重绘**:8 个 store 订阅,每个回调都调 `render()`([dashboard.ts:1265-1283](../src/views/dashboard/dashboard.ts#L1265)),而 `render()` 是 `body.innerHTML = ...` 全量替换。打一个字的待办 → 整个 dashboard 重建 → 地图销毁重建。

Phase 2/3 会显著增加 DOM 复杂度,**这个问题会变得更明显**。如果 Phase 2 做完体感卡顿,就优先处理:按 widget 粒度更新,至少把 Map 和 Agenda 的月历排除在全量重绘之外。
