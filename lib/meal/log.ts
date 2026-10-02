import AsyncStorage from '@react-native-async-storage/async-storage';
import { shiftISO, toISODate, today } from '../date';

// ============================================================
// 「今天吃了什么」的账本（2026-09-26 新建）
// ============================================================
// 它是**唯一**把「餐盘页的分析结果」和「首页那三行」连起来的东西：
//   餐盘页分析完 → 用户点「早餐 / 中餐 / 晚餐」→ 往这里写一条
//   首页 → 从这里按日期把早中晚各自的碳水、热量加起来
//
// 为什么用手机本地存储（AsyncStorage），不跟任务一样走云端：
//   ① 它必须在**离线**时也能用 —— 在食堂拍完照，网不稳，记录不能丢；
//   ② 走云端要先在 Supabase 建表、部署，多一道手续，收益却只是换手机时能看到，
//      而这份数据本来就是"看今天"的，先本地够用。
//   ③ 将来真要同步，只要把这个文件里的读写换成云端调用即可 ——
//      界面一行都不用动（界面只认下面这几个函数，不碰存储细节）。
//
// ⚠️ 一条记录 = **一餐一条**（2026-09-26 晚改的规矩）。
//    用户原话：「每一餐只能拍一张照片，如果要重拍，就去掉前面的，
//    就是说只能覆盖掉，不能留两张。」
//    → 早餐只能有一条记录，重拍就是把它**顶掉**（走 replaceSlotEntry）。
//    改之前是"一次分析一条"、首页会把同餐几笔加起来；那个行为已经取消。
//    ⚠️ 老数据里可能已经存着同一天同一餐的两条（改之前记的）：
//       home 那边会照常把它们加起来（数字不会错），点开只看最近那一条。
//       用户下次给那一餐重拍时会自动收敛成一条。
//
// ⚠️ 但**照片不是这样**（2026-09-26 深夜定的，别再反过来）：
//    相册里的照片**一张都不删**。账本顶掉旧记录，旧照片留在相册里。
//    用户原话：「头一次照片存在相册里的不要删。因为如果说后期用户还想
//    从相册导入换成前面一张，让他也可以办得到。」
//    → 相册 = 这一餐所有拍过版本的历史；想换回哪张，就用餐盘页的
//      「从相册选」把它导回来（会重新分析一次，然后顶掉当前这条）。

// 三餐。用固定的三个英文 key 存，中文只用来显示 ——
// 把中文存进存储里，将来想改成"早餐/早饭"就得改数据，太蠢。
// 三餐的类型和「齐不齐」判定住在 lib/meal/slots.ts（纯函数，趋势图也要用）。
// 这里转出去一份，老引用路径（… from '../lib/meal/log'）照旧能拿到。
export type { MealSlot } from './slots';
import { SLOT_KEYS, type MealSlot } from './slots';
export { SLOT_KEYS };

export const SLOTS: { key: MealSlot; label: string }[] = [
  { key: 'breakfast', label: '早餐' },
  { key: 'lunch', label: '中餐' },
  { key: 'dinner', label: '晚餐' },
];

export function slotLabel(slot: MealSlot): string {
  const hit = SLOTS.find((s) => s.key === slot);
  return hit ? hit.label : '';
}

