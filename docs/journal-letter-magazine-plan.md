# Journal：信封书信 + 翻页杂志 — 执行计划

> 写于 2026-10-16。执行者：新会话（Sonnet）。决策者：项目所有者。
> 本文的「已定决策」不要再讨论，按此执行；「执行者可自行决定」的部分按文中默认值做，并在提交说明里写明。

---

## 0. 背景与目标

Journal 的五个视图里，**Feed / Places / Gallery 已经基本满意**，不要改动。本计划只处理两块：

| 部分 | 现状（问题） | 目标 |
|---|---|---|
| **单条笔记的阅读与写作** | 当前是 `scenes/spread.ts` 的“手账跨页”：左页放照片、右页放横格纸上的文字。照片少时左页空，字少时右页下半部分空；跨页高度固定，几千字的长文只能在页内滚动；横格线难看；中文正文里夹的英文单词被渲染成手写体 Caveat（Caveat 只有拉丁字形），与中文混排很怪。 | **信封书信**：一条笔记 = 一个盖了邮戳的信封，里面装着**一封信**（文字，可上下滚动）和**几张明信片**（每张照片做成一张明信片）。可以只有信没有明信片，也可以只有明信片没有信。 |
| **相册（杂志）** | `scenes/albums.ts` + `album-pages.ts` + `album-layout.ts`：打开后左页又印了一遍封面，「设计封面 / 重命名 / 删除」按钮直接印在内页上；照片被统一裁切（横图被切成竖图，反之亦然）；每页只放一篇笔记，放不下就截断，要点开才能看全文；标题、图片、文字都没有杂志的样子。 | **真正的翻页杂志**：功能按钮全部移到书外；照片按真实比例放入匹配的版位，**绝不裁错方向**；文字跨页连续排，整本相册的全部内容都在杂志里；有目录、页眉、页码、衬线标题、首字下沉、图注等杂志排版语言。 |

两者的分工：**一条笔记 = 一封信（纵向滚动）；一本相册 = 一本杂志（横向翻页）。** 不要让两者互相模仿。

---

## 1. 已定决策（不要再讨论）

1. **书信方案**：写作和阅读都改成“信封 + 信 + 明信片”，**拟物程度要高**（纸张、邮票、邮戳、信封翻盖、明信片正反面），不是一个普通的白卡片。
2. **照片不排进信纸里。** 每张照片单独做成一张明信片，放在信旁边；信纸上只有文字。
3. **保存时的动效**：信折起来、明信片收成一叠，一起装进信封，信封合上，盖上邮戳，然后飞回 Feed。系统开启“减少动态效果”时跳过动画。
4. **信和明信片都是可选的**：可以只写信不传照片，也可以只传照片不写字；两者都没有时不允许保存（沿用现有规则）。
5. **相册走方案 A：真正的翻页杂志**，分阶段实施（M1 → M2 → M3）。
6. **新增字段：每张照片的宽高比** `imageRatios`。所有者的照片基本只有 **3:4、4:3、2:3、3:2、16:9** 这几种比例，按这些比例做版位。
7. Feed / Places / Gallery / Calendar 视图、顶部工具栏，**本计划不碰**。

---

## 2. 共享基础：照片宽高比（阶段 R0，最先做）

### 2.1 数据

- `src/data/schema/journal.ts` 的 `JournalEntrySchema` 增加可选字段：
  ```ts
  // width / height of EACH photo, index-aligned with `images`. Optional: entries
  // written before this (and by clients that don't know it) are measured on read.
  imageRatios: z.array(z.number().positive()).max(MAX_JOURNAL_IMAGES).optional(),
  ```
- 已有的 `imageRatio`（只有第一张照片）**保留**，保存时继续写 `imageRatios[0]`，保证老客户端和 Feed 的封面形状逻辑不受影响。
- iOS 的 `JournalEntry.swift` 用 Codable 解码，未知字段会被忽略，所以加这个字段不会破坏 iOS。新建 `docs/journal-photo-ratios-ios.md`，写明这个字段的含义，并提出“iOS 保存照片时也应写入此字段”作为待办（不在本计划内实现）。

