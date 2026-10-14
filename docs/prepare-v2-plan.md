# Prepare v2 — plan (2026-10-14, branch `feat/prepare-v2`)

Owner decisions (don't relitigate): checklist 默认放最前的 = 未完成项最多的那张；包的颜色/大小用户可选（schema 加可选字段，iOS 跟进）；4 个以上的包用「+N 行李牌」，场景尺寸不变。

## Phases

| # | 内容 | 主要文件 |
|---|---|---|
| A | Banner 参照 Dashboard `.td-hero`（圆环 · 文案 · 两个小环统计 · 提醒槽）；落地页去重：删状态卡、列表行、出发前横条；标题栏只留一个 `+ 新建 ▾`；两侧场景固定高度；各状态（空 / 无条目 / 进行中 / 全完成；无包 / 1–3 包 / 4+ 包）；场景内 `‹ 名称 n/N ›` 切换 | `prepare.ts` `phase-strip.ts` `prepare-scenes.ts` `prepare-ui.ts`(新) CSS |
| B | Checklist 详情：面包屑返回 + 细进度 + Next-up 胶囊（跳转并晃动对应便签）+ ⋯ 菜单；顶部预设标签并入便签墙末尾的「+ 新便签」combobox | `checklist-section.ts` `checklist.css` |
| C | Pack 数据：`PackContainer.tone`(0–5) / `size`(S·M·L) 可选，kind 增 `duffel`；Add/Edit bag 弹窗带预览；背包重画；图鉴测试 | `schema/pack.ts` `luggage.ts/css` `pack-section.ts` |
| D | Pack 详情：面包屑返回 + ⋯ 菜单（删除清单），与 Checklist 详情一致；iOS 合同文档更新 | `pack-detail.ts` `docs/pack-scene-ios.md` |

## 状态表

**Checklist 场景**：无清单 → 空白剪贴板 + 引导新建；有清单无条目 → 清单名 + “点开添加第一项”；进行中 → 固定 4 行只显示未完成项，超出写「+还有 N 项」；全完成 → ALL DONE 印章；多张 → 场景左上角切换器。
**Pack 场景**：无清单 → 虚线行李箱轮廓 + 秤 0.0；有清单无包 → 同上“加一个包”；1–3 包 → 并排；≥4 包 → 画重量最大的 3 个 + 行李牌「+N」，秤读总重；多张 → 切换器。
**Banner 提醒槽**（取代 Weigh 状态卡 + 出发前横条）：超重 > 未称重/已变更 > 无；14 天内更醒目。

## iOS 注意

`duffel` 是新的 `kind` 枚举值，`tone` / `size` 是新的可选字段。iOS 解码 `PackContainer` 前要先支持，否则旧版会解码失败。见 `docs/pack-scene-ios.md`。