export type MealLogEntry = {
  id: string; // 一条记录的身份证。同 id 再存一次 = 覆盖它（改克数时走这条路）
  date: string; // "2026-09-26"。按天分组、算连续天数全靠它
  slot: MealSlot; // 归到哪一餐
  calories: number; // 这一餐（这一次分析）的热量合计，千卡
  carb: number; // 碳水合计，克
  names: string[]; // 认出来的食物名，最多留 6 个，首页那行小字就是它
  at: number; // 写入时间（毫秒）。同一天同一餐有几条时，按这个排在后面

  // ---------- ★ 2026-09-26 下午加：为了「点首页那一餐能回到当时那张照片和分析」 ----------
  // 用户原话：「在首页点早餐，应该能回到分析页面，看到照片和底下的分析。」
  //
  // 为什么要把整份分析都存下来，而不是只留个数字：
  //   首页那一行只有"碳水 42 克"，点进去要能看到**当时认出了哪几样、各多少克、
  //   每项的碳水、那句总评、用了什么参照物** —— 这些不看照片是说不清的。
  //
  // imageUri 存的是**照片在手机里的位置**（一个字符串路径），不是照片本身。
  // ⚠️ 它是拍照时系统给的临时位置（cache 目录）。这个目录平时不会自己清，
  //    但手机空间特别紧张时**系统可能把它清掉**。所以读回来时照片有可能打不开 ——
  //    界面必须能优雅退化（显示"照片已经不在手机里了"，分析明细照常显示），
  //    绝不能因为少一张图就整页报错。见 meal.tsx 里的 restoreFromLog。
  imageUri?: string;
  items?: LoggedItem[]; // 逐项明细（当时屏幕上列出来的那些）
  summary?: string; // 那句总评
  confidence?: 'low' | 'medium' | 'high'; // 当时的可信度
  scale?: string; // 当时用到的参照物

  // ⚠️ 关于「相册里那张照片」：账本**只记它的位置（imageUri），不记它的编号**。
  //    2026-09-26 深夜定的死规矩：**App 永远不主动删除相册里的照片。**
  //    用户原话：「头一次照片存在相册里的不要删。因为如果说后期用户还想从相册
  //    导入换成前面一张，让他也可以办得到。」
  //    → 所以照片编号这个字段被删掉了（它当初存在的唯一理由就是"重拍时删旧照片"）。
  //    → 相册里那几张拍过的照片，就是用户可以随时导回来的"历史版本"。

  // ⭐ 这一顿是**后来补记**的（2026-10-02 加，见下面「补拍」那一节）。
  //   补拍 = 「照片现在才拍、账记在**过去**那一餐上」—— 比如 10-02 上午
  //   才想起来把 10-01 的早餐补进去。它**不是**老 bug 那种「记错日子」，
  //   所以必须有个记号，好让下面 isMisdated 别把它当被搬过的账去「修」
  //   （那会把用户补进去的那顿又挪回今天，还顺手报一条「日子不对」）。
  //   ⚠️ 默认 undefined（不是 false）：当天记的那一顿本来就没这回事，
  //      写 false 反而会在账本里塞一堆无意义的字段。
  backfill?: boolean;
};

// 用户当场改过哪几项（ meal.tsx 里界面染色用的就是它，两个文件共用一套说法，
// 免得"界面说改了名称、账本记成改了克数"这种对不上的事）。
//
// ⚠️ 它**曾经只是个 boolean**（改过 / 没改过）。2026-10-01 起改成四态 ——
//    用户原话：「我没有改克数，只改了名称，但是两项都变了颜色。」
//    boolean 存不下"改的是哪一项"，读回历史时只能整体当 'both'，
//    于是回看一条旧记录、又只改了名称，右边的克数也会被染黄。
//    老记录（还存着 true/false 的那些）仍然会降级成 'both'：
//    那是旧数据里确实没有的信息，对旧数据诚实，不说自己是 bug。
export type EditFlag = 'none' | 'name' | 'grams' | 'both';

// 一条记录里的一项食物。字段跟 meal.tsx 里界面用的 Row 对得上，
// 但**砍掉了只对"当场编辑"才有意义的部分**（比如 orig 原始值快照、basis 来源说明）——
// 那些东西存进账本只会让文件变大，回看时也用不上。
export type LoggedItem = {
  name: string;
  grams: number;
  portion: string;
  calories: number;
  carb: number;
  note?: string;
  source: 'ai' | 'user'; // AI 认出来的 / 用户自己补的
  edited: EditFlag; // 用户当场改过的是哪一项
  // 每 100 克的营养 —— 回看时如果用户还想改克数，靠它当场换算，不用联网。
  per100Calories?: number;
  per100Carb?: number;
};

const STORAGE_KEY = 'myapp.meal.log.v1';

// 只留最近多少天。
// 一天最多几条记录，120 天也就几百条，占不了多少地方；
// 但**不能不留上限** —— 账本只增不减，用两年后会拖慢启动。
const KEEP_DAYS = 120;

