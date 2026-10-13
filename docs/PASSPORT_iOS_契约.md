# 护照 · 跨端契约（iOS / Web 共用）

> 目的：iOS 端按这份契约搭建数据层和规则，不需要等 UI 设计稿。
> 一句话：**护照是账号级的，不属于任何一次行程。哪些章存在由行程推导，不存储；存储的只有「你怎么盖的」和「你写了什么」。**
> Web 实现：`src/data/footprint.ts` · `passport.ts` · `passport-state.ts` · `card-postmarks.ts` · `visa.ts`，以及 `src/views/passport/`。

## 1. 谁做什么

| 事情 | 谁 | 说明 |
|---|---|---|
| 推导有哪些章、卡片邮戳、签证对照、申根天数 | **各客户端本地** | 全部是对 legs 的纯计算，**没有服务端**。两端规则必须一致（§3、§6、§8） |
| 盖章位置 / 力度、资料页、签证 | **Firestore（用户级）** | 谁写入都行，另一端订阅即可看到 |
| 章的具体画法 | 各端自己画 | 但**选哪种外框 / 墨色 / 角度的规则要一致**（§4），这样同一枚章在两端长得像 |

## 2. Firestore 文档

三个集合都在 `users/{uid}/…` 下，**已被现有规则覆盖（仅本人可读写），无需改 rules**：

| 路径 | 内容 |
|---|---|
| `users/{uid}/passport/me` | 昵称、照片、签名、每枚章怎么盖的 |
| `users/{uid}/passportDocs/me` | 可选的真实证件信息（**单独一个集合**，便于排除在任何导出 / 分享之外） |
| `users/{uid}/visas/{id}` | 签证，一份一个文档 |

所有文档带通用 meta：`createdAt` / `updatedAt`（毫秒时间戳）、`schemaVersion`（=1）。读取时对缺字段按下表默认值处理。

### 2.1 `passport/me`

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `nickname` | String | `""` | `""` = 用账号名字的第一个词；再没有就用「Traveller / 旅行者」 |
| `photoURL` | String | `""` | `""` = 用账号头像。上传到 Storage `users/{uid}/passport/{随机id}.jpg`，长边 ≤ 640px |
| `nationality` | String | `""` | ISO 3166-1 alpha-2。`""` = 沿用安全资料（`safetyProfile/me.nationality`）的国籍 |
| `occupation` | String | `""` | `""` = 显示「Traveller / 旅行者」 |
| `signature` | String | `""` | SVG path 数据，坐标在 **300 × 100** 的盒子里，只含 `M m L l Q q 数字 . - 空格 ,`。**渲染前必须校验**：长度 ≤ 4200 且只含这些字符，否则不画 |
| `placements` | Map<stampId, Placement> | `{}` | 见 §5 |

### 2.2 `passportDocs/me`（可选的真实证件信息）

`fullName` · `number` · `issuingCountry`（均 String，默认 `""`）、`issued` · `expires` · `birthDate`（ISO 日期 String，默认 `""`）。

- **只有本人可见**。不得进入任何分享、导出图、分享链接、AI 请求、协作者可见的数据。
- 证件号**默认打码**，只显示最后 4 位（`••••• 5678`），点「显示」才露出，另有「复制」。
- 不强制，不引导必填。
- **有效期提醒**（§7.1）用 `expires` 对照所有未结束的行程。

### 2.3 `visas/{id}`

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `region` | String | — | ISO alpha-2（`"JP"`），或特殊值 `"SCHENGEN"`（整个申根区） |
| `type` | String | `""` | 自由文本（旅游 / 商务 / 工作 / 学生 / 过境 / 其他，可自填） |
| `number` | String | `""` | 签证号，**展示时同样打码** |
| `validFrom` · `validTo` | String | `""` | ISO 日期 |
| `entries` | `"single"` \| `"double"` \| `"multiple"` | nil | 入境次数 |
| `stayDays` | Int? | nil | 每次可停留天数（1–3650） |
| `notes` | String | `""` | |
| `photoURL` | String | `""` | 预留，Web 暂未用 |