### 2.2 比例归类（纯函数，必须有单元测试）

新建 `src/views/journal/shared/photo-ratio.ts`：

```ts
export type RatioClass = '3:4' | '4:3' | '2:3' | '3:2' | '16:9' | '9:16' | '1:1';
export type Orientation = 'portrait' | 'landscape' | 'square';
/** 把实测比例归到最近的常用比例（按对数距离比较，避免偏向大比例）。 */
export function snapRatio(r: number): RatioClass;
export function orientationOf(r: number): Orientation;   // |log r| < log(1.08) 视为 square
/** 归类后的精确数值，例如 '3:2' → 1.5。版位尺寸只用这个值。 */
export function ratioValue(c: RatioClass): number;
```

- 9:16 和 1:1 是兜底（例如手机竖屏截图、正方形照片），不是主要情况。
- 测试要覆盖：每个标准比例本身、上下 5% 的偏差、竖横互换、非法输入（0、NaN、负数 → 返回 '1:1' 或 '4:3' 中的一个，自行决定并写进测试）。

### 2.3 写入与补测

- **保存时写入**：`capture.ts` 里已有 `measureImageRatio(src)`（约在 1213 行），目前只测第一张。改成按顺序测量**所有**照片（新选的文件用 object URL，已上传的用远程 URL），在 `saveDraft` 写入 `imageRatios`。草稿状态 `DraftState` 增加 `imageRatios: (number | undefined)[]`，与 `images` / `pendingFiles` 保持下标一致（添加、删除、调换顺序时三者同步更新）。
- **读取时补测**：老笔记没有 `imageRatios`。新建 `shared/ratio-cache.ts`：
  - `ratioFor(entry, index): number | undefined` —— 先查 `entry.imageRatios`，再查内存缓存，再查 `localStorage` 的 `otr:journal:ratio:<url>`；
  - `measureMissing(entries): Promise<void>` —— 对缺失项加载图片测量，结果写入缓存；
  - **回写**：某条笔记的所有比例都测到后，若该笔记本身没有 `imageRatios`，调用 `journalStore.update(id, { imageRatios })` 写回（防抖、离线失败时静默、每条只写一次）。这与地图模块回写 `leg.lat/lng` 的做法一致（见 `views/map/map-plot.ts`）。
- 所有 `localStorage` 读写都要包 `try/catch`。

---

## 3. 书信（阶段 L1–L3）

### 3.1 场景构成

整个阅读/写作界面是**桌面上的一组实物**，放在现有的遮罩层里（`.journal-reader-overlay` / `.journal-composer-overlay`）：

```
 ┌──────────────── 桌面（哑光纸色，深色模式下深色）────────────────┐
 │                                                                  │
 │   ┌─ 信封（打开的，翻盖在上）─┐                                  │
 │   │ 邮票  邮戳(城市+日期)      │      ┌明信片1┐                    │
 │   │      收件人行 = 标题       │      │ 照片  │ ┐                  │
 │   └───────────────────────────┘      └───────┘ │明信片2           │
 │      ┌──────── 信纸 ─────────┐          ┌───────┘                 │
 │      │ 2026年9月6日，哥本哈根 │          …（错落、轻微旋转的一叠） │
 │      │ 标题                   │                                    │
 │      │ 正文……（上下滚动）     │                                    │
 │      │            火漆印=心情 │                                    │
 │      └────────────────────────┘                                   │
 └──────────────────────────────────────────────────────────────────┘
          [ ‹ ]   ✎ 编辑 · 卡片 · 分享 · 置顶 · 删除 · 相册   [ › ]     ← 书外的操作条
```

**铁律：功能控件（编辑、分享、删除、加入相册……）永远不印在纸上**，只放在场景下方的操作条里。现在阅读器里印在纸上的「ALBUM + Add to…」下拉框也要移到操作条里（做成操作条上的一个按钮或小下拉）。

### 3.2 信纸（文字）