const round1 = (n: number) => Math.round(n * 10) / 10;

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return typeof n === 'number' && isFinite(n) ? round1(n) : 0;
}

// 把账本里那个「改过没有」的值读回成四态。
// 新账本存的是 'name' / 'grams' / 'both' / 'none' 这四个词中的一个，直接认；
// 老账本存的是 true / false —— 分不清改的是名称还是克数，
// true 只能整体当 'both'（两项都显示成改过），false 就是没改。
export function normalizeEditFlag(v: unknown): EditFlag {
  if (v === 'name' || v === 'grams' || v === 'both') {
    return v;
  }
  return v === true ? 'both' : 'none';
}

// 把存储里一条明细项整理成标准形状。
// 老记录（2026-09-26 下午之前写的）根本没有 items，读出来是空的 —— 那是正常的，
// 界面会退化成"只显示合计"。形状不对的项就丢掉，别让它变成界面上的 NaN。
function normalizeItem(raw: unknown): LoggedItem | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const r = raw as Partial<LoggedItem>;
  if (typeof r.name !== 'string' || !r.name.trim()) {
    return null;
  }
  const p100c = num(r.per100Calories);
  const p100k = num(r.per100Carb);
  return {
    name: r.name.trim(),
    grams: num(r.grams),
    portion: typeof r.portion === 'string' && r.portion.trim() ? r.portion.trim() : '份量未知',
    calories: num(r.calories),
    carb: num(r.carb),
    note: typeof r.note === 'string' && r.note.trim() ? r.note.trim() : undefined,
    source: r.source === 'user' ? 'user' : 'ai',
    // 认得出是哪一项就用哪一项；认不出（老数据里的 true）就整体当 'both'。
    edited: normalizeEditFlag(r.edited),
    // 每 100 克的值两个都为 0 时当作"没有"，不写进去（省地方）
    per100Calories: p100c > 0 ? p100c : undefined,
    per100Carb: p100c > 0 ? p100k : undefined,
  };
}

// 把存储里的一条原始数据整理成标准形状。
// 存的可能是老版本写的、或者手抖改坏的 —— 认不出来的一律丢掉，
// 绝不让 undefined 流到界面上去（那会显示成"NaN 克碳水"）。
function normalizeEntry(raw: unknown): MealLogEntry | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const r = raw as Partial<MealLogEntry>;
  if (typeof r.id !== 'string' || !r.id) {
    return null;
  }
  if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
    return null;
  }
  if (r.slot !== 'breakfast' && r.slot !== 'lunch' && r.slot !== 'dinner') {
    return null;
  }
  const items = Array.isArray(r.items)
    ? r.items.map(normalizeItem).filter((i): i is LoggedItem => i !== null)
    : [];
  const conf = r.confidence;
  return {
    id: r.id,
    date: r.date,
    slot: r.slot,
    calories: num(r.calories),
    carb: num(r.carb),
    names: Array.isArray(r.names)
      ? r.names.filter((n): n is string => typeof n === 'string' && n.trim() !== '').slice(0, 6)
      : [],
    at: num(r.at),
    imageUri: typeof r.imageUri === 'string' && r.imageUri ? r.imageUri : undefined,
    items: items.length > 0 ? items : undefined,
    summary: typeof r.summary === 'string' && r.summary.trim() ? r.summary.trim() : undefined,
    confidence: conf === 'low' || conf === 'high' || conf === 'medium' ? conf : undefined,
    scale: typeof r.scale === 'string' && r.scale.trim() ? r.scale.trim() : undefined,
    // 补拍那一个字得留着 —— isMisdated 靠它认出"这是用户故意补记的"，
    // 顺手它还会被首页那道「日子不对」的提示条捞走。丢了就是丢一条合法记录。
    backfill: r.backfill === true,
  };
}

