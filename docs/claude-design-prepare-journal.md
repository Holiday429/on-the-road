# Claude Design prompt — Prepare (Checklist / Pack) + Journal

> Paste everything below the line into Claude Design. It is self-contained; no follow-up questions needed.

---

你是资深产品设计师 + 前端工程师。请为 **On the Road**（个人旅行规划 Web 应用）设计并实现两个页面的**可交互 HTML 原型**：**Prepare（Checklist + Pack）** 与 **Journal（手账）**。直接开始做，不需要先向我提问；遇到歧义按本文默认值决定，并在最后用 5 行以内列出你做的假设。

## 0. 交付物
- 一个文件夹，含 `index.html`（入口，顶部有 Prepare / Journal 两个切换 tab）+ 拆分的 `tokens.css`、`prepare.css`、`journal.css`、`prepare.js`、`journal.js`、`mock-data.js`。纯 HTML/CSS/原生 JS（SVG + CSS 动画 + 少量 JS），**不要 React/Vue/构建步骤**，可直接双击打开；允许用 CDN 的 Google Fonts。
- **亮色 + 暗色两套主题都要做**（右上角 Light/Dark 切换，用 `data-theme="dark"`），暗色下可读性是硬要求。
- **响应式**：桌面（≥1180）、平板、手机（375px）都要好用；手机上用单列和底部抽屉。
- 支持 `prefers-reduced-motion`：动画关闭，但最终状态仍完整显示。
- 全部文案先用**英文**（应用有中英文 i18n，所有文案集中放进 `mock-data.js` 的 `STRINGS` 对象，不要散落在 HTML 里）。
- 所有可复用元素（箱包 SVG、称重秤、贴纸、胶带、纸张、印章）写成**独立、参数化的 SVG/CSS 组件**（函数 `renderXxx(props) => string`），props 只接收纯数据，不依赖页面。原因：iOS 原生版稍后会复用这些素材和动效参数，所以：动效时长/缓动/弹簧参数写成 CSS 变量或 JS 常量集中在 `motion` 对象里；SVG 尽量用基础图形、不要依赖 CSS 滤镜才能成立的效果（滤镜只做加分项）。

## 1. 产品背景（必须遵守）
- 产品：个人旅行规划，Dashboard / Prepare / Compare / Itinerary / Guide / Map / Expenses / Journal / My world（护照、地图集）。用户是数字游民，一次行程可跨多国多月。
- **整站视觉语言 = "纸质旅行物件"（paper）**：一种材质（纸 + 3–4% 颗粒）、一个光源（阴影向下）。允许的细节：撕线、缺口、锯齿边、条形码、墨水印章、标签孔、LED 玻璃。**质感要"有质感的实物"，不要卡通、不要塑料感、不要高饱和亮黄**。已完成的参考质量基准：Expenses 页（小票/收银机 checkout）、Itinerary 的机票/火车票/酒店门面、护照印章。你的新设计要和它们放在一起不违和。
- **配色必须用下面的 token（哑光暖色）**，不要自己发明颜色，也不要新增 hex：
  - 亮色：`--surface #fbfaf6`、`--surface-2 #eeece5`（页面底）、`--surface-3 #e4e2da`、`--surface-4 #d6d3c9`；`--ink #24211d`、`--ink-soft #4a453e`、`--ink-muted #6c665c`、`--ink-faint #85806f`；`--amber-50 #faf4e1 / 100 #f4e7bf / 200 #ecd698 / 300 #e8c67c / 400 #e3b866（品牌主色 --accent）/ 500 #c0902f / 600 #a07226 / 700 #7a5518`；`--coral-400 #d38a92 / 500 #bf6670`；`--sky-400 #8fb0cf / 500 #6a93b8`；`--sage-400 #86bfae / 500 #4f9a86`；`--rule rgba(36,33,29,.10)`；`--on-accent #3b2a0e`（琥珀底上的字）。暗色请自行推导成同色相的低亮度版本（琥珀 400 保持品牌琥珀不变，ink/surface 反转，整体比纯黑更暖），并保证文字对比度 ≥ 4.5:1。
  - 字体：标题 `Sora`；正文/UI `DM Sans`；数字、重量、日期、编号一律 `JetBrains Mono`（`--font-data`）；手写体 `Caveat`（`--font-hand`，仅用于手账手写部分）；`Oswald` 仅用于印章。
  - 圆角偏大（卡片 16–20px，按钮/chip 全圆角），阴影柔和向下。
