# P5 — Checklist + Pack → 统一 Prepare 视图,完整执行计划

## 目标重申(用户原话约束)

不能做成"landing 页放两个按钮分别进两个子页"——那只是给用户进入真实内容多加了一道门槛,内容被藏得更深。真正的合并是:**landing 一页纵向滚动直接展示两块内容**(清单卡片网格 + 行李清单网格 + Core Kit 表格,全部同屏可见),phase strip 在最上面给"现在该做什么"的引导。点进具体某个清单/某个行李箱的 detail 屏,是正常的"列表→详情"下钻,不是被诟病的那种入口门槛,原有交互(拖拽/称重/AI建议/模板/庆祝动画)原样保留。

## 现状核心事实(已用 Explore agent 重新核实,均为当前行号)

- `checklist.ts` 901 行,`pack.ts` 1296 行,两者都**不受** max-lines 棘轮限制(棘轮只锁了 map/itinerary/expenses/guide/dashboard 五个文件)。
- 两者结构高度同构:`render()` 按 `screen`('list'/'detail'[/'celebrate']) 分发,每个 screen 是一个"整段 innerHTML 替换 + bind"的自包含函数,只认自己的根容器(`#view-prep .prep-body` / `#view-pack .pack-body`)。
- **`renderListScreen`/`renderList` 本身就是"卡片网格 + 空态 + 顶部操作栏"的独立小模块**——这正是合并 landing 时可以直接复用的单元,只需改造成"接收一个子容器 div 而非整个视图 body"。
- Store 层:`checklist-store.ts` 有两个真实 bug(`removeGroup`/`toggleItem` 直接调 `clStore()` 而非 `this.storeFor(checklistId)`,standalone 清单下会写错文档);`pack-store.ts` 无此问题,是修复的参照范本。
- `checklist.css` 904 行里 ~40 个全局裸类名(`.modal-overlay`/`.icon-btn`/`.tag-chip`/`.otr-toast` 等),pack.css 已良好加前缀(`pack-*`/`pk-*`)且**当前与 checklist 无实际类名冲突**——但迁移进同一视图后为了长期健康度应该清理,不能拖到"以后"。
- Dashboard 完全没有清单感知(无 renderChecklist 类函数),只有 `renderPackWidget`。Dashboard 现在 1326 行,棘轮上限 1331,**只剩 5 行余量**。
- 倒计时/阶段概念目前分散重复:`dashboard.ts` 私有的 `tripPhase()`+`daysBetween()`(渲染进 hero 文案),`sidebar.ts` 私有的 `daysUntil()`(渲染进 trip pill 徽章)——两处独立实现同一件事。`dash.daysToGo` i18n key 存在于全部 6 个语言文件但从未被引用(死文案)。
- `PrepTaskSchema`(60d/30d/14d/7d/1d 相位枚举)仍被 `prep-store.ts` 和 `migrate.ts` 引用(旧数据迁移用),**不能删**,但也不在本阶段复活使用。

## 分阶段执行(已与用户对齐:先做完整版,但拆成可独立验证的步骤,每步验证不通过就地修复再往下走,不留"下次再做"的债)

### Step 0 — 提取共享的 trip-phase 工具(无风险,纯函数搬家)

**做什么**:新建 `src/data/trip-phase.ts`,导出 `tripPhase(): Phase`、`daysBetween(a, b): number`、`currentLeg(): StoredLeg | null`(从 `dashboard.ts` 私有实现原样搬出,类型不变)。`dashboard.ts`/新 phase-strip 模块都从这里导入,不再各自维护一份。`sidebar.ts` 的 `daysUntil()` 若逻辑等价则替换为调用这个模块(否则保留,不强行统一避免引入行为差异)。

**为什么先做这步**:phase strip 需要"倒计时+阶段"数据,Dashboard 已经有一份能用的实现,不重新发明;顺手解决现存的两处重复实现问题。

**验证**:`dashboard.ts` 行为不变(hero 倒计时文案、卡片显示逻辑跟修改前完全一致)——这是纯提取,不是重写,做完跑 `npm run dev` 对比修改前后的 Dashboard hero 区域(倒计时天数、"during"阶段的 stop N/M 文案)。

---

### Step 1 — 修复 checklist-store.ts 的两个 store bug