**不内置「哪些国籍去哪些国家需要签证」的数据**：政策随国籍和时间变化，容易过期出错；用户自己判断并添加。

## 3. 推导：足迹与国家章

### 3.1 足迹（`buildFootprint(legs, today)`）

输入是**所有行程**的 legs（Web 用 `routeStore.subscribeAll`；iOS 对应跨行程的 leg 订阅，和地图「全部足迹」同一数据）。

1. 只保留 `dateFrom <= today` 的 leg（**到达日当天就算去过；未来的 leg 一律不算**，也不显示任何占位）。
2. 按 `dateFrom`、`order`、`id` 排序。
3. 国家 key：`iso = isoForCountry(country, flag)`；解析不出时用 `country.trim().toLowerCase()`（仍然有章）。ISO 对照表以 Web 的 `src/data/geo-index.ts` 为准——**iOS 须使用同一张表**，否则两端国家数会对不上。
4. **同一行程内**每个国家只有一条 **TripVisit**（Copenhagen → Berlin → Copenhagen 对丹麦只算一条）：
   - `date` = 该行程第一次到达该国的 `dateFrom`
   - `dateTo` = 该国已到达各段里最晚的 `dateTo`
   - `cities` = 去重后的城市名，按到达顺序
   - `nights` = Σ 各段 `max(0, days(dateFrom → min(dateTo, today)))`（当前这段只算到今天）
   - `mode` = 第一段的 `arrivalTransport.type`
5. 按 `(date, country)` 排序后，同一国家**最早的**那条 `firstEver = true`，其余为 false。
6. 汇总：`countries` = 去重国家数；`cities` = 去重城市数（`iso:小写城市名`）；`nights` = Σ nights；`trips` = 有 TripVisit 的行程数；`stamps` = TripVisit 数。

> **地图一致性**：`countries` 必须等于地图 World 视图 `summary.countries`（同一批 legs、同一天）。Web 有测试守着（`footprint.test.ts`）。

### 3.2 国家章

**每个行程里的每个国家一枚章**（Q1：新行程再去同一个国家 = 新章；国家数只按去重算）。

- `id` = `country:{iso}:{tripId}`；iso 缺失时 `country:{小写国名}:{tripId}`；无行程时 tripId = `_`
- 字段：`country`、`iso`、`date`、`nights`（`max(1, nights)`）、`cities`、`legIds`、`mode`、`tripId`、`tripName`、`firstEver`
- 按 `(date, id)` 排序

### 3.3 已盖 / 待盖 / 孤儿（`passportState`）

- **已盖**：有对应 `placements[stampId]`。
- **待盖**：推导出来但没有 placement。**待盖的章不在任何一页上**，在「托盘」里等用户去盖（可一枚枚盖，也可一键全盖）。
- **孤儿**：有 placement、但推导不出这枚章了（行程或停留被删）。**章保留**（集章是用户的成果），用 placement 里的 `snap` 复原，页头标注「行程已删除」。没有 `snap` 的孤儿 placement 忽略。

## 4. 章的外观（两端一致的选择规则）

只规定**怎么选**，具体绘制各端自便。

**哈希**（必须逐位一致，JS 32 位有符号整数语义）：

```
hashStr(s): h = 0; for 每个 UTF-16 code unit c: h = (h << 5) - h + c; h |= 0   // 转成 int32
            return abs(h)
```