// 只留最近的 KEEP_DAYS 天。
// 基准取**账本里最新的一天**，不是"今天" —— 万一手机日期被改乱了，
// 也不至于把全部记录一次清空。
function prune(list: MealLogEntry[]): MealLogEntry[] {
  if (list.length <= 1) {
    return list;
  }
  let newest = list[0].date;
  for (const e of list) {
    if (e.date > newest) {
      newest = e.date;
    }
  }
  // ISO 日期（2026-09-26）按字符串比大小就等于按时间比，不需要转成 Date。
  const floor = shiftISO(newest, -(KEEP_DAYS - 1));
  return list.filter((e) => e.date >= floor);
}

// 读出全部记录。读不到、读坏了都返回空数组 ——
// 账本读不出来最多是数字显示 0，绝不能因此让首页打不开。
export async function readLog(): Promise<MealLogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeEntry).filter((e): e is MealLogEntry => e !== null);
  } catch {
    return [];
  }
}

// 按 id 找一条。首页点某一餐 → 要把那一笔的完整内容（照片、明细）摆出来，
// 走的就是它。找不到返回 null，调用方退回空白页，不报错。
export async function findEntry(id: string): Promise<MealLogEntry | null> {
  const all = await readLog();
  return all.find((e) => e.id === id) ?? null;
}

// 写一条：id 已存在就整体替换，否则追加。
// 用户改克数、加食物时反复调的就是它 —— 同一条记录一直用同一个 id，
// 所以首页上那一格的数字会跟着他改的数字走，而不是越记越多。
export async function saveEntry(entry: MealLogEntry): Promise<void> {
  try {
    const all = await readLog();
    const exists = all.some((e) => e.id === entry.id);
    const next = exists ? all.map((e) => (e.id === entry.id ? entry : e)) : [...all, entry];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prune(next)));
  } catch {
    // 存不下就算了 —— 这次分析的结果还在屏幕上，不该因为写账本失败就报错。
  }
}

// 删一条。
// ⚠️ date 是**必填**的：删只能删"这一天的这一笔"，不能只认 id 一把抓。
//    2026-10-02 的事故里，一条 id 同时出现在两天的账本上（就是那个"只认 id"
//    造成的），只认 id 去删会把另一天同一 id 的记录一起带走 —— 用户什么都没点，
//    另一天那一餐就凭空没了。传了日期就只删那一条，剩下的分毫不动。
export async function removeEntry(id: string, date: string): Promise<void> {
  try {
    const all = await readLog();
    const next = all.filter((e) => !(e.id === id && e.date === date));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 同上：删不掉不弹错，下次读到的还是旧数据，界面上看得见。
  }
}

// ============================================================
// ★ 存一条，并保证「同一天同一餐只剩这一条」（2026-09-26 晚新增）
// ============================================================
// 用户原话：「每一餐只能拍一张照片，如果要重拍，就去掉前面的，
// 就是说只能覆盖掉，不能留两张。拍的不满意可以拍第二张，但是第一张就去删除了。」
//
// 为什么不用 saveEntry 就完事：saveEntry 只按 id 去重，
// 重拍 = 新 id = 同一个早餐会留下两条、数字翻倍。
//
// 返回值是**被顶掉的那些旧记录**（没有就是空数组）。
// 用数组而不是单条：正常只会有 0 或 1 条，但万一哪份数据里同一天同一餐
// 存着两条，这里会一并收敛。
// ⚠️ 调用方**不需要**拿它去删照片 —— 2026-09-26 深夜起 App 不再删除
//    相册里的任何照片（那是用户想换回来时的"历史版本"）。保留这个返回值
//    是为了让这段逻辑可测（测试靠它验证"只顶掉同餐同日的、别的一动不动"），
//    账本这一层也只管记录、不碰相册（不然它就得依赖原生模块，测试也跑不了）。
export async function replaceSlotEntry(entry: MealLogEntry): Promise<MealLogEntry[]> {
  try {
    const all = await readLog();
    // 同一天、同一餐、但不是这一条的，全部让位。
    const stale = all.filter(
      (e) => e.date === entry.date && e.slot === entry.slot && e.id !== entry.id,
    );
    const keep = all.filter(
      (e) => !(e.date === entry.date && e.slot === entry.slot && e.id !== entry.id),
    );
    // ⚠️ 找旧记录必须「id + date」两个都对，不能只认 id —— 2026-10-02 这个坑
    //    就是只认 id 埋出来的真事故（用户原话）：
    //      「我在记录页点了一下早餐，看见照片，再退回去，10 月 1 号的早餐没了。
    //       我什么都没改啊。」
    //   餐盘页回看**历史**那一条时，entryIdRef 接过去的就是那条旧记录的 id；
    //   可写账那一步写的是 today()。于是送进来的是「别人的 id + 今天的日期」，
    //   只认 id 就找到了 10/1 那条，把它**原地改成了今天的** ——
    //   10/1 那一格当场空掉，那一顿被搬到了今天。
    //   只认 id 还会留下"同一个 id 挂在两天上"的怪账，以后一删就两头都没。
    //   带上 date 之后：同 id 但不同日 = 认不出，当作新的一条追加，
    //   原来那天那一条分毫不动（这是唯一的正确行为）。
    const idx = keep.findIndex((e) => e.id === entry.id && e.date === entry.date);
    if (idx >= 0) {
      keep[idx] = entry; // 同一天的同一条记录改克数 → 原地换掉
    } else {
      keep.push(entry);
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prune(keep)));
    return stale;
  } catch {
    // 存不下就算了 —— 这次分析的结果还在屏幕上，不该因为写账本失败就报错。
    return [];
  }
}