**做什么**:`removeGroup`(约第 156 行)、`toggleItem`(约第 194 行)把 `clStore()` 改成 `this.storeFor(checklistId)`,和同文件里其余方法(`addGroup`/`updateGroup`/`addItem` 等)保持一致写法。

**为什么现在做**:这两个 bug 只在 standalone(无 trip 关联)清单下触发,合并后的 Prepare 视图仍然保留 standalone 模式(和现在一样),如果不修,合并后这个 bug 依然存在且更难定位。属于顺手修复,风险极低,不依赖后续任何步骤。

**验证**:写一个 vitest 用例(仿照 `stores.test.ts` 的 mock 手法)——创建一个 standalone 清单,删除其中一个 group,断言 standalone 文档确实更新而不是主 trip 文档被污染;toggleItem 同理断言。

---

### Step 2 — 新建 `views/prepare/` 目录骨架,原样搬迁两个视图(先不改交互,只挪位置)

**做什么**:
1. `src/views/checklist/checklist.ts` → `src/views/prepare/checklist-section.ts`;`checklist.css` → `src/views/prepare/styles/checklist.css`(内容先原样复制,类名先不改)。
2. `src/views/pack/pack.ts` → `src/views/prepare/pack-section.ts`;`pack.css` → `src/views/prepare/styles/pack.css`。
3. 两个模块的顶层 `screen` 状态、`getRoot()`(读 `#view-prep`/`#view-pack`)先原样保留——这一步只是**物理搬家 + import 路径修正**,不改变任何行为,目的是让 git diff 在下一步"真正改造"时更容易审查(先证明搬家本身不破坏任何东西)。
4. `pack-helpers.ts`/`packing-formula.ts`/`pack-suggestions.ts` 保持原位置不动(它们是纯逻辑,被两处都可能复用,不属于"section"私有代码)。

**验证**:`tsc`/`lint`/`test`/`build` 全绿,`npm run dev` 手动过一遍 Checklist 和 Pack 页面确认功能与搬家前完全一致(这一步测试的是"重命名/搬家没有破坏任何东西",不测试新功能)。

---

### Step 3 — 真正的接口改造:两个 section 模块从"拥有整个视图"变成"渲染进传入的子容器"

**做什么**(这是本阶段的核心工程动作):

`checklist-section.ts` 导出改造为:
```ts
export function renderChecklistListInto(container: HTMLElement): void   // 原 renderListScreen 逻辑,写死输出目标为传入容器而非 getRoot()
export function initChecklistData(onChange: () => void): () => void     // 原 startSubscriptions,数据到达时回调 onChange 而非自己调 render()
export function openChecklistDetail(id: string): void                   // 原"进入 detail screen"逻辑,改为向 orchestrator 请求切换（见下）
```
`pack-section.ts` 同构改造,导出 `renderPackListInto` / `initPackData` / `openPackDetail`。

**screen 状态上收到 orchestrator**(新建 `src/views/prepare/prepare.ts`):
```ts
type Screen = 'landing' | 'checklist-detail' | 'pack-detail' | 'celebrate' | 'pack-check';
```
landing 态下,`prepare.ts` 把 `.prep-body` 分成两个子容器(`.prepare-checklist-zone` / `.prepare-pack-zone`),分别调 `renderChecklistListInto`/`renderPackListInto`;detail 态下(用户点了某个具体清单卡片或行李箱卡片),`prepare.ts` 清空 body,改为渲染对应 section 模块的原有 detail 屏(`renderChecklistDetailInto`/`renderPackDetailInto`,内部逻辑=原 `renderDetailScreen`/`renderDetail`,原样保留所有交互:HTML5 拖拽群组重排、Pointer-Events 行李拖拽、称重、AI 建议面板、Core Kit 表格编辑、天气卡片、行李变化弹窗、公式弹窗、庆祝动画)。

**为什么这样切**:detail 屏保留"整段替换"的原有实现,不强行拆成可嵌入的组件——它们内部状态复杂(拖拽/AI/弹窗),拆分风险高、收益低。只有 list 屏("展示一堆卡片,点哪张进哪个 detail")需要变成可嵌入的子模块,这正好是两边最简单、最同构的部分。