- **图标 = emoji**（统一用一个小的 icon 注册表对象，方便以后换插画）。
- **全局 UI 规则**（所有表单行都要遵守）：① 下拉框的 ▾ 箭头距右边框 ≥ 14px；② 同一行的 input / select / button **高度完全一致**，高度用 `--ctl-h: clamp(38px, 2vw + 24px, 44px)`（触屏 44px）；③ 页面标题不再有副标题说明文字。
- 页面外壳：左侧已有侧边栏（桌面 240px，≤1180px 收成 64px 图标栏），顶部有全局 top bar（标题 + 时钟/铃铛/New trip/Light/English）。**你只需在原型里画出一个简化的外壳占位（侧栏 + top bar，top bar 与侧栏头像水平居中对齐），不要重新设计外壳。**页面内部不要再放页面标题和说明文字。

## 2. Prepare 页

### 2.1 现状与问题
当前 Prepare 首页自上而下是：①状态条（"Prepare anything, anytime"，右侧 Checklist 32/35 进度、Packed 27.6kg across 3 bags）；②左右两栏：左 **Checklist**（按钮 From Template / + New Checklist），右 **Pack**（Core Kit (0) / Pack Formula / + New Pack List）；每栏上方是一张静态插画（清单板 / 工具箱式行李箱），下方是 "NEXT UP" 待办 3 条，最底部才是 "Europe 2026" 的清单卡/行李卡——**真正进入 Checklist 或 Pack 的入口被压在最下面，很不合理**。整体两栏布局本身 OK，保留。

### 2.2 要求
**A. 入口改造（最优先）**：去掉最底部的 "Europe 2026" 入口卡。让**顶部那幅插画本身就是入口**：
- Checklist 栏：一块带夹子的**清单夹板**（clipboard），板上直接显示该清单的前几项和进度（如 32/35），hover/聚焦时夹板微微抬起、纸张翘角、可见一句"Open checklist →"；点击 → 夹板**放大飞到全屏**进入清单详情（过渡动画，约 500–700ms，不要硬切）。
- Pack 栏：一组**行李堆**（场景：地面上放着当前行李清单的各个包——行李箱、背包、拎包等，按实际数量/类型生成），hover 时包轻微弹动并显示重量角标；点击 → 镜头推近进入 Pack 详情。
- 一个用户有多份清单/行李单时：以"一叠夹板 / 一排行李"形式展示，最前面是当前行程的，侧边可翻/切换；"+ New Checklist" / "+ New Pack List" 以"一张空白夹板 / 一个空包（虚线轮廓）"的形式出现在同一场景里，按钮同时保留。
- 保留 "NEXT UP"，但改成**贴在夹板旁的便利贴**，勾选时有划线 + 纸张抖动反馈。
- 状态条保留，数字用等宽字体，进度条改成"胶带式/刻度尺"进度。

**B. Checklist 详情**（轻量优化即可，但要与夹板入口连贯）：纸质清单、分组折叠、勾选时手绘风对勾 + 轻微墨迹动画、全部完成时盖一枚 "ALL SET" 印章（沿用 paper stamp 视觉）。

**C. Pack 详情（重点）**：
- 数据模型（原型里用它造 mock 数据）：`PackList{ name, containers[], items[] }`；`Container{ id, label, kind: 'suitcase'|'backpack'|'personal', limitG, selfWeightG }`；`Item{ id, name, category, qty, unitWeightG, containerId|null(=未分配), priority:'essential'|'nice'|'optional', packed:boolean, consumable }`。mock：3 个包（20 寸登机箱 / 大号托运箱 36kg / 双肩包 / 随身拎包可选），约 50 件物品，分类含 Clothes、Toiletries、Electronics、Documents、Meds、Other。
- **把不同容器画成不同形态的包**（SVG，质感写实但克制，哑光、有缝线/拉链/金属扣细节，不要卡通）：`suitcase` = 硬壳/软壳行李箱（带拉杆、四轮、角护），`backpack` = 双肩包（顶盖、前袋、肩带），`personal` = 拎包/托特包（提手）。每个包有：名字吊牌、重量/限重读数（等宽字体）、**装载程度可视化**（打开的包里能看到物品叠放的高度，或包身"鼓起"程度随重量比例变化）。预留 `kind` 扩展位（以后可加 duffel、斜挎、收纳袋），渲染函数按 kind 分发。
- **物品可直观放进不同的包**：物品是一张张小"物品牌/标签贴"（emoji + 名称 + 重量 + 优先级色点），可**拖拽**到某个包上（桌面端 pointer 拖拽，手机端长按拖或点选后点包）；放入时：包盖打开→物品落入→包身轻微下沉/回弹→重量数字滚动更新；超出限重则包身抖动 + 标签变 coral。同样支持移回"Unassigned"（散落在桌面/床上的区域）。点开某个包 → 展开成"打开的包"视图，里面按分类分格（衣物卷、洗漱包、电子收纳等格子），可以看到每件物品。
- 打包检查（Pack-check）：物品被勾选 packed 时，物品牌盖上小勾；全部 packed 时包拉链合上、盖一枚印章。
- 保留：Core Kit、Pack Formula、Record change（行程中增减物品）、Add bag、New item 添加行（**name / 分类 select / kg / 优先级 select / Add 按钮高度一致，箭头距边框 ≥14px，窄屏自动折行**）。