- 单栏、居中，桌面端宽约 `min(640px, 100%)`；不画横线；纸张用 `var(--paper-grain), var(--surface)`，可以加一条很淡的左侧页边线或信纸顶部的印刷抬头，**但不要横格**。
- 信头：右上角一行“日期，地点”，用衬线字体，不用手写体。
- 标题：衬线大字。正文：衬线，约 17px / 行高 1.85，段落之间留空，保留用户的换行（`white-space: pre-wrap`）。
- 信尾：**火漆印**表示心情（4 种心情各有一个火漆颜色，用 CSS 径向渐变画蜡，中间压一个心情图标）；标签做成很小的印章文字。
- 长文：信纸自身高度随内容增长，整个场景在遮罩层里纵向滚动。比利时那篇几千字的笔记必须能舒服地读完。

**字体（重要）：**
- 新增 token `--font-letter`（以及给杂志用的 `--font-serif`，可以是同一个栈）：
  `'<Latin 衬线>', 'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', serif`
- 拉丁衬线字体通过 `scripts/build-fonts.mjs` 自托管（推荐 **Newsreader** 或 **Source Serif 4**，可变字体，只要 latin + latin-ext 子集）。中文用系统宋体，**不要下载中文字体**（体积太大）。
- **规则：Caveat 手写体不得用于任何用户输入的内容**（标题、正文、地点），因为用户内容可能是中文，混排会破。Caveat 只能用于纯拉丁的固定装饰文字。现有 Feed 卡片里 `.jf-hand` 的标题也有同样问题，**这次不改 Feed**，但在提交说明里记一笔。

### 3.3 明信片（照片）

- **一张照片 = 一张明信片**。正面：照片按**真实比例**显示（用 `ratioValue(snapRatio(r))` 设 `aspect-ratio`，**不裁切**），四周有白边；背面（点击翻转，CSS 3D `rotateY(180deg)`）：明信片背面的样式——竖分隔线、右上角邮票位、地址线，邮戳写城市和日期，左侧写“No. 2 / 4”。
- 邮票：用现有的 `core/paper/stamp-country.ts` 的 `renderCountryStamp(spec)`（或 `core/paper/stamp.ts` 的 `renderStamp(spec)`），国家规格来自 `data/stamps.ts`；笔记的国家可以用 `scenes/places-model.ts` 的 `buildStops()` 已经解析好的 `iso`。没有国家时用一枚通用邮票。邮戳：复用 `spread.ts` 里的 `stampParts()`，抽到共享位置。
- **摆放**：
  - **桌面宽屏（≥1100px）**：明信片一叠放在信纸右侧，错落、每张旋转 ±2–5°（角度由“笔记 id + 序号”决定，**不要用 `Math.random()`**），整叠用 `position: sticky`，信纸滚动时照片一直可见。点击某张，它被拿到最前面放大（在桌面上，而不是全屏灯箱），再点翻面。
  - **窄屏 / 手机**：明信片在信纸上方排成一行，横向滑动（`scroll-snap`），然后是信。
  - **只有明信片没有信**：明信片在桌面上松散地铺开（网格加轻微旋转），信封居中在上方。
  - **只有信没有明信片**：信纸居中，右侧不留空栏。

### 3.4 信封

- 信封正面：右上角贴邮票，邮戳压在邮票上（城市 + 日期），中间“收件人”一行写笔记标题（衬线体）；左上角“寄件人”一行写地点。
- **阅读时的打开动效**（仅在从 Feed / 日历 / Places 打开时播放一次，约 700–900ms）：信封翻盖打开 → 信纸向上抽出 → 明信片滑出排好。用 ‹ › 在笔记之间切换时**不再重播**，只做淡入淡出。减少动态效果时直接显示最终状态。
- 阅读状态里信封可以缩小放在左上角作为“这封信装在这个信封里”的提示，不占主体空间。

### 3.5 写作状态（同一个场景，可编辑）