| 项 | 规则 |
|---|---|
| 外框 | 列表 `[circle, double, rounded, cut, tilted, arch, perf, oval, hex, octagon]`，取 `[hashStr(iso 或 小写国名) % 10]` |
| 墨色 | `country-ink.ts` 的 ISO→颜色表；未收录的取 `FALLBACK[hashStr(ISO 大写 或 小写国名) % 6]` |
| 角度 | `(hashStr(stampId) % 29) - 14` 度（只是默认值；被盖过的章用 placement 里的 `rot`） |
| 墨迹滤镜 | `hashStr(stampId) % 3` 选三种磨损参数之一 |
| 重影 | `hashStr(stampId) % 8 == 0` 的章「盖了两次」：多一个偏移 (1.4, 0.9)、透明度 .32 的副本 |
| 墨深浅 | `opacity = 0.62 + 0.36 × pressure`（pressure 默认 0.75） |
| 标题 | `nights<=1`「ONE NIGHT IN」；`2–3`「WEEKEND IN」；`4–8`「A WEEK IN」；`>=9`「{n} NIGHTS IN」 |
| 图标 | 先查该国自己的地标，否则用大洲兜底，再否则指南针。对照表见 `src/core/paper/stamp-icons.ts` |

> 样例（可当测试向量）：`hashStr("DK")=2183` → 外框 `cut`；`DE=2177` → `oval`；`NL=2494` → `tilted`；`FR=2252` → `rounded`。`country:DK:t1` 默认角度 `3`，`country:DE:t1` 为 `13`。

## 5. 盖章（Placement）

```
Placement { page: String, x: Double, y: Double, rot: Double, pressure: Double 0–1, at: Int(ms), snap?: Snap }
Snap      { tripId, tripName, iso, country, date, nights, cities[], mode? }
```

- **页码** `page` = `{tripId}#{n}`（n 从 0 起）。**页不会混行程**；页头显示行程名。这个命名不随别的行程增删章而变，所以已盖的章不会「跳页」。page 里的 tripId 必须等于章自己的 tripId，否则忽略这条 placement。
- **坐标** x、y = 章**中心**，占页面宽 / 高的百分比；用户落点限制在 x∈[20, 80]、y∈[26, 88]。
- **每页最多 6 枚**。盖新章时用该行程**第一个有空位的页**；都满了就新开 `{tripId}#{n+1}`。
- **一键盖章 / 「帮我盖」**（`autoPlacement`）：固定落点表按顺序取第一个**不压到已有章**的点（x 差 ≥ 30 或 y 差 ≥ 20 算不压）：

  `[(29,30), (72,55), (31,79), (71,34), (28,55), (69,82)]`

  再加确定性抖动：`x += wobble(id+"x")*4`，`y += wobble(id+"y")*3`，`wobble(s) = ((hashStr(s) % 2001) / 1000) - 1`；`rot` = 章的默认角度；`pressure = 0.75`。
- **盖章手势**：拖动橡皮章到想要的位置，**按住不动**，松手时落章；**按得越久墨越深**：`pressure = clamp(按住毫秒 / 1100, 0.3, 1)`（保留两位小数）。轻点 = 0.3。键盘：方向键移动、回车 = 0.8。
- 写入：`passport/me.placements` 整个 Map 一次写（本地先生效，再等订阅回写确认）。写入时务必带上 `snap`。

## 6. 卡片邮戳（Itinerary 每个城市卡片）

与护照国家章**不是一回事**：每个城市最多两枚，全自动，不存储，只描述当前行程进度。

- **到达章** `arrive:{legId}`：`dateFrom <= today` 时出现。**离开章** `depart:{legId}`：`dateTo <= today` 时出现。
- 到达章外框取 `[circle, double, octagon][hashStr(小写城市名) % 3]`；离开章取 `[rounded, oval, hex][hashStr(小写城市名 + "d") % 3]`（所以一对章形状一定不同）。
- 角度：`(hashStr("a" + legId + dateFrom) % 25) - 12`；离开章用 `"d" + legId + dateTo`。
- 到达章写「ARRIVED · {AIR|RAIL|COACH|SEA}」；离开章写「DEPARTED · …」，交通方式取**下一站**的 `arrivalTransport.type`（最后一站没有）。
- 墨色同国家章。**透明背景，无纸片**；位置在日期块左侧，到达章压住日期块的左缘，离开章略小、错开叠压。
- 当前站不再显示「已结束」的灰化——**过往城市的照片保持原色**。
- 首次见到时播一次落章动画（设备本地记录，`otr:stampsSeen` 对应 iOS 用 UserDefaults 即可），之后静态。
- 点击 → 打开护照，翻到该国家的章；若那枚章还没盖，直接进入盖章。