**D. Weigh（称重）——重做画风和动效，并提升存在感**：
- 现状：按钮 "Weigh" 在 Pack 详情右上角工具栏里，和 Record change / Add bag 同级，不起眼；点击后出现磅秤称重动画（每个包落到秤上 → 读数滚动 → 吊牌甩出 PASS / OVERWEIGHT），动画内容对，但**画风偏扁平、动效偏生硬**。
- 要求：
  1. **画风**：换成与整站一致的写实哑光质感——机场行李秤/弹簧吊秤（手提行李秤）或平台电子秤二选一或都做（桌面做平台秤，手机做吊秤也可）；LED 玻璃读数（`.paper-led` 风格，暗底琥珀/绿色等宽数字）、金属拉丝、橡胶脚垫；吊牌是带孔、系绳的行李牌（PASS = sage 色，OVERWEIGHT = coral 色 + 红色印章）。
  2. **动效**：有物理感——包落下时秤台下压 + 弹簧回弹（过冲 1–2 次衰减）、指针/读数数字先快后慢"追"到目标值、秤台轻微晃动；PASS 时吊牌"啪"一声打上去并有一圈轻微闪光；OVERWEIGHT 时秤震动、读数闪烁、给出"超 1.2kg，建议从 xxx 拿出"的具体建议。所有时长/缓动集中在 `motion.weigh` 里。可选音效（默认关，提供开关，用 WebAudio 生成短促合成音，不引外部音频文件）。
  3. **提升重要性与可发现性**（请给出你的设计方案并实现，下面是我的思路，可以超越）：
     - Weigh 不再是工具栏里的小按钮，而是 **Pack 场景里的一个实体物件：地上摆着一台秤，包可以直接拖上去称**；同时在页面顶部给一个醒目的主按钮（琥珀主色）"Weigh my bags"。
     - 按钮带**状态**而不是常驻同一个样子：未称重 → 琥珀脉冲呼吸点 + "3 bags not weighed yet"；物品改动后称重过期 → "Weight changed · re-weigh"；已称重且通过 → sage 色"✓ All within limits · weighed 2h ago"；有超重 → coral "1 bag over · fix"。
     - 出发前 N 天（mock 一个"出发倒计时"状态）自动在页面顶部出现一条纸质提示条 "Weigh before you fly"。
     - 称重结果沉淀成一张**可保存的行李牌/小票**（沿用 `paperReceipt` 视觉：每个包一行，重量 ········ 限重，PASS/OVER，底部总重 + 条形码），可"Save to trip"（原型里存到页面上的一个"Weigh-in history"小抽屉）。
     - 空状态/新手引导：首次进入 Pack 详情时，秤上有一个轻轻晃动的箭头气泡 "Drop a bag here to weigh it"。
  4. 评估并在最后用 3 行说明：你选择了哪种方案、为什么它比"工具栏按钮"更能让用户使用它。

## 3. Journal 页（手账 / 日记场景）

### 3.1 现状
Journal 现有 6 个视图 tab：**Feed / Places / Albums / Gallery / Map / Calendar**，另有 Story（长故事阅读）和 Portrait/Recap（AI 旅行者画像）两种模式；写新内容用一个 composer（正文 + 地点/日期 + 标题/标签/心情/关联地点 + 多图）。条目有 4 种卡片格式：`polaroid`（moment）、`postcard`（place）、`ticket`（note）、`post`（interesting）。目前全是扁平 UI。

### 3.2 总体要求
**不要用扁平列表呈现内容，而是把内容放进"场景"里**：整个 Journal = 一张书桌 / 一本手账本，条目是桌面上、本子里的实物（拍立得、明信片、票根、便签、胶带、回形针、贴纸、印章、邮戳、笔迹）。要有创意、有交互乐趣，但**信息要清晰、可读、可快速浏览**，不能为了好看牺牲可用性。保持哑光质感，别做成幼儿园手工。