// ============================================================
// ★ 修改的时间窗口（2026-10-02，用户原话）
// ============================================================
// 「我觉得这个对于每一餐的修改，应该设定一个时间窗口。就是修改，只能修改
//   最后一餐。如果有了中餐之后，早餐就不能修改了；如果有了晚餐之后，
//   中餐就不能修改了。只能修改最后一餐的数据。这样就可以避免很多问题。」
//
// 落地成一句话：**谁都是末班车 —— 只有最新那一天、那一天里最晚的那一餐还能改**。
//   · 当天记了早 + 中（还没记晚餐）→ 只有**中餐**是活的，早餐摆出来只读；
//   · 当天记了早 + 中 + 晚 → 只有**晚餐**是活的，早餐、中餐都只读；
//   · 当天只记了早 → 早餐自己就是当天最晚的那一餐 → 能改；
//   · 今天记了东西，又去看 10-01 的早餐 → 那天已经过去了，只读；
//   · 昨天记了早中晚、今天一片空白 → 昨天那一日的晚餐还能改（它是账本里最新的一顿）。
//
// ⚠️ 2026-10-02 深夜纠正：我第一次写这段注释时把第二行写成了
//    「记了早 + 中 → 只有晚餐那一笔是活的」—— 那句话是错的，等于把"最新"
//    当成了"还没记的下一餐"。用户当场指出（原话）：
//      「记了早中是只有中餐能改。最后一餐能改。我讲的是最后一餐才能改。
//       所以记了早中、没记晚餐之前，只有中餐能改；记了早中晚，那只有晚餐能改。」
//    → "最后一餐" = **已经记下来的、时间上最靠后的那一顿**，不是"再下一顿"。
//    → 这条错了会让早/中餐在还有晚餐没记时被白锁住，照着错的注释改就会改坏，
//      所以把用户原话留在这儿，别只留一句干巴巴的规则。
//
// 为什么这么定（说清楚，免得以后被当成 bug 改掉）：
//   改旧的一定要回答"最新那笔怎么办"——
//     要么跟着变（用户以为只动了旧的一顿，首页数字却在跳，他原话就是怕这个），
//     要么把记录搬来搬去（2026-10-02「看了一眼历史早餐、退出来记录就没了」
//     那条事故就是这么来的）。
//   干脆不让改：只有最新那一餐是活的，其余的摆出来看。
//   → 首页三行的数字永远等于"最新那一顿改完的结果"，不再有两份互相打架的旧账。
//
// ⚠️ 判"晚"用**餐次**（早→中→晚）而不是写入时刻 at：
//    用户说的是"有了中餐之后早餐就不能改"，讲的是顺序；同一天同一餐重拍时
//    at 会变，slot 不会。拿 slot 比大小才贴他那句话。
export type EditWindowKind = 'otherDay' | 'olderSlot';