- 信纸可写：日期行可点击（底下是真正的 `<input type="date" id="journal-date">`），地点（现有的 `#journal-destination-select` + `#journal-destination`），标题 `#journal-title`，正文 `#journal-body`（自动增高的 textarea，无横线），信尾选火漆（4 个心情，仍然是 `name="journal-mood"` 的单选框，视觉上是 4 枚火漆）。
- 明信片：右侧一叠里最后一张是“空白明信片”槽位（虚线框 + “添加照片”），点击触发 `#journal-image-input`；每张已加的明信片右上角有移除按钮 `data-remove-image="i"`；顺序调整：左右箭头按钮即可（拖拽不在本计划内）。第一张 = 封面照片。
- 标签和“关联的收藏地点”放在信尾一张小便签里，默认折叠（`data-journal-more`）。
- **保存动效（L3）**：信纸三折（三段 `scaleY`/`rotateX`）、明信片收拢成一叠、两者滑进信封、翻盖合上、邮戳“砰”地盖下（复用 `core/paper` 的 `paperStamp({pressed:true})` 的动效）、信封滑出视野。**数据写入与动画并行开始，动画不能阻塞保存**；写入失败时停止动画、恢复写作状态并提示错误。减少动态效果时跳过。

### 3.6 必须保留的挂钩（测试和仪表盘浮层依赖它们）

- 元素 id：`#journal-date`、`#journal-destination-select`、`#journal-destination`、`#journal-title`、`#journal-body`、`#journal-tags`、`#journal-image-input`
- 属性：`data-journal-save`、`data-journal-cancel`、`data-journal-close`、`data-journal-more`、`data-remove-image`、`name="journal-mood"`、`data-open-reader-edit`、`data-reader-close`、`data-card-entry`、`data-share-entry`、`data-favorite-entry`、`data-delete-entry`、`data-spread-prev`、`data-spread-next`（可以改名，但要同步改 `capture.ts` 和测试）
- 外层类名：`.journal-composer-overlay`、`.journal-reader-overlay`
- **仪表盘的“记一笔”浮层** `openJournalComposerOverlay()`（`views/journal/index.ts` 约 200 行）依赖 `.journal-composer-overlay` 和 `#journal-body`，改完必须在仪表盘上实测一次。

### 3.7 文件安排

- 新建 `src/views/journal/scenes/letter.ts`（信纸 + 信封 + 明信片的标记，读写两种状态），`scenes/postcard.ts`（单张明信片正反面），`styles/letter.css`。
- 动效放在 `scenes/letter-motion.ts`（打开、保存两段时间线，集中常量 `LETTER_MOTION`）。
- 完成后删除 `scenes/spread.ts`、`styles/spread.css` 及其测试；仍要用的纯函数（`stampParts`、`photoLean`）移到 `shared/` 并保留测试。
- 新的 i18n key 一律加到 `en.ts` 和 `zh.ts`，并保证 `src/core/i18n/journal-keys.test.ts` 通过（模板字符串 key 要在该测试的 `EXPANSIONS` 里登记）。

### 3.8 书信的验收标准

- [ ] 4 种组合都好看：有信有照片 / 只有信 / 只有照片 / 长文（≥3000 中文字）+ 多张照片
- [ ] 竖图、横图、16:9 都按原比例显示，没有任何裁切
- [ ] 中英混排的正文只有一种字体，没有手写体混进来
- [ ] 纸上没有任何功能按钮；阅读器里的“加入相册”已移到操作条
- [ ] ‹ › 能在笔记之间切换，不重播开信动画
- [ ] 保存动效完整，写入失败时能恢复；减少动态效果时直接完成
- [ ] 浅色 / 深色模式、1300px 和 390px 宽度都截图检查过
- [ ] 仪表盘上的“记一笔”浮层能正常写、能保存

---

## 4. 杂志（阶段 M1–M3，方案 A）

### 4.1 核心思路（为什么现在这版不行，新版靠什么解决）

真正的杂志排版需要同时满足三件事，现在一件都没做到：
1. **知道每张照片的比例** → 由 R0 的 `imageRatios` 解决；
2. **文字跨页连续排** → 用固定尺寸的页面 + DOM 实测分页解决；
3. **功能按钮在书外** → 结构调整解决。

### 4.2 固定页面坐标系（关键）

- 每一页的**内部尺寸固定为 600 × 800**（单位就是 CSS px），整个跨页 1200 × 800。所有排版、测量都在这个固定尺寸里进行，然后整体用 `transform: scale(k)` 缩放到屏幕大小（`k` 按可用宽高计算）。
- 这样分页结果**与屏幕尺寸无关**，同一本相册在任何设备上分页都一样，测量也是确定的。
- 手机上一次只显示一页（600×800 缩放到屏宽），翻页仍是一页一页翻。