**验证**:`tsc`/`lint`/`test` 全绿;`npm run dev` 手动过一遍——
- Checklist detail 屏(拖拽重排 group、加清单项、AI 建议、模板选择器、完成庆祝动画)全部行为不变
- Pack detail 屏(Pointer-Events 拖拽行李项、称重、Pack Check 模式、行李变化弹窗、公式弹窗)全部行为不变
- 从 detail 屏点返回,应正确回到 landing(而不是回到旧的"只有清单"或"只有行李"页面)

---

### Step 4 — Landing 编排 + phase strip

**做什么**:`prepare.ts` 的 landing 渲染:
```
┌─────────────────────────────────────────┐
│ Phase strip(倒计时驱动的引导条,见下)      │
├─────────────────────────────────────────┤
│ ⚓ 锚点导航条(sticky,"清单" / "行李")     │  ← 点击平滑滚动到对应区,不是路由跳转
├─────────────────────────────────────────┤
│ 📋 清单区标题                             │
│ [清单卡片网格 renderChecklistListInto]    │
├─────────────────────────────────────────┤
│ 🎒 行李区标题                             │
│ [行李卡片网格 + Core Kit renderPackListInto] │
└─────────────────────────────────────────┘
```
`src/views/prepare/phase-strip.ts`:
```ts
export type PhaseFocus = 'far' | 'packing' | 'imminent' | 'traveling' | 'none';
export function resolvePhase(daysToGo: number | null, tripPhase: Phase): PhaseFocus  // 纯函数,单测覆盖
export function renderPhaseStrip(focus: PhaseFocus, daysToGo: number | null): string
export function wirePhaseStrip(root: HTMLElement, onFocusPack: () => void): void      // "≤3天"态点击直接进 Pack Check
```
映射规则(纯函数,单测覆盖所有分支):
- 无行程数据 → `'none'`,phase strip 整条隐藏(不展示"建议搭建清单"这种和空态重复的文案)
- `daysToGo > 14` → `'far'`,文案"搭建清单"
- `3 < daysToGo <= 14` → `'packing'`,文案"开始采购装箱"
- `daysToGo <= 3` 且 `tripPhase === 'before'` → `'imminent'`,文案"最后检查",chip 点击直接进 Pack Check 模式
- `tripPhase === 'during'` → `'traveling'`,文案"记录行李变化"(点击直接开行李变化弹窗)
- `tripPhase === 'after'` → `'none'`(旅程已结束,不再展示)

**验证**:`phase-strip.test.ts` 覆盖 `resolvePhase` 全部分支(仿照 `theme.test.ts`/`compare-store.test.ts` 的纯函数测试风格);`npm run dev` 手动确认:
- 无行程时 landing 页不显示 phase strip,清单区/行李区直接可见
- 有行程且距出发 >14 天时,strip 显示"搭建清单"引导
- 手动改行程日期模拟 ≤3 天场景,confirm strip chip 点击后直接打开 Pack Check(不需要先进 Pack 详情页再手动点)
- 模拟 during 阶段,confirm strip 引导指向"记录行李变化"且点击直接开变化弹窗

---

### Step 5 — CSS 前缀清理 + 目录整理

**做什么**:`checklist-section.ts` 对应的 CSS 里 ~40 个裸类名统一加 `prep-` 前缀(`.modal-overlay`→`.prep-modal-overlay`,`.icon-btn`→`.prep-icon-btn`,`.tag-chip`→`.prep-tag-chip`,`.otr-toast`→ 复用 `core/modal.ts` 已有的 toast 机制而非自造,详细看是否能直接删除自建的 modal 系统改用 `openModal()`——**能删则删,不做"重命名保留旧机制"的表面工程**)。`styles/` 目录下按用途拆:`checklist.css`(原样迁移改前缀)、`pack.css`(已良好无需改)、`landing.css`(phase strip + 锚点导航条 + 两区域外壳的新样式)。

**验证**:`grep` 确认全局裸类名清零(除刻意保留的、被其他文件复用的);`npm run dev` 视觉回归——清单卡片、模态框、AI 建议面板样式与改造前一致(只是类名变了,视觉不变)。

---

### Step 6 — 联动 v1:清单条目 →"装箱"动作