// 哪一餐算"晚"：早餐最早，晚餐最晚。
const SLOT_RANK: Record<MealSlot, number> = { breakfast: 0, lunch: 1, dinner: 2 };

export function slotRank(slot: MealSlot): number {
  return SLOT_RANK[slot] ?? 0;
}

// 账本里「最新那一天、那一天里最晚的那一餐」是哪一条。
// 账本里一条都没有时返回 null —— 那种情形什么都能改（本来也没东西可改）。
export function findLatestEntry(all: MealLogEntry[]): MealLogEntry | null {
  if (all.length === 0) {
    return null;
  }
  let newest = all[0].date;
  for (const e of all) {
    if (e.date > newest) {
      newest = e.date;
    }
  }
  let best: MealLogEntry | null = null;
  for (const e of all) {
    if (e.date < newest) {
      continue;
    }
    if (!best) {
      best = e;
      continue;
    }
    // 先比餐次（晚餐 > 中餐 > 早餐）；同一餐存着几条时（老数据的残留），
    // 谁后写的（at 大）谁算最新。
    if (
      slotRank(e.slot) > slotRank(best.slot) ||
      (slotRank(e.slot) === slotRank(best.slot) && e.at > best.at)
    ) {
      best = e;
    }
  }
  return best;
}

export type EditWindow = {
  ok: boolean; // 这一笔现在还能不能改
  kind: EditWindowKind | null; // 不能改，是因为"不是最新那天"还是"不是最晚那一餐"
  latest: MealLogEntry | null; // 挡路的那一条（最新那一餐），ok 时也可能顺带给你
  newestDate: string; // 账本最新那一天（"今天"以外的说法要用它）
};

// ============================================================
// ★ 补拍（2026-10-02，用户原话）
// ============================================================
// 「在历史记录的最后一餐的**后一餐**开始，应该可以补拍。
//   比如 9 月 30 号晚上是最后，那么 10 月 1 号的早餐现在应该可以补拍录入。」
//
// 落地成一句话：**新记的一顿，只能落在账本里最晚那一顿之后**（日子相同就比餐次）。
//   · 账本是空的 → 随便记，补不补拍都一样；
//   · 最后一顿是 9/30 晚餐 → 10/1 早餐、10/1 中餐、10/2 早餐……都能记（都在它后面）；
//   · 最后一顿是 10/2 晚餐 → 一样都补不了了（账本里没有比它更晚的餐）。
// ⚠️ 比它早的那一律不许记：那会在账本中间挖一个洞，
//    首页三行、连续记录天数全得跟着错，而"补拍"这回事本身也解释不通 ——
//    你不可能吃到一顿还没发生的东西。
// ⚠️ 「晚」按**餐次**（早→中→晚）比，绝不按写入时刻 at：
//    补拍是**现在**按快门、**记到过去**那一餐，at 一定比历史那些新；
//    拿 at 比的话，补进去的那一条反而成了"最新"，上面这条规矩当场失效。
export type BackfillCheck = {
  ok: boolean; // 这一格能不能记
  reason: 'ok' | 'gap' | 'future'; // 不能记是因为哪一条
  // 账本里最晚那一顿（挡路的那一个）。ok 时它也可能是 null（账本是空的）。
  from: MealLogEntry | null;
};

// 补拍这一格（date 那天、slot 那一餐）现在能不能记。
export function canAddEntry(all: MealLogEntry[], date: string, slot: MealSlot): BackfillCheck {
  const from = findLatestEntry(all);
  // 补到未来那一天 = 记一顿还没发生的饭，不干。
  if (date > today()) {
    return { ok: false, reason: 'future', from };
  }
  if (!from) {
    return { ok: true, reason: 'ok', from: null };
  }
  const later =
    date > from.date || (date === from.date && slotRank(slot) > slotRank(from.slot));
  return { ok: later, reason: later ? 'ok' : 'gap', from };
}

// 这一笔现在还能不能改。entry 就是屏幕上摆着的那一条。
export function editWindow(all: MealLogEntry[], entry: MealLogEntry): EditWindow {
  const latest = findLatestEntry(all);
  const newestDate = latest?.date ?? entry.date;
  if (!latest || latest.id === entry.id) {
    return { ok: true, kind: null, latest, newestDate };
  }
  const kind: EditWindowKind = entry.date < latest.date ? 'otherDay' : 'olderSlot';
  return { ok: false, kind, latest, newestDate };
}