### 4.3 装订顺序

```
[封面]                          ← 单独一页，在右侧（左侧是深色桌面/内封）
[目录 | 第1页内容]
[第2页 | 第3页] … 文章连续排 …
[封底]                          ← 单独一页
```

- **封面**：用已有的 `scenes/album-cover.ts` `renderCover()`（4 种模板，已做好，不要重做），按 600×800 显示。
- **目录**：自动生成。每篇一行：栏目名（日期 · 地点，小号等宽大写）、标题（衬线）、页码（右对齐、点线连接）。超过约 12 篇时目录占两页。目录必须**先分页再生成**（两遍：先排正文得到页码，再插入目录，目录页数固定后页码整体偏移）。
- **封底**：简洁，印刊名、卷期号（`issueLine()` 已有）、“On the Road”。
- **功能按钮全部移出书页**：书上方的工具条 = `← 相册` | 刊名 | `设计封面 · 重命名 · 删除` | `页码 x / y`。从书页里删除现在 `titleLeaf()` 里的三个按钮和重复的封面。
- **书页里不再有 `data-open-entry`**：杂志就是全文，不需要点开。把笔记移出相册的操作只在单条笔记的操作条里做（已有）。

### 4.4 文章模型

每条笔记是一篇文章：

```ts
interface Article {
  id: string;
  kicker: string;        // "06 SEP · COPENHAGEN"
  headline: string;      // titleFor(entry)
  mood?: string;
  paragraphs: string[];  // body 按空行/换行切分
  photos: Array<{ src: string; ratio: RatioClass; orient: Orientation }>;
}
```

### 4.5 版式库（M1 先做 5 种，M2 扩到约 10 种）

版式定义成纯数据（`scenes/magazine-templates.ts`）：若干**照片位**和若干**文字框**，坐标用 600×800 内的数值。

**照片位的规则（防止裁错）：照片位只规定宽度和接受的方向；高度由照片自身比例决定**（`height = width / ratioValue`），文字框占用剩下的空间。因此照片永远完整显示，不会被裁切成别的方向。并排的两张图只选**同一比例类**的照片，这样高度天然一致。

M1 的 5 种：

| 版式 | 用途 | 照片位 | 文字 |
|---|---|---|---|
| `opener-land` | 文章首页，首图是横图 | 通栏横图（宽 600 出血或 520 留边）在上 | 栏目名 + 大标题 + 首字下沉，两栏正文 |
| `opener-port` | 文章首页，首图是竖图 | 左侧竖图（宽约 260） | 右侧：栏目名 + 标题 + 单栏正文 |
| `opener-text` | 文章首页，没有照片 | — | 大标题 + 首字下沉 + 两栏正文 |
| `text-2col` | 续页，没有剩余照片 | — | 两栏正文 |
| `photo-pair` | 续页，剩下 ≥2 张同比例照片 | 两张并排（同为竖图）或上下两张（同为横图） | 剩余空间放正文 |

M2 再加：`full-bleed`（一张横图整页，仅图注；在文字已排完但照片还多时使用）、`photo-side-text`（一张竖图占一栏 + 一栏正文）、`grid-3/4`（3–4 张小图拼贴，只放同方向）、`pull-quote`（正文页中插入一句放大的引文）、`article-break`（上一篇剩余半页时，下一篇从页面中间开始，带标题横栏）。

**挑选规则**：沿用 `scenes/album-layout.ts` 里已有、已测试的两条规则——相邻页不用同一版式；图多页和字多页尽量交替。在此基础上，模板必须**能容纳**当前剩余的照片（方向匹配）才能入选。

### 4.6 分页算法（M1 的核心）

分成两层，以便测试：