**做什么**:清单 detail 屏的条目行(`.prep-item`)加一个"→ 装箱"图标按钮:点击后向 `pack-section.ts` 暴露的 `addToUnassigned(name, categoryHint)` 写入一条新行李项(分类映射:条目所在 group 名含"Tech/电子"→electronics,含"衣物/Clothing"→clothing,其余兜底 other),写入成功后清单条目自动勾选完成。

**验证**:手动测试——在"Documents"组下加一条"充电器",点装箱按钮,confirm Pack 区(landing 页往下滚)出现一条新的 Unassigned 行李项,清单条目变勾选态。

---

### Step 7 — 路由 / 导航 / 分享链接收尾

**做什么**:
1. `NAV_ITEMS` 删掉 `pack` 一行,`prep` 一行的 label 从"Checklist"改成"Prepare"(新 i18n key `nav.prep` 文案更新,6 个语言文件)。
2. `LEGACY_VIEW_MAP` 加 `pack: 'prep'`(老 `#pack` 链接/分享邀请里的 page id 重定向到 prep)。
3. `app.html`:`#view-pack` 整块删除(内容并入 `#view-prep` 内部结构),`#view-prep` 的 `view-subtitle` 文案更新为覆盖清单+行李的合并描述。
4. `main.ts`:`registerView('pack', ...)` 整行删除;`registerView('prep', ...)` 指向新的 `prepare.ts` 的 `initPrepare`;`VIEW_CHUNK_LOADERS` 同步删掉 pack 的独立预取项(合并进 prepare 的懒加载 chunk)。
5. `page-collections.ts`:`PAGE_COLLECTIONS.prep` 的集合列表并入原 `pack` 对应的 `packLists`/`coreKit`,删除 `pack` key;`trip-share.ts` 的 `PAGE_LABELS` 同步删 `pack`。
6. Dashboard 的 pack widget(`data-nav="pack"` + `NavIntent{listId}`)深链改成 `data-nav="prep"` + 意图里加 `focus:'pack'`,`prepare.ts` 的 `initPrepare` 读到这个 intent 后直接滚动到行李区并打开对应清单的 detail(复用现有 `consumeNavIntent`/`otr:nav-intent` 机制,顺手补上 P4 审计发现的"已挂载视图深链失效"缺口——监听 `otr:nav-intent` 事件)。

**验证**:
- 地址栏手输 `#pack` 回车,confirm 跳转到 `#prep` 且行李区可见
- Dashboard 的 Pack widget 点击"+ Add"/"− Left" 深链,confirm 正确跳到 Prepare 页并直接打开对应行李箱的 detail(而不是停在 landing)
- 分享链接场景:如果生成过包含 pack 页面的旧分享邀请,confirm viewer 打开后仍能看到行李数据(通过 `PAGE_COLLECTIONS` 映射验证,不需要真的发新邀请,读代码逻辑确认即可)
- 移动端底部导航:确认减少一项后不再横向滚动(或明显改善,视当前项目数而定)

---

### Step 8 — 全量验收

`npx tsc --noEmit && npm run lint && npm test -- --run && npm run build && npm run test:rules` 全绿。`npm run dev` 完整走一遍:
- Landing 页一屏两区都可见,不需要额外点击才能看到内容
- 清单：新建/模板/AI建议/拖拽重排/庆祝动画
- 行李：天气卡/Core Kit/新建行李箱/拖拽装箱/称重/Pack Check/行李变化/公式建议
- 联动：清单项→装箱
- Phase strip 三种阶段态 + 无行程隐藏态
- 旧链接/深链/分享全部正确重定向
- 深色模式下 landing 页、phase strip、两区域视觉正常(复用已有 token,不应有新硬编码色)

---

## 本轮明确不做(记录以免遗漏,但不阻塞验收)

- 清单条目级别的相位标签(复活 `PrepTaskSchema` 的 60d/30d/14d/7d/1d 枚举)——数据模型已备好,UI 留待用户实际用过 phase strip 后再评估是否需要更细粒度。
- 航司行李额度联动(`Leg.arrivalTransport.baggageAllowanceG` 已在 schema 里,注释明确写了"不同步到 Pack"的原因)。
- `weightCurve()` 时间轴图可视化。
- Dashboard 合并版 Prepare widget(现在的 pack widget 继续保留,清单感知 widget 本阶段不加,避免 dashboard.ts 撞棘轮上限——只剩 5 行余量,任何新增都需要同时上调 cap)。