## 7. 其他规则

### 7.1 证件有效期提醒

`passportDocs/me.expires` 是合法 ISO 日期时，对每个**未结束**的行程（`endDate >= today`）：
- `expires < endDate` → `expired`（行程结束前就过期）
- 否则 `expires < endDate + 6 个月` → `short`（很多国家要求入境时 / 离境后至少 6 个月有效）

提醒显示在护照口袋卡（⚠）和侧栏护照按钮（红点）。

### 7.2 签证对照（`visa.ts`）

- **覆盖**：`region == iso`，或 `region == "SCHENGEN"` 且 iso 属于申根区 29 国：`AT BE BG HR CZ DK EE FI FR DE GR HU IS IT LV LI LT LU MT NL NO PL PT RO SK SI ES SE CH`。
- **用于哪些行程**：leg 在覆盖区域内、且 `[dateFrom, dateTo]` 与 `[validFrom, validTo]` 有交集 → 按行程归并，列出国家。
- **提醒**（只看未结束的停留）：
  - `outlasts`：某段停留 `dateFrom <= validTo < dateTo`（开始时有效，结束时已过期）。
  - `longStay`：同一行程内、区域内**首尾相接（间隔 ≤ 1 天）**的连续停留，天数 `(末段 dateTo − 首段 dateFrom) + 1 > stayDays`。
- **申根 90/180**：把区域内所有 leg 的 `dateFrom…dateTo`（含两端，到达日和离开日都算一天）展开成日期集合；`used` = 以今天为终点的 180 天窗口内的天数；`remaining = max(0, 90 − used)`；`peak` = 今天及之后每个停留日为终点的窗口里的最大值；`overstayOn` = 之后第一个窗口数 > 90 的日期（没有则空）。**仅供参考，按用户的行程推算**。

### 7.3 行程完成章

「TRIP COMPLETE · N 天」是**单次行程页（Wrap）**里的一枚小章，**不进护照**。行程结束后才出现（进行中不出现）。

## 8. 入口（建议两端一致）

| 位置 | 内容 |
|---|---|
| 侧栏头像旁 | 🛂 按钮；有待盖的章或提醒时带红点 / 数量 |
| Dashboard | 一行「护照口袋」：`{n} 枚印章 · {c} 个国家`，各国墨点，「N 枚待盖」「⚠」 |
| Itinerary 顶部 / Profile / Map 国家面板 | 同一个口袋卡 / 该国的章 |
| 点任意章 | 章翻面 = 该国家回忆卡：本次行程的城市、晚数；历次合计；日记篇数与照片；本次行程在该国的花费（**各行程用各自币种，不跨币种相加**） |

回忆卡的日记 / 花费归属沿用 Map 国家面板的规则（`country-extras.ts`）：日记看 `destination` 是否命中该行程的某个城市或国名，否则看当天落在哪一段；花费看 `expense.country`。

## 9. iOS 可以先不做的

- 3D 翻页、声音、墨迹滤镜、「重温旅程」回放 —— 纯表现层。
- 手写签名板可以先只读展示（按 §2.1 校验后画 path），编辑稍后。
- 签证页可以晚于国家章上线；但 §2.3 的字段不要改名，Web 已在用。

**必须先做对的**：§3（推导）、§5（placement 读写）、§2 的字段名与默认值、隐私规则（§2.2、§7.3）。

## 10. 改动规则

Schema 一变，两端都受影响：**改字段、改推导规则、改 id 格式时，请同一次提交里更新本文档**。