1. **纯逻辑层** `scenes/magazine-paginate.ts`：接收 `articles`、模板库和一个**测量接口**：
   ```ts
   interface Measurer {
     /** 在给定宽高、栏数、字体设置的文字框里，从 text 开头能放下多少个字符。 */
     fit(text: string, frame: { w: number; h: number; cols: number; firstPage: boolean }): number;
   }
   ```
   输出 `Page[]`：每页一个模板名 + 每个照片位放哪张照片 + 每个文字框放哪段文字（字符区间）。这一层用一个假的 `Measurer`（例如“每行 N 个字、每框 M 行”）做单元测试，覆盖：长文跨多页、只有照片、只有文字、照片方向混杂、照片多于文字、文字多于照片、空相册。
2. **DOM 测量层** `scenes/magazine-measure.ts`：真正的 `Measurer`。在屏幕外放一个与正式页面**完全相同 CSS**、固定尺寸的隐藏文字框，用二分查找字符位置，让 `scrollHeight <= clientHeight`（多栏时检查最后一个字符的位置不超出框）。
   - 断行：中文可以在任意字之间断；拉丁文在空格处断；不在标点前断（避免句号出现在下一页开头）；最后剩不到两行时整体推到下一页（避免孤行）。
   - 必须在 `document.fonts.ready` 之后、并且 R0 的比例补测完成之后才开始测量；期间显示一个“正在装订…”的加载状态。
   - 结果按 `albumId + entryIds + 各笔记 updatedAt` 缓存在内存中，翻页不重新测量。

流程：按相册顺序逐篇排版 → 每篇从新的一页开始（M2 的 `article-break` 再允许接在半页上）→ 首页选 opener（按首图方向）→ 正文流入文字框，放不下就换下一页 → 每一页根据**剩余照片**和规则挑模板 → 正文排完后剩下的照片用照片为主的模板放完（照片一张都不能丢）→ 全部排完后生成目录、加封面和封底。

页面跨页接续处，文字框末尾印很小的“→ 接第 N 页”。

### 4.7 杂志排版语言（M2，“杂志感”主要来自这里）

- 字体：标题、正文都用 `--font-serif`（见 3.2）；栏目名用 `--font-data`，小号大写、加字距。
- 首字下沉（每篇第一段，CJK 也适用）；正文两端对齐 + `text-wrap: pretty`；
- 页眉：每页顶部外侧印 “刊名 · 国家”；页脚外侧印页码（已有 `.jb-folio` 的思路）；
- 图注：照片下方一行，`地点 · 日期`，小号等宽；
- 引文：从文章中挑一句 20–60 个字、以句号/问号/感叹号结尾的句子，放大成衬线引文，上下细线；它在测量时算作一个文字块；
- 页面四周留宽边距（建议外侧 48、内侧 56、上 56、下 64，按 600×800 计）；跨页中缝有阴影（已有 `.jb-spread::before` 的思路）。

### 4.8 M3（打磨）

- 用 `views/passport/flip.ts` 的 `createFlip()` 实现真正的 3D 翻页（护照已经在用，支持拖拽翻页、单页模式）。M1/M2 阶段先沿用现在的整跨页切换。
- 深色模式；
- 手机单页模式的细节；
- 性能：50 篇以上的相册测量时间（目标：首次装订 < 1.5s，之后翻页即时）。

### 4.9 杂志的验收标准

- [ ] 书页上没有任何按钮；封面只出现一次（第一页）
- [ ] 所有照片按原比例完整显示：横图仍是横的，竖图仍是竖的，16:9 是 16:9
- [ ] 长文（≥3000 字）连续排满多页，中间不截断，不需要点开
- [ ] 目录页码与实际页码一致（写一个测试：分页结果里每篇首页的页码 = 目录里的页码）
- [ ] 一页上不会出现大片空白（文字框剩余 > 35% 时必须换成更合适的模板，或在 M2 中用 `article-break` 接下一篇）
- [ ] 同一本相册每次打开分页都一样；不同屏幕宽度下分页一样
- [ ] 浅色 / 深色、1300px 和 390px 都截图检查过

---

## 5. 阶段顺序与交付方式