### 3.3 各视图
- **Feed（数字杂志排版）**：像一本数字杂志——大图头条（hero entry，跨列大图 + 大标题 + 手写批注）、不同条目按内容类型采用不同版式（拍立得、明信片、票根、引用块、纯文字便签），栅格有节奏变化（跨 2 列/跨 2 行/竖图/横图混排）、有章节页眉（按旅行城市/日期做 "Lisbon · Day 12" 的杂志栏目标题）、页码感。滚动时有轻微视差和"翻页"节奏。点击条目 → 打开阅读器（见 3.5）。
- **Gallery（摄影集式瀑布流）**：**参考我的另一个静态页**：`/Users/Holiday_1/Desktop/Growth/2025-The-Prism-of-Time/index.html`（"策展人"场景，约 1261–1330 行与 1976 行附近的滚动逻辑——如果你无法读本地文件，按下面描述复刻）：深色展厅背景（近黑 `#050505`），CSS columns 2–3 列瀑布流、列间距大，图片默认**灰度 + 80% 透明度**，hover 变彩色 + 金色细边框 + 偏移的"装裱框"；整个画廊**自动缓慢向上流动**（auto-scroll），用户一旦按下/滚轮/触摸就停止自动滚动并交还控制。在此基础上升级：加入展签（hover 出现地点/日期的小铭牌）、点击图片"灯光聚焦"放大（周围变暗）+ 左右切换、顶部有 "Square / Original ratio" 切换、多选模式（选择若干图加入 Album）。注意：Gallery 在亮色主题下也可以保持"暗室展厅"风格，这是一个有意的场景切换，但需要进出过渡（熄灯/开灯）。
- **Places**：地点按"行李贴纸 / 酒店行李牌"在一只旧箱子盖上贴满的方式呈现，贴纸大小随条目数；点击贴纸展开该地点的条目堆（散落的拍立得/票根）。
- **Albums**：一排**相册本 / 老式相册册页**，封面可自定义标题和颜色，打开后是贴着照片角（photo corners）的册页，可以拖入图片（多选加入）。
- **Map**：一张摊开的纸质地图 + 图钉/小旗，条目为钉上去的小卡片；点击图钉弹出小拍立得。（做简化 SVG 即可，不用真实地图瓦片；保留与 Atlas 的呼应——钉子颜色随国家墨色。）
- **Calendar**：**台历 / 手账的月历页**：每天一格，有条目的日子贴小缩略图/心情贴纸/胶带，今天有红圈，点击某天翻到当天的"日记页"。
- **Story / Portrait**：做一个"翻书"阅读体验（页面翻转或横向翻页）即可，Portrait 只需保留入口卡（一张"旅行者画像"的卡牌，≥8 条条目后解锁，不足时禁用并说明原因）。

### 3.4 ⭐ 写新手记（本次重点升级）
用户点击 "+ New entry"（桌面是书桌上的一本手账本/一支笔的图标，手机是浮动按钮），**整个流程是一个连续的动画场景**：
1. **打开手账本**：本子从桌面一角滑入并**翻开封面**（3D 翻转，`perspective` + `rotateY`，封面是皮革/布面哑光材质，带烫金 "JOURNAL" 字样、书签带、松紧带，封面颜色可按当前行程/城市染色），翻到一张空白页（左页：日期/地点/天气/心情；右页：正文区）。
2. **填写页眉**：日期用"撕下的日历小条"或印章式日期戳（默认今天，可点开改，用等宽字体）；地点用"邮戳"形式（输入城市，自动联想，盖上一个带城市名和日期的圆形邮戳，沿用 passport stamp 的视觉，轻微旋转 + 墨迹不均）；天气/心情用一排可点的小贴纸（☀️🌧️❄️ / 😀😐😢…）点选后"啪"地贴到页眉。
3. **写正文**：右页是带横线/点阵的纸，光标处是**钢笔/铅笔书写感**——手写体 Caveat 与 DM Sans 两种字体可切换（默认 DM Sans 保证可读，手写体作为风格选项），输入时字符出现有轻微墨水渗开效果（克制）；支持 `Tab` 缩进、`- ` 自动成项目符号；有字数与"今日第几篇"的小计数。
4. **贴图 / 贴纸 / 装饰**：左侧或底部有一个"工具托盘"：📷 添加照片（选择文件 → 照片以**拍立得/带胶带的方式贴到页面**，可拖动、旋转、缩放，最多 9 张，松手时有"按压"小动画）、🎟 票根（自动生成一张"撕线票根"：地点 + 日期 + 编号）、🏷 贴纸（预设 emoji 贴纸和几张哑光贴纸）、📎 回形针/胶带（不同花纹的胶带条，可贴在照片角）、🖍 荧光笔（给正文选中文字划重点）、✂️ 剪下来的线条/箭头（手绘箭头）。所有贴上去的物件都有 `data-x data-y data-rot data-scale` 并被序列化到一个 JSON（`entry.layout`），方便 iOS 复用与保存。
5. **更多信息（折叠）**：标题、标签、关联地点——放在页脚一个可展开的"便签夹"里，默认收起。
6. **保存**：点击 "Save / Close the book"（或按 `⌘+Enter`）→ 页面合上、橡皮筋扣上、本子滑回桌面角落，同时这条新记录以**对应卡片格式**（拍立得/明信片/票根）从本子里"飞"到 Feed 里对应位置并轻微弹落（"print-in" 动效）。有未保存内容时关闭前提示（把本子半合着，露出一个"Unsaved page"便签）。
7. **编辑已有条目**：阅读器里点 "Edit" → 同一个本子翻到那一页并进入编辑态，不要两套 UI。
8. 键盘与可访问性：本子内 `Esc` 关闭、`Tab` 顺序合理、所有交互有 aria 标签；拖放同时提供点击替代方式。

