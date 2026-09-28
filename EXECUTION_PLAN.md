# Execution plan — web (from the 2026-07-28 audit)

分阶段执行方案,Claude Code 可按顺序直接执行。每个任务给出目标、涉及文件、
步骤、验收标准。**GIF 资产优化不在本计划内**(用户单独处理)。

统一验收底线:每阶段结束 `npx tsc --noEmit`、`npm run lint`、`npm test`、
`npm run build` 全绿;涉及 rules 变更时加 `npm run test:rules`。

---

## 阶段 W0 — 前置(用户手动,Claude Code 不执行)

- [ ] Google Cloud 控制台:给 `GOOGLE_PLACES_KEY` 设每日配额上限(兜底)。
- [ ] 创建 Upstash Redis(免费档即可),把 `UPSTASH_REDIS_REST_URL` /
      `UPSTASH_REDIS_REST_TOKEN` 填入 Vercel 环境变量和本地 `.env`,
      并在 `.env.example` 留占位。
- [ ] W1 部署后:真机/浏览器回归一遍 Nomad 弹窗的地点搜索。

---

## 阶段 W1 — API 安全(P0)

### W1.1 `/api/places` 加鉴权

**目标**:autocomplete/details 必须携带有效 Firebase ID token;photo 用短时
签名参数(`<img src>` 无法带 header)。

**背景事实**(已核实,勿重新调研):
- 游客走 `signInAnonymously`(`src/firebase/auth.ts`),所以**所有**用户都有
  ID token,强制鉴权不影响游客体验。
- `src/core/api.ts` 已有附带 `Authorization: Bearer <idToken>` 的 fetch 封装,
  AI 端点都在用 — 复用它。
- web 端唯一调用方:`src/views/nomad/nomad-modal.ts`(含 `op=photo` 拼 img url)。
- iOS `PlacesService.swift` 也调这个端点 — 见 iOS 仓库 EXECUTION_PLAN 阶段 D,
  **两端需同批改**(App 未上架,无兼容窗口问题;web 客户端随部署原子更新)。

**步骤**:
1. `api/places.ts`:对 `op=autocomplete|details`,从 `Authorization` header 取
   token,用 `api/_guard.ts` 已导出的 `verifyFirebaseToken()` 校验,失败 401。
   CORS 改为仅允许生产域名 + localhost:5180。
2. photo:`op=details` 的响应中,把 photo 引用改为带 HMAC 签名的完整 URL
   (`sig = HMAC(PLACES_PHOTO_SECRET, ref + exp)`,exp 15 分钟)。
   `op=photo` 校验 sig+exp 而不要求 header。`PLACES_PHOTO_SECRET` 进 env
   (新增,`.env.example` 留占位)。
3. `nomad-modal.ts`:autocomplete/details 改走 `api.ts` 的鉴权 fetch;
   photo 直接使用 details 返回的签名 URL。
4. 测试:`api/places.test.ts` 补 401(无 token)、200(有 token)、
   photo 签名过期/伪造 403 用例(mock verifyFirebaseToken,参照
   `api/_guard.test.ts` 的既有 mock 手法)。

**验收**:无 token 的 curl 打 autocomplete 返回 401;测试全绿。

### W1.2 统一限流

**目标**:所有 `api/` 端点按 uid(登录)或 IP(无 token 路径)限流,超限 429。

**步骤**:
1. 新建 `api/_ratelimit.ts`:基于 Upstash REST 的固定窗口计数器
   (`INCR` + `EXPIRE`,无需引入 SDK,fetch 即可),接口
   `checkRateLimit(key, limit, windowSec)`。**Upstash env 缺失时直接放行**
   (fail-open,本地 dev 不需要 Redis)。
2. 接入点与建议配额:`places` 30 次/分/uid;AI 端点(`guide`、`guide-more`、
   `story`、`safety`、`check`)10 次/分/uid;`create-checkout` 5 次/分/uid。
   billing-webhook / verify-apple-receipt 不限(有自己的校验)。
3. 429 响应带 `Retry-After`;`src/core/api.ts` 对 429 给用户可读提示
   (i18n en/zh 各加一条)。
4. 测试:`api/_ratelimit.test.ts`(mock fetch,验证计数、过期、fail-open)。

**验收**:超限请求得到 429;env 缺失时行为不变;测试全绿。

---

## 阶段 W2 — 离线与版本更新(P1)

**目标**:所有视图 chunk 构建时预缓存(当前只有访问过的页面离线可用);
新版本部署后用户收到"刷新更新"提示(当前无感知,cache 名靠手动 bump)。

**步骤**:
1. 引入 `vite-plugin-pwa`,用 **injectManifest** 模式保留自定义逻辑:
   把 `public/sw.js` 迁到 `src/sw.ts`,保留通知(`SHOW_NOTIFICATION`、
   notificationclick)与导航回退逻辑,精缓存改为
   `precacheAndRoute(self.__WB_MANIFEST)` + workbox 路由
   (导航 NetworkFirst,静态资产 StaleWhileRevalidate)。
2. 注册端:`src/boot-shell.ts:379` 的手动 `serviceWorker.register('/sw.js')`
   改为 `virtual:pwa-register` 的 `registerSW({ onNeedRefresh })`,
   onNeedRefresh 弹一个非阻断 toast(复用既有 toast 样式):
   "新版本已就绪 — 点击刷新" / "New version ready — tap to reload"(i18n)。
3. `manifest.json` 交给插件生成或显式传入现有内容,确保输出不变。
4. 清理:删除 `public/sw.js` 与手写 cache 版本号逻辑。

**验收**:`npm run build` 后 dist 内 workbox precache manifest 包含全部视图
chunk(itinerary/journal/map/…);dev server 正常;构建产物本地 `npm run preview`
断网后可打开未访问过的视图(手动验证步骤,写进 PR 描述)。

**注意**:本阶段动的是缓存与注册,**不改任何业务逻辑**;Firestore 离线持久化
(`src/firebase/config.ts`)已就绪,勿动。

---

## 阶段 W3 — 清理(P1,半小时内)

1. 删 `src/style.css`(已核实无引用 — Vite 模板残留,先 grep 确认后删)。
2. 删 `firestore-debug.log`,`.gitignore` 加 `firestore-debug.log`、`*.log`
   已有则跳过。
3. 删 `src/assets/vite.svg`、`src/assets/typescript.svg`(模板残留,grep 确认)。
4. 确认语言选择器只暴露 en/zh(此前已实现隐藏逻辑,验证即可)。

---

## 阶段 W4 — 结构约束(P2)

**目标**:五个巨型视图文件"只减不增"的机器化约束。

**步骤**:`eslint.config.js` 加 `max-lines` ratchet — 全局宽松,对
`map.ts`(1803)、`itinerary.ts`(1799)、`expenses.ts`(1468)、
`guide.ts`(1457)、`dashboard.ts`(1331)按**当前行数**设为上限(error)。
文件被拆小后手动下调上限。新功能一律按 `views/journal/` 的子模块模式组织。

---

## 明确不在本计划(等用户决策)

GIF 转 webm/mp4(用户单独处理)· Nomad/Compare 删留 · Safety 降级 ·
Pack/Checklist 合并 · web dark mode。