| 阶段 | 内容 | 依赖 |
|---|---|---|
| **R0** | `imageRatios` 字段、`photo-ratio.ts`、保存时全量测量、读取时补测与回写、iOS 契约文档 | — |
| **L1** | 书信阅读：信纸 + 明信片（正反面、比例、摆放）+ 信封 + 操作条移出纸面 + 字体 | R0 |
| **L2** | 书信写作：同一场景可编辑、明信片增删排序、火漆心情、仪表盘浮层验证 | L1 |
| **L3** | 开信动效 + 保存装信封动效 + 删除旧的 `spread.*` | L2 |
| **M1** | 固定坐标系、装订顺序（封面/目录/封底）、按钮移出书页、文章模型、5 种版式、分页算法（纯逻辑 + DOM 测量）、加载状态 | R0 |
| **M2** | 版式扩到约 10 种、杂志排版语言（4.7）、`article-break`、引文 | M1 |
| **M3** | 真 3D 翻页、深色模式、手机单页、性能 | M2 |

- 每个阶段结束都要：提交到 `main`，验证通过后推送（所有者本轮的做法是直接在 `main` 上更新并推送）。
- **每个阶段结束时停下来**，给所有者看截图（浅色、深色、桌面、手机各一张关键画面），等确认再进入下一阶段。L1 和 M1 之后尤其要停。

---

## 6. 工作约定（违反这些会出问题）

### 6.1 仓库与提交

- 仓库：`/Users/Holiday_1/Desktop/Growth/On the Road/website/on-the-road`（独立的 git 仓库；它的上级目录 `/Users/Holiday_1` 也是一个 git 仓库，**不要混淆**）。
- **所有者的其他会话会同时修改同一个工作区**（例如 passport、expenses、sw 相关文件）。因此：
  - **永远不要 `git add -A` 或 `git add .`**，只 `git add` 你自己改过的文件；
  - 提交前用 `git status --short` 和 `git diff --cached --stat` 检查暂存区里没有别人的文件；
  - 如果全量测试里有失败，先看失败的文件是不是你改的；如果是别人未提交的改动导致的，不要去修，在汇报里说明。
- 每次提交前确认当前分支：`git branch --show-current` 应为 `main`。（上一轮曾发现分支在会话之间被切换过。）
- 提交说明写清楚“为什么”，结尾加上系统提示里要求的 `Co-Authored-By` 行。

### 6.2 代码风格

- 原生 TypeScript + DOM 字符串模板，不用框架。**所有插入 HTML 的用户内容都必须经过 `escHtml()`**；直接写 `innerHTML` 需要像现有代码一样加 eslint 注释说明已审查。
- 颜色只用 `src/core/base.css` 里的 token，**不要新增十六进制颜色**。`src/core/design-lint.test.ts` 会检查（字重必须用 `--fw-*`，不许新增硬编码颜色等）。
- 文件头写一段说明“这个文件是什么、为什么这样做”，与现有文件的注释密度保持一致。
- 纯逻辑与 DOM 分开，纯逻辑都要有 vitest 单元测试。
- 角度、版式选择等“看起来随机”的东西一律由 id 哈希决定（`hashId()` 在 `scenes/feed-plan.ts`），不要用 `Math.random()`。
- `localStorage` 的读写一律 `try/catch`。

### 6.3 i18n

- 新文案一律走 `t('journal.xxx')`，key 加到 `src/core/i18n/en.ts` 和 `zh.ts`。其余 4 种语言（ja/fr/es/ko）会回退到英文，不必补。
- 用模板字符串拼出来的 key（例如 `` t(`journal.mood.${m}`) ``）要在 `src/core/i18n/journal-keys.test.ts` 的 `EXPANSIONS` 里登记，否则该测试会失败。

### 6.4 验证（每个阶段都要做，缺一不可）

```bash
cd "/Users/Holiday_1/Desktop/Growth/On the Road/website/on-the-road"
npx tsc --noEmit
npx vitest run
npx eslint src/views/journal src/core/paper src/core/i18n src/data
npx vite build
```

