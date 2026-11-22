# 真实世界人物关系网

实施分支：`feat/unified-story-theater-20261117`，基线 `2e8375aa10cc0c3bd7b49ef2ad4c309bb819f615`。同一用户空间只有一张真实世界关系网，所有 `writesToCharacterMemory=true` 的剧场共享；虚构剧场继续使用自己的 `theater:${entry.id}` 历史。不同用户空间使用原有独立数据库。

## 参考、复用与许可

Float Phone 检查版本：[xiaolongbao0709/ai-virtual-phone@d9ca6fab](https://github.com/xiaolongbao0709/ai-virtual-phone/tree/d9ca6fab12112bdefe1751207aba4c4d13c63359)。

| 来源 | 检查内容 | 本次采用方式 |
| --- | --- | --- |
| Float `components/phone-character-app.tsx` | 人物卡片画布、缩放、人物对入口 | 交互设计参考 |
| Float `components/character/relation-dialogs.tsx` | 关系详情、编辑与双向呈现 | 设计参考；明确采用“起点认为对方是自己的什么人”语义 |
| Float `lib/character-world-storage.ts` | 人物关系持久化、布局分离 | 数据职责参考 |
| Float `lib/character-world-layout.ts` | 节点布局、视口与触控 | 交互设计参考 |
| React Flow `@xyflow/react@12.10.0` | React 节点、箭头、触控拖动、平移与双指缩放 | 实际安装复用；图界面按需加载 |
| Cytoscape.js | 图布局、交互与移动端支持 | 已评估；采用 React 人物卡片需要更多 DOM 与命令式画布衔接，本次未安装 |
| SullyOS `storyTheaterRelationships.ts` | XML/JSON 解析、FL/RI/DI 计算、旧 v1/v2 重放 | 提取并共用已有实现，不增加另一套公式 |
| SullyOS `db.ts`、`storyTheaterReply.ts` | 中央原文、镜像原子提交、重写与备份恢复 | 在原事务内维护关系状态 |
| SullyOS `storyRelationshipHistory.ts` | 世界归属、中央来源筛选、消息 ID 顺序 | 首次迁移与旧备份恢复复用 |

Float 使用 [AGPL-3.0](https://github.com/xiaolongbao0709/ai-virtual-phone/blob/d9ca6fab12112bdefe1751207aba4c4d13c63359/LICENSE)，本次没有复制、改编其实现、样式或素材。React Flow 与 Cytoscape.js 均为 MIT；React Flow 的实际运行依赖还含 ISC 和 BSD-3-Clause。SullyOS 原许可保持不变，新增依赖原文随应用发布在 [`public/licenses/real-relationship-network.txt`](../public/licenses/real-relationship-network.txt)。React Flow 兼容现有 React 18 / Vite 5。

## 数据与顺序

不新增表、索引或数据库版本。在现有 `assets` 内保存两条 JSON 文字记录：

- `sully_real_relationship_graph_v1`：当前有向关系、人物自我记录、结构化变化账本、递增 revision。
- `sully_real_relationship_layout_v1`：按人物 ID 保存的位置和画布视口。拖动、缩放不改变关系 revision。

有向关系键使用 `JSON.stringify([fromId,toId])`，姓名不参与合并。每个方向保存关系认同、第一视角认知、三轴及轴证据、最后变更来源、最后剧情来源。缺少轴代表未初始化，`score:0` 代表已经确认的零分。

普通读取直接取当前状态。首次读到旧缓存时按中央消息 ID 补录缺失事件，保留已有事件与手动编辑。补录完成后写入标记，后续读取直接使用当前状态。重写、删除和恢复需要时重放结构化账本。

剧情事件以中央消息 ID 排序，手动编辑记录保存当时最大的全局消息 ID，放在它之后；同位置按写入序号排序。设备时间、故事时间和镜像时间只作展示，不决定关系顺序。在旧的无关系楼层补入关系事件，也按该楼层原 ID 插入。重写提示词基线仅使用目标消息之前的事件，排除后续剧情和后续手动修正。

`story:<中央消息ID>` 唯一标识剧情事件。相同结构化载荷只保存一次。归档标记、镜像调整、私轴修改和元数据重复保存沿用已有关系记录。修改事件或删除来源后重建当前状态，保留没有被修改的其他方向。

## 单次生成与认知隔离

沿用原剧场的一次生成请求。默认关系判断与输出协议来源是 `assets/presets/three-axis-relationship.sully.prompt.json`，作为可编辑的预设条目 `nmj-v65-affinity-control` 进入请求；用户自定义正文和开关优先。运行时关系上下文只提供人物、当前状态和世界归属，不追加隐藏的关系判断指令。旧 U→C 滑块的历史元数据仍可查看，但不会在新三轴请求或重写时注入旧式察觉提醒。关系直接从原始回复解析，避免损坏的出演标签吞掉面板。解析异常随楼层记录具体原因。关系指向本次请求候选的明确 ID，或唯一精确匹配的姓名。

结构化结果在中央消息事务内追加到已有账本。读者面板显示本次提交的轴。有旧值时，程序用新分减去旧分计算展示差值。首次评分只显示当前分。读者面板和关系网状态在同一事务提交。

真实关系沿用 `<affinity_panel mode="three_axes">`，也兼容 JSON `<relationship_panel>`。方向字段包括 `relation_identity`、`relation_cognition`、`relation_note`、`relation_fragment`，以及可选的 `relation_trigger`、`relation_evidence`。认同、认知、关系天气、相处片段与 FL/RI/DI 数值分别承接；它们不需要绑定数值变化，也不要求逐项触发/证据。角色 ID 与数值合法性仍由程序校验。

人物以自身性情、成长经历、关系史和当下剧情判断 FL、RI、DI 的当前绝对分。各轴独立接收 0–100 的整数 `score`，首次评分也使用整个范围。有效分数直接取代该方向的旧值。省略评分或评分无效时沿用原值。DI 由人物自行判断扰动是否缓和与缓和的程度。新状态写入与重放只读取 `score`。

私有认同与认知只保存到中央消息 metadata 和关系网，不写进人物镜像。新真实回复的数值面板与自我记录也从镜像正文剥离，防止后续记忆把读者面板当作他人已表达的事实。角色原文上下文继续剥离关系面板；私轴仍按原角色归属处理。预设明确关系状态由人物自身的性情、经历、处境与情绪潮线决定；每个方向只承接该人物亲历或明确获知的事情。程序仅提供历史基线、解析与保存，不要求人物提供格式化的心理证据。

默认三轴文案归属预设资源，代码仅负责载入、兼容、面板解析、记录与展示。只升级与已发布默认文本完全一致的预设正文。用户自定义文本、开关、名称和顺序继续保留。关系文字可单独保存，关系历史继续承接未评分的轴。

## 原子提交、备份与旧数据

中央回复、镜像和关系变化在同一 IndexedDB 写事务提交；任何一项失败整笔回滚。生成前读取真实图 revision，保存时在同一事务检查剧场归属与 revision。两个真实场景同时使用旧基线时，先提交的一笔成功，另一笔保留推进并提示重试；不自动增加付费请求。

归档不删除中央原文，也不移除关系事件。删除中央楼层或整个来源剧场时删除相应事件；手动编辑不附属于某个剧场，继续保留。

完整备份携带当前状态、账本、手动事件和独立布局；纯文字备份把这两条记录纳入已有文字资产管线；纯媒体导出/恢复排除它们。恢复新备份使用保存的状态；恢复旧备份从恢复后的中央真实历史迁移一次。消息补丁恢复从最终合并的消息重建，同时保留原有与导入的手动事件和布局。恢复完成后提升 revision，阻止仍使用旧基线的请求提交。独立用户导入沿用现有 ID 重映射，并重建方向键；不按姓名合并人物。

原恢复器分表分批提交。旧关系状态和布局保留到最后的关系事务完成，前面某节失败不会提前清空手动账本；整个应用的多表恢复仍沿用原有分批流程。

旧 XML/JSON 绝对快照按其保存的分数续接。旧 v2 面板和已入账的 `proposal` 保留原增量与已记录的 DI 衰减逻辑。新 `state` 记录和 v3 面板重放时使用各轴绝对分，即使此前的评分被删除也能独立恢复。旧五维原文可回看，历史承接其中有明确角色 ID 的自我记录。损坏或不识别的关系缓存报错并保留原数据。

## 界面与验证

入口在剧情列表顶部和真实剧场头部。React Flow 提供可拖人物卡、有向箭头、触控平移和双指缩放。点击箭头可查看、分别编辑双方关系并查看来源与证据。手动提交仅包含改动字段，避免编辑称谓时把未改的数值变成覆盖历史的手动快照。并发冲突保留草稿，提供读取最新关系操作。

自动测试覆盖真实剧场共享、虚构隔离、方向独立、绝对初值、展示差值、DI 自主回落、文字独立写入、无效轴跳过、重试、重写与删除后混合重放、归档与镜像、备份恢复及并发写入。

可复现的纯合成人物浏览器夹具：`pnpm exec vite --config test/fixtures/real-relationship-network.vite.config.ts`，打开 `/test/fixtures/real-relationship-network.html`。它使用隔离上下文，不挂载用户的 OS provider。实际 Chromium 移动触控验证包含拖动位置保存、双指缩放 0.8→2、点击连线、编辑单方向、刷新后关系及布局保留；无页面异常或横向溢出。

2026-11-20 最终验证：

- `pnpm exec vitest run storyTheater storyRelationshipHistory realRelationship theaterGenerator utils/activityBackup.test.ts utils/backupRoundtrip.test.ts utils/db.backupChunked.test.ts utils/chatHistoryCleanup.test.ts utils/userSpaceBackup.test.ts utils/independentUserImport.test.ts`：29 个文件，352 项通过、2 项失败。
- 两项失败分别为既有计费源码字符串断言（`storyTheaterBillingSafety.wiring.test.ts:44`）与既有独立用户导入字幕设置断言（`independentUserImport.test.ts:135`）。在未修改的上述基线源码隔离快照中，两项均同样失败，其余 9 项通过。本次没有修改这两项产品行为。
- `pnpm exec tsc --noEmit --pretty false`：修改前后各 740 条诊断；按文件、错误码、信息比较，忽略行列号与 DB 方法数，新增/消失均为 0。全仓类型检查仍未通过。
- `pnpm build` 成功（20.89 秒）；既有大包体积警告仍在。
- 上述 Chromium 移动触控测试通过；会话测试确认每轮仅一次模拟生成请求。测试使用合成数据/模拟接口，尚未做真实模型知识边界验收。

## 边界处理

- 重写时，缺失、损坏或全部方向无效的关系报告保留旧楼层的记录。显式空报告撤销该楼层的记录。
- 直接修改正文不会让 AI 重新解释剧情；新协议的有效事件在中央 metadata 中，关系修改使用重新生成或关系网编辑。老协议仍读取该楼层现有面板。
- 删除一条历史评分后，依赖它的旧增量需要另一个有效的先前分数才能重放。后续有效的绝对状态仍按原分写入。
- 同世界 revision 检测较保守，不同人物对同时生成也可能要求其中一次重试。
- 第一视角证据的语义仍由生成模型判断；程序隔离存储和镜像、校验 ID 与证据字段，不推断正文未表达的关系事实。