// ============================================================
// ★ 把「被搬错日子」的记录放回原处（2026-10-02）
// ============================================================
// 用户原话：「你把我 10 月 1 号弄丢的早餐找回来，放回原处。」
//
// 那个 bug（餐盘页写账硬写 today()）留下来的**指纹**长这样：
//   照片是 10-01 早上拍的 → at（拍照那一刻）落在 10-01，这个字段谁也没动；
//   写进去的 date 却是 10-02。
//   → 「这一条记在 10-02，可它按拍照时刻算应该是 10-01」—— 一眼就能认出来，
//     而且**认得很牢**：数字、照片、明细全在，只是"日子"被人挪过。
// ⚠️ 反过来也成立，所以先挡一道：at 是 0 / 缺的老数据**不拿它当证据**。
//    干等 at=0 就判"日期不对"，会把整本账都"修"回 1970 年去 —— 那比 bug 本身还糟。
//
// 为什么判据用 at 而不是"看着不顺眼就改"：
//   at 是拍照那一刻的真时刻，任何时候都不会被那类 bug 改写；
//   date 才是被改写的那个。所以"两者对不上"就是这个 bug 独有的痕迹。
//   正常记的记录，两者永远落在同一天。
export function dateOfTimestamp(at: number): string {
  return toISODate(new Date(at));
}

// 这一条是不是被搬过日子（at 有效、且 at 那一天 ≠ 它记在的那一天）。
export function isMisdated(e: MealLogEntry): boolean {
  // 补拍的那几顿直接放行：它是**现在**拍的照片、账记在**过去**那一餐，
  // at 落在今天、date 落在更早那天，看着和"被搬错日子"一模一样 ——
  // 但它本来就该这样（用户原话见上面「补拍」那一节）。
  // 不认这一条的话，补进去的那顿会被首页那条「日子不对」的提示条捞走，
  // 用户一点「放回原处」，他补记的那顿就被挪回今天了。
  if (e.backfill) {
    return false;
  }
  if (!e.at || e.at <= 0) {
    return false; // 老数据没有拍照时刻，无从判断，一律不碰
  }
  return dateOfTimestamp(e.at) !== e.date;
}

// 账本里所有"日子被搬过"的条目。首页那道提示条用的就是它。
export function misdatedEntries(all: MealLogEntry[]): MealLogEntry[] {
  return all.filter(isMisdated);
}

export type RepairRecord = {
  id: string;
  from: string; // 现在记在（错的）哪一天
  to: string; // 照片真正拍的哪一天（放回去）
  slot: MealSlot;
};

export type RepairReport = {
  fixed: RepairRecord[];
  // 放回原处之后，同一天同一餐可能撞上另一条（那另一条是用户自己另记的）。
  // 撞上我不替他决定删谁 —— 只报出来，让他自己看一眼。
  clashes: { day: string; slot: MealSlot }[];
};

// 执行「放回原处」：把每一条被搬的记录,按它拍照那一刻归回那一天。
// ⚠️ 这里不走 replaceSlotEntry：那条函数按「id+date+slot」找旧记录才替换，
//    我们要改的正是 date，匹配不上会去**追加**一条，反而越修越多。
//    所以整本账读出来、只把这几条的 date 拧回去、整本写回。
export async function repairMisdated(): Promise<RepairReport> {
  const all = await readLog();
  const fixed: RepairRecord[] = [];
  const next = all.map((e) => {
    if (!isMisdated(e)) {
      return e;
    }
    const to = dateOfTimestamp(e.at);
    fixed.push({ id: e.id, from: e.date, to, slot: e.slot });
    return { ...e, date: to };
  });
  const seen = new Set<string>();
  const clashes: RepairReport['clashes'] = [];
  for (const e of next) {
    const key = `${e.date}|${e.slot}`;
    if (seen.has(key)) {
      clashes.push({ day: e.date, slot: e.slot });
    } else {
      seen.add(key);
    }
  }
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prune(next)));
  } catch {
    // 写不进去也不抛错：宁可下次打开再问一次，也不能让页面因为这个白屏。
    return { fixed, clashes };
  }
  return { fixed, clashes };
}