然后**必须在浏览器里看**，不能只靠测试：
- 预览环境：`_harness/`（未纳入 git，可以随意修改）。启动：`npx vite --port 5191`，打开 `http://localhost:5191/_harness/shell.html`。
- 截图脚本：`node _harness/cdp.mjs <url> <out.png> [宽] [高] [等待ms] [页面内执行的JS] [整页=1]`（无头 Chrome）。截图保存到你的 scratchpad 目录，再用 Read 工具查看。
- 页面导航：侧栏项是 `div[data-view="journal"]`，**不是链接，URL 里的 `#journal` 不会跳转**，要在注入的 JS 里 `document.querySelector('[data-view="journal"]').click()`。视图切换：`[data-journal-view="albums"]` 等。打开一条笔记：点击 `[data-open-entry]`。新建：`[data-journal-new]`。
- 深色模式：注入 `document.documentElement.dataset.theme = 'dark'`。
- 预览环境没有登录，**写入 Firestore 会报 “Not signed in”**，这是正常的；验证保存流程时检查界面状态而不是数据。
- 预览数据在 `_harness/data.ts`。照片是生成的 SVG 渐变，`pic(w, h, …)` 的宽高决定比例。**R0 开始时请补充测试数据**：
  - 覆盖 3:4、4:3、2:3、3:2、16:9 五种比例的照片；
  - 一篇约 3000–4000 中文字、夹杂英文单词的长文，带 4 张照片（模拟比利时那篇）；
  - 一篇只有照片没有文字、一篇只有文字没有照片；
  - 给 `journalAlbums` 加一个包含上述各类笔记的相册，用来测杂志分页。
- 预览环境的行程日期全在过去，与时间相关的界面看起来是静止的。

### 6.5 不要做的事

- 不要改 Feed / Places / Gallery / Calendar 视图和顶部工具栏。
- 不要重做封面编辑器（`album-cover.ts` / `album-cover-edit.ts` 已完成）。
- 不要引入任何 UI 框架或第三方排版库；字体只允许按 3.2 增加一个自托管的拉丁衬线字体。
- 不要为了让测试通过而削弱测试的意图；测试失败时先判断是代码错了还是测试过时了，并在提交说明里写明。
- 不要在阶段之间连续推进而不停下来给所有者看截图。

---

## 7. 已知的相关文件

| 文件 | 作用 |
|---|---|
| `src/views/journal/index.ts` | Journal 入口、顶部工具栏、仪表盘浮层 `openJournalComposerOverlay()` |
| `src/views/journal/capture/capture.ts` | 控制器：状态、点击/输入事件、保存 `saveDraft`、`measureImageRatio` |
| `src/views/journal/capture/render.ts` | 渲染：`renderComposer`、`renderReader`、`renderAlbumsView` |
| `src/views/journal/capture/types.ts` | `CaptureState`、`DraftState` |
| `src/views/journal/scenes/spread.ts` + `styles/spread.css` | **将被书信取代并删除** |
| `src/views/journal/scenes/albums.ts` | 书架、打开的书 `renderBook`、`titleLeaf`、`entryLeaf`、`albumEntries`、`coverArtOf` |
| `src/views/journal/scenes/album-pages.ts` | 旧的按字数估算的分页（**M1 后被新的分页取代**） |
| `src/views/journal/scenes/album-layout.ts` | 版式挑选的两条规则（**保留并复用**） |
| `src/views/journal/scenes/album-cover.ts` / `album-cover-edit.ts` | 封面与封面编辑器（**保留，不要重做**） |
| `src/views/journal/styles/scenes-albums.css` | 书架与书页样式 |
| `src/views/journal/shared/utils.ts` | `escHtml`、`entryImages`、`titleFor`、`MOODS`、`MAX_JOURNAL_IMAGES` 等 |
| `src/core/paper/` | 纸质组件库：`fastener`（胶带/图钉/别针）、`stamp`（邮票）、`paperStamp`（印章动效）等，目录见 `docs/ui-kit.md` |
| `src/views/passport/flip.ts` | 3D 翻页（M3 用） |
| `src/data/schema/journal.ts` | `JournalEntrySchema`、`JournalAlbumSchema`（含可选 `cover`） |
| `src/core/base.css` | 设计 token、字体变量 |
| `scripts/build-fonts.mjs` | 自托管字体脚本 |
| `docs/album-cover-ios.md` | 封面字段的 iOS 契约（可作为新契约文档的格式参考） |