### 3.5 阅读器
点击任何条目 → 条目从桌面"拿起并放大"（FLIP 动画）到居中，背景虚化；底下是本子的一页，内容与写作时一致（贴纸、照片位置原样回放），有 Edit / Favorite / Delete / Share 四个操作。

## 4. 交互与动效总则
- 动效**克制、有物理感**：弹簧缓动（可用 `cubic-bezier(.34,1.56,.64,1)` 做过冲），时长 180–700ms；重要仪式感动画（打开手账本、称重）可到 1.2s，但**必须可跳过**（点击/Esc）。
- 不要 loading 骨架以外的无意义动画；每个动画都要服务于"这一步发生了什么"。
- 所有可点击元素有 hover/active/focus-visible 状态；触屏 ≥44px 点击区。
- 不要使用任何外部图片/音频资源；插画全部用内联 SVG/CSS 绘制，照片用 mock 的渐变色块或 `https://picsum.photos` 占位。

## 5. 数据与"接口"约定（为 iOS 复用留好）
- `mock-data.js` 导出：`PACK_LIST`、`CHECKLIST`、`JOURNAL_ENTRIES`（字段：`id, title, body, happenedOn(YYYY-MM-DD), destination, country(ISO), tags[], mood, images[], template:'moment|place|note|interesting', favorite, layout[{type:'photo|sticker|tape|stamp|ticket|arrow', x,y,rot,scale, ...}]`）、`STRINGS`。
- 组件函数签名统一：`renderBag(kind, {label, loadPct, over})`、`renderScale({mode, readingG, limitG, verdict})`、`renderWeighTag({verdict, label, kg})`、`renderClipboard({title, done, total, items})`、`renderPostmark({city, date, ink})`、`renderPolaroid / renderPostcard / renderTicketStub(entry)`、`renderJournalCover({tint})`。每个函数只依赖入参，无全局状态。
- 动效参数集中：`const motion = { spring, openBook, weigh: {...}, flip, ... }`，并在 `README.md` 里列出每个组件的 props、状态与动画时间线，供移植。

## 6. 验收清单（自检后再交付）
- [ ] Prepare 首页：点击夹板/行李堆能直接进入，最底部不再有"Europe 2026"入口卡。
- [ ] Pack：三种形态的包明显不同；物品可拖入包并实时更新重量；超重有反馈。
- [ ] Weigh：新画风 + 物理动效；按钮有 4 种状态；有保存的称重小票；入口在场景里和顶部各有一处。
- [ ] Journal 六个视图都有"场景感"，Feed 像杂志，Gallery 像摄影集自动流动。
- [ ] 新建手记：打开本子 → 填日期/地点邮戳/心情贴纸 → 写正文 → 贴图贴纸 → 保存飞入 Feed，全流程顺畅可跳过。
- [ ] 亮/暗色、375px 手机宽度、`prefers-reduced-motion` 都已检查。
- [ ] 所有表单行：下拉箭头距边框 ≥14px，同一行控件等高。
- [ ] 没有新增 token 之外的颜色，没有页面标题下的说明文字。