// ============================================================
// 汇总
// ============================================================

export type SlotSummary = {
  count: number; // 这一餐记了几条。2026-09-26 晚起**最多是 1**（一餐一条）
  carb: number; // 碳水合计，克
  calories: number; // 热量合计，千卡
  names: string[]; // 去重后的食物名，最多 6 个
  entries: MealLogEntry[]; // 原始条目，按写入时间排好序（正常只有一条）
};

export type DaySummary = {
  date: string;
  slots: Record<MealSlot, SlotSummary>;
  totalCarb: number;
  totalCalories: number;
  filledSlots: number; // 0~3：早中晚里有几餐已经记了东西
};

function emptySlot(): SlotSummary {
  return { count: 0, carb: 0, calories: 0, names: [], entries: [] };
}

// 把某一天的记录按早/中/晚加起来。
// date 传的是"要算哪一天"，不写死今天 —— 将来做"看昨天吃了什么"时不用改这里。
export function summarizeDay(all: MealLogEntry[], date: string): DaySummary {
  const slots: Record<MealSlot, SlotSummary> = {
    breakfast: emptySlot(),
    lunch: emptySlot(),
    dinner: emptySlot(),
  };

  for (const e of all) {
    if (e.date !== date) {
      continue;
    }
    const s = slots[e.slot];
    s.count += 1;
    s.carb += e.carb;
    s.calories += e.calories;
    s.entries.push(e);
    for (const n of e.names) {
      if (s.names.length < 6 && !s.names.includes(n)) {
        s.names.push(n);
      }
    }
  }

  let totalCarb = 0;
  let totalCalories = 0;
  let filledSlots = 0;
  for (const k of SLOT_KEYS) {
    const s = slots[k];
    s.carb = round1(s.carb);
    s.calories = round1(s.calories);
    // 同一次分析里如果有两条记录时间一样，按写入时间稳定排序，别让顺序每次打开都变
    s.entries.sort((a, b) => a.at - b.at);
    totalCarb += s.carb;
    totalCalories += s.calories;
    if (s.count > 0) {
      filledSlots += 1;
    }
  }

  return {
    date,
    slots,
    totalCarb: round1(totalCarb),
    totalCalories: round1(totalCalories),
    filledSlots,
  };
}

// 连续记录了多少天。
//
// 规则（这里有个刻意的让步，说清楚免得以后被当成 bug）：
//   今天已经记了 → 从今天往回数；
//   今天还**没**记 → 从昨天往回数。
// 为什么不对今天严：一天还没过完。早上七点打开 App 看见「连续 0 天」，
// 会让人以为昨天白记了 —— 那是错的。真正断没断，等今天过完再算。
export function streakDays(all: MealLogEntry[], fromISO: string): number {
  const days = new Set<string>();
  for (const e of all) {
    days.add(e.date);
  }
  let cursor = days.has(fromISO) ? fromISO : shiftISO(fromISO, -1);
  let n = 0;
  // 上限 10 年：万一日期数据坏了（比如一堆未来日期），也不会转成死循环。
  while (days.has(cursor) && n < 3650) {
    n += 1;
    cursor = shiftISO(cursor, -1);
  }
  return n;
}

// 造一条新记录的 id。
// ⚠️ 这里比任务那边多一个**自增序号**，是测出来的：
//    只用「时间戳 + 随机尾数」时，同一毫秒内连造 5000 个，唯一值只有 2831 个 ——
//    会撞车。撞了 id 就是两条记录互相覆盖，账目凭空少一笔，而且极难查。
//    加上计数器之后，同一个进程内绝不可能重复。
//    （真跑起来用户不会一秒造几千条，但 id 这种东西不该留"概率性出错"的口子。）
let idSeq = 0;

export function newEntryId(): string {
  idSeq += 1;
  return `m${Date.now().toString(36)}${idSeq.toString(36)}`;
}
