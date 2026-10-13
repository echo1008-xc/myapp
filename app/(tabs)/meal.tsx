import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
// 专门做手势的库。它的原生部分本来就打在你手机上的安装包里
// （libgesturehandler.so），所以换成它不需要重新打包，光靠自动推送就行。
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
// 首页点「早餐 / 中餐 / 晚餐」时，会把那一笔的 id 挂在地址后面跳过来，
// 这一页用它把当时那张照片和分析原样摆出来。
import { useLocalSearchParams } from 'expo-router';
import { analyzeMeal, estimateFood } from '../../lib/meal/api';
import type { FoodEstimate } from '../../lib/meal/api';
import { scaleNutrient } from '../../lib/meal/foodDb';
import type { FoodNutrient } from '../../lib/meal/foodDb';
// 升糖指数（GI）：按食物名查一个代表值，并把它分成五档。
// 纯本地查表，不联网、不花钱、瞬间出结果。
import { lookupGi } from '../../lib/meal/giDb';
import type { MealItem } from '../../lib/meal/types';
// 记账本：分析完点「早餐 / 中餐 / 晚餐」，就往这里写一条，首页那三行读的就是它。
// ⚠️ 用 `replaceSlotEntry` 而不是 `saveEntry`：用户 2026-09-26 晚定「每一餐只能
//    拍一张照片，要重拍就去掉前面的，只能覆盖、不能留两张」——
//    它会在存之前把同一天同一餐的旧条目摘掉。
//    ⚠️ 它会把被顶掉的那条返回回来，但**调用方故意不看** ——
//       相册里那张旧照片要原样留着（用户随时可能想导回来换掉现在这张）。
import {
  SLOTS,
  SLOT_KEYS,
  editWindow,
  normalizeEditFlag,
  newEntryId,
  readLog,
  removeEntry,
  replaceSlotEntry,
  slotLabel,
} from '../../lib/meal/log';
import type { EditFlag, EditWindowKind, LoggedItem, MealSlot } from '../../lib/meal/log';
// 把拍好的照片存进**手机相册**，而不是留在 App 自己的目录里。
// 具体怎么存的见 lib/meal/album.ts —— 它自己会处理"这个安装包里没有相册模块"
// 的情况（退回不存），所以这里放心调用，不用写一堆判断。
// ⚠️ 那个文件里**只有存、没有删**：App 永远不删除相册里的照片（见该文件顶部）。
import { savePhotoToAlbum } from '../../lib/meal/album';
// 时间那行字长什么样、画面摆多大 —— 纯计算，跟手机无关，单独放在一处好做测试。
import { fitBox, stampText } from '../../lib/meal/stamp';
import { getWatermarkMode, shouldStamp } from '../../lib/meal/photoSettings';
// 一屏「照片 + 右下角时间」。截下它，得到的就是存进相册的那张照片。
import { StampPhoto } from '../../components/StampPhoto';
import { formatDate, today } from '../../lib/date';
import { colors, radius, space } from '../../lib/theme';

// 图片选择器按需加载：
// 万一某个旧版安装包里还没内置这个原生模块，也只会提示「需要更新」，
// 不会让整个页面白屏。
type PickerModule = typeof import('expo-image-picker');
async function loadPicker(): Promise<PickerModule | null> {
  try {
    return await import('expo-image-picker');
  } catch {
    return null;
  }
}

// 屏幕方向控制也按需加载，理由同上。
// 老安装包里没有这个原生模块，静态 import 会让空投过去的代码直接崩；
// 动态导入失败就返回 null，退化成「不能转横屏」，但看大图照样能用。
type OrientationModule = typeof import('expo-screen-orientation');
async function loadOrientation(): Promise<OrientationModule | null> {
  try {
    return await import('expo-screen-orientation');
  } catch {
    return null;
  }
}

type Stage = 'idle' | 'ready' | 'analyzing' | 'done';

// 今天某一餐**已经记下的那一顿**长什么样。
// 只在「动手前问一句」时用（见 chooseSlot 上面那段），界面上不单独显示。
// calories 是这一餐的合计（千卡）；names 是吃了哪几样，最多 3 个，
// 摆进确认框那行字里 —— 让用户看清要顶掉的是哪一顿，不是"有个数字、不知道是谁"。
type TakenInfo = {
  calories: number;
  names: string[];
};

// ★「这一笔还在能改的时间窗口里吗」（2026-10-02，规矩见 lib/meal/log.ts）。
//   null = 屏幕上这一笔就是**最新那一天、最晚的那一餐**，改得。
//   非 null = 它已经过了窗口，只能摆出来看：
//     · kind 'otherDay'    → 它是别的一天的事（今天已经记过别的了）
//     · kind 'olderSlot'   → 同一天里，更晚的那一餐已经记了
//   entryId 是"被锁的是哪一条"；latestSlot / latestDate 是**挡路的那一条**，
//   提示那一句话全靠它说人话（"想改早餐，先把晚餐撤掉"里的"晚餐"）。
type EditLock = {
  entryId: string;
  kind: EditWindowKind;
  latestSlot: MealSlot | null;
  latestDate: string;
};

// 正在"摆好、等着被截下来"的那一屏（见下面 stampJob 的注释）。
type StampJob = {
  uri: string; // 要拍进去的那张照片
  boxW: number; // 在屏幕上摆多大。它同时也决定了右下角时间那行字多大
  boxH: number;
  text: string; // 右下角那行时间，例如「2026-09-26 21:19:07」（精确到秒，见 lib/meal/stamp.ts）
  // 这一次"存相册"的收尾：把结果（相册里那张图的路径，或 null）交给正在等它的那段代码。
  // ⚠️ 收尾函数跟着 job 走，**不要**改回"用一个全局 ref 存当前的收尾函数"：
  //    用户手快连拍两张时，第二张会把第一张的收尾函数顶掉；第一张的截图回来时
  //    如果去读那个全局 ref，就会把**第一张的路径**交给**第二张**的等待者 ——
  //    屏幕上显示的照片和账本里记的对不上，而且极难查出来。
  settle: (savedUri: string | null) => void;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

// 把数值夹在最小值和最大值之间（缩放倍数、拖动距离都要用它兜底）
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ---------- 一行食物 ----------
// 界面上的每一项都用这个结构，不管是 AI 认出来的还是用户自己加的。
// 用唯一的 id 而不是「第几项」来定位 —— 因为用户可以插一条、删一条，
// 位置会变，用序号会错位。

// 判断某一项到底有没有被改过。渲染时用它决定「这块要不要变色」。
// ★ 这里就是「改哪一项、哪一项变」的落点（2026-09-30 定、2026-10-01 修对）：
//   改名称只有名称这块变淡黄，改克数只有克数那块变淡黄，都改才都变。
//   ⚠️ 别把这两个函数合成一个 —— 合成一个（比如 `r.edited !== 'none'`）
//      就等于"改了名称 → 两块都变"，正是用户 10-01 报的那个坑：
//      「我没有改克数，只改了名称，但是两项都变了颜色。」
//   四态本身定义在 lib/meal/log.ts，和账本里存的是同一套词。
const editedName = (f: EditFlag) => f === 'name' || f === 'both';
const editedGrams = (f: EditFlag) => f === 'grams' || f === 'both';

type Row = {
  id: string;
  name: string;
  grams: number;
  portion: string;
  calories: number;
  carb: number;
  note?: string;
  source: 'ai' | 'user'; // 谁加的：AI 认出来的 / 用户自己补的
  edited: EditFlag; // 用户改过哪一项（名称 / 克数 / 都改 / 没改）
  // 每 100 克的营养。用户改克数时直接按它换算，不用重新联网算。
  // 拿不到（AI 没给克数）时是 null，界面退化成显示文字份量。
  per100: FoodNutrient | null;
  // 这一项的营养是怎么来的（用户添加时才给），显示成一句小字
  basis?: string;
  // 原始估算值快照，用于「恢复原值」。用户自己加的没有原值，所以是 null。
  orig: { name: string; grams: number; calories: number; carb: number; portion: string; note?: string; per100: FoodNutrient | null } | null;
};

let seq = 0;
const newId = () => `r${Date.now().toString(36)}-${(seq++).toString(36)}`;

// 把云端返回的一项转成界面上的行。
function toRow(it: MealItem): Row {
  const per100: FoodNutrient | null =
    it.grams > 0
      ? {
          calories: round1((it.calories / it.grams) * 100),
          carb: round1((it.carb / it.grams) * 100),
        }
      : null;
  return {
    id: newId(),
    name: it.name,
    grams: it.grams,
    portion: it.portion,
    calories: it.calories,
    carb: it.carb,
    note: it.note,
    source: 'ai',
    edited: 'none',
    per100,
    orig: {
      name: it.name,
      grams: it.grams,
      calories: it.calories,
      carb: it.carb,
      portion: it.portion,
      note: it.note,
      per100,
    },
  };
}

// 把账本里存的一项，还原成界面上的一行。
// 「从首页点进来回看」走的就是它 —— 存进去是什么样，读回来就是什么样。
function fromLoggedItem(it: LoggedItem): Row {
  // 有每 100 克的基准就带上：这样回看时用户如果还想改克数，能当场换算，不用联网。
  const per100: FoodNutrient | null =
    it.per100Calories && it.per100Calories > 0
      ? { calories: it.per100Calories, carb: it.per100Carb ?? 0 }
      : null;
  return {
    id: newId(),
    name: it.name,
    grams: it.grams,
    portion: it.portion,
    calories: it.calories,
    carb: it.carb,
    note: it.note,
    source: it.source,
    // 账本里存的是四态（'none' / 'name' / 'grams' / 'both'），直接认。
    // ⚠️ 唯一会降级的是**老记录**：那时它存的是 boolean，读回来分不清改的是
    //    名称还是克数，只能整体当 'both' —— 老记录会两项都显示成「被改过」。
    //    这是旧数据里没有那份信息，对旧数据诚实，不假装能分辨。
    edited: normalizeEditFlag(it.edited),
    per100,
    // ⚠️ 回看历史时**不给**「恢复原值」：那是"当场改错了想退回去"才有的操作，
    //    而账本里没有存"当时 AI 原本估的是多少"。给一个按不动的按钮比不给更糟。
    orig: null,
  };
}

// 把「估算结果」转成一句话，告诉用户这个数字是怎么来的。
function basisText(est: FoodEstimate): string {
  if (est.from === 'db') return `按常见食物表里「${est.matched}」的数值算`;
  if (est.from === 'ai') return '按 AI 估算的数值算';
  if (est.legacyCloud) return '云端函数还是旧版，暂时按同类平均值估';
  return '没查到这种食物，按同类平均值估的';
}

// 新增那一项的编辑态用一个特殊 id。
const NEW_ID = '__new__';

export default function MealScreen() {
  const [stage, setStage] = useState<Stage>('idle');
  const [imageUri, setImageUri] = useState<string | null>(null);
  // 这张照片是横的还是竖的。横图给横框、竖图给竖框，
  // 照片完整缩进去（contain），放不满的地方就留白 —— 绝不裁掉任何一边。
  const [photoLandscape, setPhotoLandscape] = useState(true);

  // 点照片看大图：这个全屏弹层开着没。
  const [viewerOpen, setViewerOpen] = useState(false);
  // 屏幕尺寸。手机转横屏时这个值会自己更新，照片跟着重新铺满 ——
  // 所以照片尺寸必须用它算，不能写死 100%（写死的话转屏后不会重算）。
  const { width: winW, height: winH } = useWindowDimensions();
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState('image/jpeg');
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState('');
  const [confidence, setConfidence] = useState<'low' | 'medium' | 'high'>('medium');
  // 这次分析用到了哪些参照物（云端 v8 的 scale 字段，例如「筷子24cm + 鸡蛋」）。
  // 空字符串 = 没找到尺子，界面上就不显示这一行。
  const [scale, setScale] = useState('');
  const [errMsg, setErrMsg] = useState('');
  // 云端函数没更新到新版（还在返回「糖/油」）时置位，界面要如实提醒
  const [staleCloud, setStaleCloud] = useState(false);
  // 旧版云端下，有几项碳水是用本地食物表补出来的（补算逻辑在 lib/meal/api.ts）
  const [legacyFilled, setLegacyFilled] = useState(0);

  // 编辑态（改名 + 改克数 / 新增一项，共用同一套输入框）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftGrams, setDraftGrams] = useState('');
  const [editErr, setEditErr] = useState('');
  const [busy, setBusy] = useState(false); // 正在算（查本地表是瞬间，问云端要等一两秒）

  // ---------- 记到哪一餐（2026-09-26 新增）----------
  // null = 还没选。选了之后首页「早餐 / 中餐 / 晚餐」那一行就有数了。
  const [slot, setSlot] = useState<MealSlot | null>(null);
  // 今天账本里已经有记录的餐次（2026-09-29 定：「后面的不能抵消前面的」——
  // 从底部「餐前拍」新拍的这张，不能再记进今天已经拍过的那一餐，
  // 不然一按下去就把别人那顿的记录顶掉了。想替换某一餐，走首页那一行
  // 进去回看重拍，那条路是替这一餐自己换照片，不受此限）。
  const [takenSlots, setTakenSlots] = useState<MealSlot[]>([]);
  // ② 那些已记的餐**各自是什么**（热量、吃了哪几样），只在「动手前问一句」时用得到。
  //    2026-10-01 定的规矩：点一个已经有记录的餐次，先问「要顶掉的是哪一顿、多少千卡」，
  //    不然"确认"两个字是空的 —— 用户根本不知道自己要毁掉什么。
  //    ⚠️ 它和 takenSlots 一起刷新（见 refreshTaken），不是一个异步时序。
  const [takenInfo, setTakenInfo] = useState<Partial<Record<MealSlot, TakenInfo>>>({});
  // 台面上这张照片是不是「全新的一拍」：
  //   按快门拍的（且不是回看流程里的重拍）→ true；从相册导入 → false。
  // 只有全新的一拍才受「拍过的餐不能再选」限制 —— 从相册导入是「换回旧图」
  // 的正路（本来就要点已拍的那一餐把记录顶回来），不能堵。
  const [freshShot, setFreshShot] = useState(false);
  // 这一张照片写进账本时用的 id。
  // 关键在「同一张照片**始终用同一个 id**」：用户接着改克数、加食物，都是去
  // **替换**那一条，首页上的数字跟着变 —— 而不是每改一次就多记一笔、越滚越大。
  // 放在 ref 里而不是 state：它变了不需要重画界面。
  const entryIdRef = useRef<string | null>(null);
  // 这一笔**最早**写入的时间。改克数时不能把它冲掉 ——
  // 首页把同一餐的几笔按这个时间排序，改一下数就跑到最后去会让人莫名其妙。
  const entryAtRef = useRef<number | null>(null);
  // 这一笔**属于哪一天**（"2026-10-01"）。
  // ★ 2026-10-02 修的那个事故全靠它：写账那一步原来看什么日期都写 today()，
  //   于是打开 10/1 的一顿看一眼、什么都不动地退出来，就把 10/1 那条记到了今天头上，
  //   「10 月 1 号的早餐」当场没了（用户原话：「我只不过看了那个早餐，点了个回退就改变了」）。
  //   现在这一笔是历史里那一条时就记下它的日期，写账照那个日期写；
  //   只有全新的一拍（新 id）才写今天 —— 见下面那段写账的 effect。
  const entryDateRef = useRef<string | null>(null);
  // 这一趟是不是「补拍」：照片是**现在**拍的、账要记到**过去**那一餐去。
  //   true  = 从 /day 页点「补拍这一餐」进来的（带了 d 参数，且那天不是今天）；
  //   false = 平常那一趟（首页点「还没拍」、或底部「餐前拍」自己选餐次）。
  // 它只管两件事：① 换照片时**别**把 entryDateRef 清成今天（补的那一天要留着）；
  //              ② 写账时给这一条盖个 backfill 记号（见 lib/meal/log.ts）。
  const backfillRef = useRef(false);
  // 补拍的**目标日期**（在 refreshTaken 里要用：目标那一餐要是已经有记录了，
  // 覆盖前得先问一句，只看今天会漏）。放在 ref 里，免得进 effect 就触发重算。
  const backfillDateRef = useRef<string | null>(null);

  // 重算「今天哪几餐已经有记录了」。账本只被这一页写，所以在每个
  // 可能的变化点刷一遍就够：进页面、写账、撤账、删账、拿到新照片。
  const refreshTaken = useCallback(() => {
    void (async () => {
      const all = await readLog();
      const d = today();
      // 补拍那天也得看一眼：这一格要是已经有记录了，下面选餐次要先问一句
      // （见 chooseSlot 上面那层 guard）。只看今天会把补拍那格漏掉。
      const dates = backfillDateRef.current && backfillDateRef.current !== d
        ? [d, backfillDateRef.current]
        : [d];
      const mine = all.filter((e) => dates.includes(e.date));
      const keys = SLOT_KEYS.filter((k) => mine.some((e) => e.slot === k));
      setTakenSlots(keys);
      // 顺手把每一餐那一条的内容记下来（同餐可能存着旧数据的两条，加起来）。
      // 名字只留 3 个：确认框里那行字挤不下更多，而前三个就是用户认得出的那几样。
      const info: Partial<Record<MealSlot, TakenInfo>> = {};
      for (const k of keys) {
        const es = mine.filter((e) => e.slot === k);
        const names: string[] = [];
        for (const e of es) {
          for (const n of e.names) {
            if (names.length < 3 && !names.includes(n)) {
              names.push(n);
            }
          }
        }
        info[k] = {
          calories: Math.round(es.reduce((a, e) => a + e.calories, 0)),
          names,
        };
      }
      setTakenInfo(info);
    })();
  }, []);
  useEffect(() => {
    refreshTaken();
  }, [refreshTaken]);

  // ---------- 照片在相册里放哪儿（2026-09-26 深夜简化）----------
  // 以前这里有两个 ref（照片在相册的编号 / 有没有挂到账本上），
  // 用来在重拍时把上一张**从相册里删掉**。现在这规矩取消了 ——
  // 用户定：「每一餐只能拍一张照片，重拍可以把记录顶掉，但是头一次存在
  // 相册里的照片不要删，因为后期还想从相册导入换回前面一张。」
  // → App 不再删相册里的任何照片，这两个 ref 也就没有存在的理由了。
  // → 账本顶掉旧记录、相册留旧照片 = 相册就是这一餐拍过的版本历史。

  // 照片加载不出来了。
  // 账本里存的是照片的**位置**（拍照时系统给的临时路径），平时都在，
  // 但手机空间特别紧张时系统可能把它清掉。真遇到就如实说一句，
  // 分析明细照常显示 —— 总比让人对着一块空白猜"是不是我记错餐了"强。
  const [photoGone, setPhotoGone] = useState(false);

  // 当前这一屏是"从首页点进来回看的历史记录"，还是"刚拍的新照片"。
  // 用来决定要不要显示「从首页移除这一笔」—— 刚拍完的分析没有"移除"这回事
  // （它就是新记的一笔），只有回看历史时才需要这个出口。
  const [fromLog, setFromLog] = useState(false);

  // 屏幕上的这一笔还在不在「能改」的时间窗口里（2026-10-02）。
  // null = 能改（新拍的一笔、或它本身就是最新那一餐）。
  const [lock, setLock] = useState<EditLock | null>(null);

  // ---------- 把照片存进相册（2026-09-26 新增）----------
  // 为什么要在屏幕上先摆一屏「照片 + 右下角时间」再把它截下来：
  // 手机相册里收的必须是**一张真实的图片文件**，而"往照片上写一行时间"
  // 这件事安卓的系统接口不提供。所以换个思路 —— 把两样东西摆成一屏、
  // 整屏拍下来存进去。时间是"烧"进图里的，之后用别的看图软件打开也带着。
  //
  // 这一屏只在存的那一秒露个脸，存完立刻撤，用户不用管它。
  const [stampJob, setStampJob] = useState<StampJob | null>(null);
  const stampRef = useRef<View | null>(null);
  // 「当前正在处理的这一次存相册」是哪一次。
  // 作用有两个：① 截图完成时只撤掉**自己**那一屏（用户已经又拍了一张时不能撤人家那份）；
  //            ② 八秒兜底到点时，只在"还没被处理过"的情况下才放行。
  const stampJobRef = useRef<StampJob | null>(null);
  // 快门计数。每按一次拍照 +1。
  // 用途：旧的存相册流程晚回来时，如果它已经不是最新那一次，结果**直接丢掉** ——
  //      否则它会把界面上刚显示的新照片悄悄换回旧那张。见 saveToAlbumWithStamp。
  const albumSeqRef = useRef(0);

  const isAdding = editingId === NEW_ID;

  // 合计：直接把当前各项加起来。
  // 不从云端的总数里拿 —— 用户改过或加过之后，总数必须跟着变，自己加最可靠。
  const totals = useMemo(() => {
    let c = 0;
    let k = 0;
    for (const r of rows) {
      c += r.calories;
      k += r.carb;
    }
    return { calories: round1(c), carb: round1(k) };
  }, [rows]);

  // 顶部那句提示：只要有一项被改过（或整条是用户手加的）就出现。
  // 这里用的是「改过任意一项」的宽口径，不管改的是名称还是克数 —— 目的只是提醒
  // 「下面这些数据已经不是 AI 原样了」，具体到哪一项由下面的染色来区分。
  const touched = rows.some((r) => r.edited !== 'none' || r.source === 'user');

  // 食物名拼成一个字符串，只用来当"名字变没变"的判断依据（见下面的注释）。
  const namesKey = rows.map((r) => r.name).join('|');

  // 把当前结果写进账本 —— 首页「早餐 / 中餐 / 晚餐」那三行读的就是它。
  // ⚠️ 依赖里放的是几个**具体数字和名字串**，不是 rows 这个数组本身。
  //    数组每次渲染都是新的，写进依赖会变成"每渲染一次就写一次盘"。
  // 效果：用户选完餐次之后再改克数、加食物、删食物，账本里那一条**跟着变**，
  //      首页上的数字永远等于他在这一页看到的合计。
  //
  // ★ 用 replaceSlotEntry（不是 saveEntry）：**同一天同一餐只留这一条**。
  //   用户 2026-09-26 晚定：「每一餐只能拍一张照片，要重拍就去掉前面的。」
  //   ⚠️ 它会把被顶掉的旧记录返回回来，但这里**故意不看那个返回值** ——
  //      相册里那张旧照片要原样留着（用户随时可能想导回来换掉现在这张）。
  useEffect(() => {
    if (stage !== 'done' || !slot || lock) {
      // ★ lock 那一条（2026-10-02）：过了时间窗口的那一笔**不许写盘**。
      //   界面上它的编辑入口已经全锁了，这里再挡一道 —— 写账这一步是"这一笔
      //   会往账本里写"的唯一出口，堵住它，旧记录就再不会被悄悄改掉。
      return;
    }
    if (!entryIdRef.current) {
      entryIdRef.current = newEntryId();
    }
    if (entryAtRef.current === null) {
      entryAtRef.current = Date.now();
    }
    // 整份都存：首页点回来时要看到**当时那张照片和底下的分析**，
    // 只留一个"碳水 42 克"是回不去的。
    const itemList: LoggedItem[] = rows.map((r) => ({
      name: r.name,
      grams: r.grams,
      portion: r.portion,
      calories: r.calories,
      carb: r.carb,
      note: r.note,
      source: r.source,
      // 存四态（'none' / 'name' / 'grams' / 'both'），不存布尔了 ——
      // 存布尔（'none' / 其他）的话，从首页回看这条记录时读回来就分不清
      // 改的是名称还是克数，只能整体当 'both'：用户只改了名称，
      // 回看时克数那块却亮着（10-01 报的就是这个）。
      edited: r.edited,
      per100Calories: r.per100?.calories,
      per100Carb: r.per100?.carb,
    }));
    // 存。被顶掉的那条记录返回回来是给测试看的，这里**不看** ——
    // 它用的那张照片要留在相册里，等用户哪天想换回前面一张时导回来。
    void replaceSlotEntry({
      id: entryIdRef.current as string,
      // ★ 写这一笔**归到哪一天**：回看历史那一顿，日期就跟那一顿走；
      //   只有新拍的一笔（entryDateRef 是 null）才写今天。
      //   ⚠️ 这里绝不能图省事写 today() —— 那会把历史那一条记到今天头上，
      //   那天那一格就空了（2026-10-02 的事故，见过一次）。
      date: entryDateRef.current ?? today(),
      slot,
      calories: totals.calories,
      carb: totals.carb,
      names: rows.map((r) => r.name).slice(0, 6),
      at: entryAtRef.current as number,
      imageUri: imageUri ?? undefined,
      items: itemList.length > 0 ? itemList : undefined,
      summary: summary || undefined,
      confidence,
      scale: scale || undefined,
      // 补拍的记号（见 lib/meal/log.ts 里那一节）：它会让首页那条
      // 「日子不对、放回原处」的提示条认出这是**用户故意补记的**，
      // 别把补进去的那顿又挪回今天。
      backfill: backfillRef.current || undefined,
    });
    // 账本变了，「哪几餐已拍过」跟着变 —— 不然刚记完的那餐还显示能选。
    refreshTaken();
    // totals.calories / totals.carb 是从 rows 现算出来的，变没变用它俩看就够。
    // 后面几个（照片、总评、可信度、参照物）也一起存，不然回看时会缺一块。
  }, [
    stage,
    slot,
    totals.calories,
    totals.carb,
    namesKey,
    imageUri,
    summary,
    confidence,
    scale,
    lock,
  ]);

  // ---------- 从首页点进来：把那一笔原样摆出来 ----------
  // 用户在首页点「早餐」，期待看到**当时那张照片和底下的分析**，而不是空白页。
  // 首页跳过来时会带两个参数（见 app/(tabs)/index.tsx）：
  //   entry = 那一笔的 id
  //   t     = 点下去的那一刻（时间戳）
  // ⚠️ 为什么要多一个 t：如果只带 entry，用户"点进去 → 拍了张新的 → 再回首页点同一餐"时，
  //    地址里的 entry 没变，React 就认为参数没变化、不会重新还原 —— 他会看到刚拍的新照片，
  //    而不是他点的那一笔。带上时刻，每次点都算一次"新请求"。
  const params = useLocalSearchParams<{
    entry?: string;
    t?: string;
    preset?: string;
    pt?: string;
    // d = **补拍到哪一天**（"2026-10-01"）。带了它就是补记，照片归那一天那一餐；
    // 没带就是平常那一趟（归今天）。见下面「补拍」那一节。
    d?: string;
  }>();
  const wantEntry = typeof params.entry === 'string' ? params.entry : '';
  const wantStamp = typeof params.t === 'string' ? params.t : '';

  // 同一次点击只还原一次（这个 effect 会因为参数变化重跑，
  // 每跑一次都 setRows 的话，用户正在改的内容会被冲掉）。
  const restoredRef = useRef('');

  useEffect(() => {
    const token = wantEntry ? `${wantEntry}#${wantStamp}` : '';
    if (!token || restoredRef.current === token) {
      return;
    }
    restoredRef.current = token;
    void (async () => {
      // 一次把账本整个读出来：既要这一条的内容，也要它的"邻居"
      // —— 时间窗口（能不能改）得拿**全部**记录算，只看一条算不出来。
      const all = await readLog();
      const e = all.find((x) => x.id === wantEntry) ?? null;
      if (!e) {
        // 记录可能已经被删掉了（在首页删的，或者账本被清过）。
        setErrMsg('这条记录已经不在了。');
        return;
      }
      // 把「当前这一笔」接上：之后用户要是又改了克数，改的是**这一条历史记录**，
      // 而不是新建一笔。
      entryIdRef.current = e.id;
      entryAtRef.current = e.at;
      // 这条本来就是补拍记进去的，接着改它（改克数、加食物）也算补拍 ——
      // 记号得跟着走，不然改一次刚才的记号就没了，首页那条提示条又会来烦人。
      backfillRef.current = e.backfill === true;
      // 连同日期一起接上（2026-10-02）：摆出来的是**哪一天**那一顿，
      // 之后改克数、加食物都照那一天写回去，不是硬塞进今天。
      entryDateRef.current = e.date;
      // ★ 顺手判一下"这一笔还能不能改"（2026-10-02 用户原话：
      //   「有了中餐之后，早餐就不能修改了……只能修改最后一餐的数据」）。
      //   只有最新那一天、最晚那一餐是活的；其余的锁成只读。
      //   ⚠️ 必须和 setStage('done') 一起生效（下面这几个 setState 是批量的）：
      //      写账那一步看见 lock 就直接不写盘 —— 这是"看一眼历史、退出来记录就没了"
      //      那条事故的最终保险。
      const win = editWindow(all, e);
      setLock(
        win.ok
          ? null
          : {
              entryId: e.id,
              kind: win.kind ?? 'otherDay',
              latestSlot: win.latest?.slot ?? null,
              latestDate: win.newestDate,
            },
      );
      setSlot(e.slot);
      const uri = e.imageUri ?? null;
      setImageUri(uri);
      setPhotoGone(false);
      // 照片是横是竖，决定上面用横框还是竖框。
      // 拍照那会儿是系统直接给了宽高；回看时没有这些数字，就直接问这张图本身要。
      // 拿不到（照片已经不在了）就沿用上一次的判断 —— 反正那种情况会显示
      // 「这张照片已经不在手机里了」，框子长什么样已经不重要了。
      if (uri) {
        try {
          Image.getSize(
            uri,
            (w, h) => {
              if (w > 0 && h > 0) {
                setPhotoLandscape(w >= h);
              }
            },
            () => undefined,
          );
        } catch {
          // 问不到尺寸不影响任何别的事，不报错
        }
      }
      // 照片的原始数据（base64）当时没有存 —— 存它一张就好几 MB，值不得。
      // 所以回看时不能再"重新分析"，按钮会显示「已分析完成」，这是有意的。
      setImageBase64(null);
      setRows((e.items ?? []).map(fromLoggedItem));
      setSummary(e.summary ?? '');
      setConfidence(e.confidence ?? 'medium');
      setScale(e.scale ?? '');
      setErrMsg('');
      setStaleCloud(false);
      setLegacyFilled(0);
      setEditingId(null);
      setFromLog(true);
      setStage('done');
    })();
  }, [wantEntry, wantStamp]);

  // ---------- 从首页「还没拍」进来：直接给那一餐拍 ----------
  // 用户点「早餐」后面的「还没拍」（2026-09-29 定）= 这次要拍的就是早餐：
  // 进来先把餐次钉死，拍完、分析完自动写进账本 —— **不用再选早/中/晚**。
  // 只有从底部「餐前拍」标签进来的（没有 preset 参数）才保持老规矩：拍完再选。
  // pt 同上面 t 的道理：每次点都算一次新请求，不然连点两回不生效。
  const wantPreset = typeof params.preset === 'string' ? params.preset : '';
  const presetStamp = typeof params.pt === 'string' ? params.pt : '';
  // 补拍到哪一天。空串 = 这一趟不补拍（平常记今天）。
  // ★ 它和上面的 preset 是**一起**来的：从「那天详情」页点「补拍这一餐」时，
  //   地址里同时带 d（哪一天）和 preset（哪一餐），拍完直接归那一格。
  const wantDate = typeof params.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.d)
    ? params.d
    : '';
  const presetRef = useRef('');
  // 预选的餐次先记在这，**按下快门那一刻**才钉到 slot 上 ——
  // 不能进门就钉：拍照换照片时会清一次餐次（见 pick 里那段），
  // 钉早了就被冲掉，「拍完自动归这一餐」就落空了。
  const presetSlotRef = useRef<MealSlot | ''>('');
  useEffect(() => {
    const token = wantPreset ? `${wantPreset}#${presetStamp}` : '';
    if (!token || presetRef.current === token) {
      return;
    }
    if (wantPreset !== 'breakfast' && wantPreset !== 'lunch' && wantPreset !== 'dinner') {
      return;
    }
    presetRef.current = token;
    presetSlotRef.current = wantPreset;
    setSlot(null);
    // 台面上还摆着上一张的话清掉 —— 这次是来给这一餐拍**新**照片的，
    // 不是接着上一张改。上一张在它落账时就存进账本了，不会丢。
    entryIdRef.current = null;
    entryAtRef.current = null;
    // 日期**不**跟着清（和上面那两个不一样）：从 /day 页点「补拍这一餐」进来时
    // 带了 d = 那一天（比如 10-02 才想起来补 10-01 的早餐），这一趟拍的照片
    // 就要记到**那一天**去。没带 d 就是平常那一趟，日期仍是 null → 写账归今天。
    entryDateRef.current = wantDate;
    backfillRef.current = !!wantDate && wantDate !== today();
    backfillDateRef.current = entryDateRef.current;
    // 新的一拍 = 可以改的一笔（它落账之后就是最新那一天、最晚的那一餐）。
    setLock(null);
    setStage('idle');
    setImageUri(null);
    setImageBase64(null);
    setRows([]);
    setSummary('');
    setScale('');
    setErrMsg('');
    setEditingId(null);
    setFromLog(false);
    setFreshShot(false);
  }, [wantPreset, presetStamp]);

  // 从「还没拍」进来过、这回又从底部标签进来（preset 参数空了）：
  // 把没消费掉的预选撤掉，不然这次拍的照片会被默默归到上一次点的那一餐。
  // 预选从没直接碰过 slot（快门按下时才钉、钉完即消费），所以这里
  // 只清预选本身；slot 只在台面还空着时顺手归位。
  const prevPresetRef = useRef('');
  useEffect(() => {
    if (prevPresetRef.current && !wantPreset) {
      presetSlotRef.current = '';
      if (stage === 'idle') {
        setSlot(null);
      }
    }
    prevPresetRef.current = wantPreset;
  }, [wantPreset, stage]);

  // ---------- 点「早餐 / 中餐 / 晚餐」之前的那句"问一句" ----------
  // 2026-10-01 定的规矩，用户原话：「拍了晚餐，去点中餐、点早餐已经有的，
  // 一定要经过确认才能覆盖或者取消。**不能随便点了一下之前的记录，我就没有了**。」
  //
  // ⚠️ 以前这三个动作都是**点一下就动手**，记录当场没。三件事都会动到已经记好的东西：
  //   · 'replace' 要记进去的那一餐今天已经有别的一顿 → 换下去会把它顶掉（它就没了）。
  //   · 'move'    这一笔已经记在某餐，改记到别餐 → 等于把这一条搬走，原来那格会空。
  //   · 'cancel'  再点一次正在选中的那一餐 = 撤掉这一顿 → 首页那格变回"还没拍"。
  // 「随便点一下就没了」的正是后两条：用户原话讲的就是「不小心点了一下中餐和早餐、
  // 再点回晚餐，早餐和中餐也没有了」—— 同一条记录被来回搬，两头都空。
  //
  // 顺带说明：它**不是**下面那个"已拍过的餐灰掉"栏的替代品，两个管得不一样 ——
  //   灰掉的按钮（blocked）：新拍的一张，不许记进今天已拍过的餐，压根点不动；
  //   这里这一层：不管什么来路（回看、相册导回来、重新选餐次），
  //   只要会动到已经记好的记录，就拦下来问一句。
  // 在台面还空着、目标餐也空着时（最常见的正常用法：拍完直接选一餐）不弹框，
  // 保持"点一下就记上"的顺手 —— 只有真会弄丢东西时才插一句话。
  type GuardKind = 'replace' | 'move' | 'cancel';
  const [guard, setGuard] = useState<{ slot: MealSlot; kind: GuardKind } | null>(null);

  // 确认框上那两句话和两个按钮，按情形现算。
  const guardText = useMemo(() => {
    if (!guard) {
      return null;
    }
    const next = slotLabel(guard.slot);
    // 这一笔归的是哪一天：回看历史那一顿时是那天，新拍的一笔是今天。
    // 只在"不是今天"的时候才把日期说出来 —— 否则下面那句"首页那格"就
    // 张冠李戴：用户是在看 10/1，撤掉说的是 10/1 的那一格。
    const dayLabel = (entryDateRef.current && entryDateRef.current !== today() ? formatDate(entryDateRef.current) : '') || '';
    // 撤销：把这一笔从账本里拿掉（照片还留在相册里，想再记回来就把它选回来）。
    if (guard.kind === 'cancel') {
      return {
        title: `撤掉${next}这一顿？`,
        body: dayLabel ? `${dayLabel}那天的${next}就空出来了。` : `首页${next}那格会变回"还没拍"。`,
        keep: '留着这一顿',
        go: '撤掉',
      };
    }
    // 补拍那一天：话里要是还说"今天"就张冠李戴了 —— 用户此刻看的是 10/1，
    // 不是今天。只有落点真不在今天时才把日子说出来。
    const dayOfThis = dayLabel || (backfillRef.current && entryDateRef.current && entryDateRef.current !== today()
      ? formatDate(entryDateRef.current)
      : '');
    // 覆盖：要记进去的那一餐（今天／那一天）已经有别的一顿了。
    const old = takenInfo[guard.slot];
    if (guard.kind === 'replace') {
      // 热量和吃的东西放在**同一个**括号里：「原来那顿（620 千卡 · 米饭、鸡蛋）就没了」。
      // 早先写成外面一层括号、里面又套一层（620 千卡（米饭、鸡蛋）），看着像嵌套 bug。
      const oldPart = old
        ? `${old.calories} 千卡${old.names.length ? ' · ' + old.names.join('、') : ''}`
        : '';
      return {
        title: `${next}${dayOfThis ? dayOfThis + '已经有记录了' : '今天已经有记录了'}`,
        body: oldPart ? `换成这一张，原来那顿（${oldPart}）就没了。` : '换成这一张，原来那顿就没了。',
        keep: '再想想',
        go: '换掉',
      };
    }
    // 搬走：这一笔已经记在某餐，改记到另一餐。
    const from = slotLabel(slot ?? guard.slot);
    return {
      title: `这一笔现在记在${from}`,
      body: dayLabel
        ? `改成记入${next}，${dayLabel}那天的${from}就空出来了（还是记在那一天，不会挪到今天）。`
        : `改成记入${next}，${from}那格会空出来。`,
      keep: '再想想',
      go: `记到${next}`,
    };
  }, [guard, takenInfo, slot]);

  // 这一笔被时间窗口锁住时，那句人话（为什么改不动、要改改哪个）。
  // 只说眼下的事实和**最近的那一步**，不铺陈道理：
  //   · otherDay：它是**别的一天**的事，最新那笔在另一天；
  //   · olderSlot：同一天里更晚的餐已经记了 —— 用户原话就是这句
  //     「有了晚餐之后，中餐就不能修改了」，所以这里照他的说法讲。
  const lockHint = (): string => {
    if (!lock) {
      return '';
    }
    const self = slot ? slotLabel(slot) : '';
    const latest = lock.latestSlot ? slotLabel(lock.latestSlot) : '';
    if (!self || !latest) {
      return '这一顿已经过了能改的时候了，现在能改的是最新那一顿。';
    }
    if (lock.kind === 'otherDay') {
      return `这一顿记在过去的那一天，已经过去了；现在能改的是最新那一顿（${latest}）。`;
    }
    return `${latest}已经记了，${self}这一顿就改不动了。想改${self}，先把${latest}撤掉。`;
  };

  // 点「早餐 / 中餐 / 晚餐」。
  // 再点一次已经选中的那个 = 取消（把这一条从账本里撤掉）。
  // 为什么这样设计：点错了不必特意跑回首页去删，原地再点一下就行 ——
  // 多一个「取消记账」的按钮才是真的多余。
  // ⚠️ 但"顺手"仅限不会弄丢东西的时候：会顶掉/搬走/撤掉已有记录的一律先问。
  const chooseSlot = (next: MealSlot) => {
    if (slot === next) {
      setGuard({ slot: next, kind: 'cancel' });
      return;
    }
    // ⚠️ 这里**不**先 newEntryId：用户点了"再想想"的话，这个 id 就是白占一个，
    //    而它一旦非 null，下面那段"这一笔已经记过"的判断就会以为有事发生过。
    //    真正落账（confirmGuard）时才建，建了就等于这一笔要写盘了。
    // ⚠️ 这一笔已经被时间窗口锁住（2026-10-02）：除了上面那个"再点它自己
    //    = 撤掉这一顿"的出口，别的改动一律不许 —— 记到别的餐、去顶掉别的餐，
    //   翻来覆去都是"记录被搬来搬去"，正是要避免的那类问题。
    //   想改这一顿，只有一条路：撤掉它（或撤掉挡路的那一餐）重新记，
    //   重新记的那一次是最新的一餐，才是能改的。
    if (lock) {
      setErrMsg(lockHint());
      return;
    }
    // 两种"会弄丢东西"的情形，都收口到这一层问一句：
    //   ① 目标那一餐今天已经有记录（且不是本笔自己，那种已在上面走取消分支了）→ 覆盖；
    //   ② 这一笔已经记在某一餐上（slot 非空）→ 改主意是把它搬走，原来那格会空。
    if (takenInfo[next] || slot !== null) {
      setGuard({ slot: next, kind: takenInfo[next] ? 'replace' : 'move' });
      return;
    }
    setSlot(next);
  };

  // 确认框上点了右边那个按钮。三种情形各写各的收尾。
  const confirmGuard = () => {
    if (!guard) {
      return;
    }
    const next = guard.slot;
    const kind = guard.kind;
    setGuard(null);
    if (kind === 'cancel') {
      const id = entryIdRef.current;
      // 日期要在清 ref **之前**取下来：删只能删这一天这一笔（removeEntry 认 id + date）。
      const date = entryDateRef.current ?? today();
      entryIdRef.current = null;
      entryAtRef.current = null;
      entryDateRef.current = null;
      setSlot(null);
      setLock(null); // 这一笔已经从账本里拿掉了，那把"只读"的锁跟着解开
      if (id) {
        void removeEntry(id, date);
        refreshTaken(); // 撤掉之后这一餐又空出来了，选餐次那边要跟着解锁
      }
      return;
    }
    // 覆盖 / 搬走都一样：钉到新餐次上，写账本那一步会照旧执行。
    // 这一笔是全新的（刚按快门、刚导进来、刚点过来）才要新 id；
    // 同一张照片接着改克数时 entryIdRef 已经有值，沿用同一个 ——
    // 那才是"改的是同一顿"，而不是又多记一笔。
    if (!entryIdRef.current) {
      entryIdRef.current = newEntryId();
      // 全新的一笔 = 归今天。（历史那一条改记到别的餐，日期是它自己的那天，不清；
      // 补拍的那一天同理 —— 它本来就该记到过去那一餐去。）
      entryAtRef.current = null;
      entryDateRef.current = backfillRef.current ? entryDateRef.current : null;
    }
    // 这一笔要落到某一餐、写盘了，它"还能不能改"随之重新判（lock 清掉，
    // 下一次进这一屏时由 editWindow 重新算）。
    setLock(null);
    setSlot(next);
  };

  // 拍照 或 从相册选。source 决定走哪一条。
  //
  // ⚠️ 这个函数一次管两件事：**第一次按是「拍照」，已经有照片之后再按是「重拍」**。
  //    按钮上显示哪个字由 stage 决定（见下面界面那一段），这里只管干活。
  //    用户 2026-09-26 夜定：「按过拍照以后，照片出来，一是下面可以按分析，
  //    二是拍照的那个按键要改成重拍 —— 刚刚拍的用户也可以选择看到照片以后
  //    觉得不合适，马上就重拍，满意了才按那个分析。」
  //    → 所以**分析之前重拍几次都行**，每按一次快门都会往相册里存一张，一张都不删。
  const pick = async (source: 'camera' | 'library') => {
    // 正在分析时不让换照片：换了之后回来的结果就对不上照片了。
    // 按钮那一刻也是灰的（见界面），这里再挡一道，防的是"点得比界面更新还快"。
    if (stage === 'analyzing') {
      return;
    }
    // 时间窗口锁着也不让：重拍 / 从相册导回都会顶掉这一笔 —— 那就是"改"，
    // 规矩既然说不许改，这条也得一起封住（按钮上同时是灰的）。
    if (lock) {
      setErrMsg(lockHint());
      return;
    }
    setErrMsg('');
    const Picker = await loadPicker();
    if (!Picker) {
      setErrMsg('当前安装包还不支持拍照/选图，请更新到最新版 App。');
      return;
    }

    // 相机和相册是两套独立权限，分别申请。被拒绝时说清原因，不要让人干瞪眼。
    const perm =
      source === 'camera'
        ? await Picker.requestCameraPermissionsAsync()
        : await Picker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErrMsg(
        source === 'camera'
          ? '没有拿到相机权限。请到手机「设置 → 应用 → 本 App → 权限」里打开相机。'
          : '没有拿到相册权限。请到手机「设置 → 应用 → 本 App → 权限」里打开照片。',
      );
      return;
    }

    // 拍完的照片要存进相册，所以拍照这条路顺手把相册权限也要下来。
    // 为什么放在这儿、而不是等真要存的时候再问：按完快门才弹一个权限框，
    // 正好打断存相册那一瞬间，看着别扭。**已经给过权限的话这里不会弹**，
    // 只有头一两次用会看到，之后就安静了。
    // 不管用户给不给，下一步都照常拍照 —— 不给就是"存不进相册"，别的都在。
    if (source === 'camera') {
      await Picker.requestMediaLibraryPermissionsAsync();
    }

    const res =
      source === 'camera'
        ? await Picker.launchCameraAsync({ quality: 0.5, base64: true, exif: true })
        : await Picker.launchImageLibraryAsync({ quality: 0.5, base64: true, exif: true });
    if (res.canceled || !res.assets?.length) {
      return; // 用户自己取消了，什么都不做
    }

    const asset = res.assets[0];
    if (!asset.base64) {
      setErrMsg('这张图片读不到数据，换一张试试。');
      return;
    }

    // ---------- 重拍：账本里那条会被顶掉，但**相册里的照片一张都不删** ----------
    // 用户 2026-09-26 深夜定：「每一餐只能拍一张照片，重拍可以把记录顶掉，
    // 但是头一次存在相册里的照片不要删 —— 因为后期用户还想从相册导入
    // 换成前面一张，让他也可以办得到。」
    // 同一晚又补了一条：「每一次重拍、或者每一次按快门，照片都要保存在相册。」
    // → 所以这里什么都不用做：往下走，新照片照常存进相册（见文件末尾那段），
    //   上一张原封不动地留在相册里。顶掉旧记录是记账那一步（replaceSlotEntry）的事。
    // → 相册里那一堆同餐照片，靠右下角**精确到秒**的时间分辨先后
    //   （见 lib/meal/stamp.ts）。

    // 判断这张图是横的还是竖的，好挑一个方向合适的框。
    // 万一拿不到尺寸，就沿用上一次的判断，不报错也不崩。
    const w = Number(asset.width) || 0;
    const h = Number(asset.height) || 0;
    if (w > 0 && h > 0) {
      setPhotoLandscape(w >= h);
    }
    setImageUri(asset.uri);
    setImageBase64(asset.base64);
    setMimeType(asset.mimeType ?? 'image/jpeg');
    setRows([]);
    setEditingId(null);
    setStaleCloud(false);
    setLegacyFilled(0);
    // ---------- 这次照片归哪一餐（2026-09-29 定）----------
    // ① 首页「还没拍」进来的（预选还没消费）→ 现在才把那一餐钉上，
    //    拍完、分析完自动记账，不用再选。
    // ② 其余（底部「餐前拍」进来的新拍/新选、回看流程里的重拍、相册导入）
    //    → 换了一张照片 = 换了一顿新账，餐次重新选（跟老规矩一样，多点一下，
    //    但绝不会把照片默默塞进哪一餐）。
    //    其中**按快门拍的**受新规矩管：今天已拍过的餐灰掉，后面的不能抵消前面的；
    //    **从相册导入**和**回看流程里的重拍**不受此限 —— 它们本来就是
    //    「换回旧图 / 替换这一餐」的正路，点的就是已拍的那一餐。
    if (presetSlotRef.current) {
      const pinned = presetSlotRef.current;
      presetSlotRef.current = '';
      setSlot(pinned);
      entryIdRef.current = null;
      entryAtRef.current = null;
      // 日期留着**这一句**是给补拍用的：补拍那张照片是现在拍的，可它记的是
      // 过去那一餐 —— 重拍一次，落点还是那过去的那一天，不能跟着清成今天
      // （清了就等于把"补拍"变成了"记今天"，那一格就白补了）。
      // 平常那一趟（wantDate 是空）则维持老样子：清掉 → 归今天。
      entryDateRef.current = backfillRef.current ? entryDateRef.current : null;
      setFromLog(false);
    } else {
    // 上一张的 id 一起清掉 —— 不清的话，新照片的结果会去**覆盖**上一张
    // 已经记好的那一条，两笔数字会搅在一起。日期也一起清：新照片归今天。
    setSlot(null);
    entryIdRef.current = null;
    entryAtRef.current = null;
    entryDateRef.current = backfillRef.current ? entryDateRef.current : null;
      // 换了一张照片 = 换了一笔新的，别把上一笔那把"只读"的锁接着扣在它头上。
      setLock(null);
      setFromLog(false);
    }
    // freshShot 只认「按快门 + 不是回看流程」：回看(fromLog)和相册导入都不算。
    setFreshShot(source === 'camera' && !fromLog);
    setPhotoGone(false);
    setStage('ready');
    // 台面上换了照片，重算一次「今天哪几餐已拍过」，选餐次那边要用最新的。
    refreshTaken();

    // 拍下来的照片要进相册。从相册里**选**进来的旧照片不走这一步 ——
    // 它本来就在相册里躺着，再存一份只是白占地方、还多一张重复的。
    // 这里不 await：该看到照片就立刻看到，存相册在背后自己进行。
    // exif 一起带过去：用来判断"这张照片相机已经打了时间没有"，避免 App 再叠一层。
    if (source === 'camera') {
      void saveToAlbumWithStamp(asset.uri, w, h, asset.exif);
    }
  };

  // 把刚拍的照片加上「日期 时间」存进相册，成功后界面改用相册里那一份。
  //
  // 每按一次快门都会走这里 —— 包括"分析之前连着重拍好几次"。
  // 每张都会独立存进相册，一张都不删（见 lib/meal/album.ts 顶部的死规矩）。
  //
  // 全程失败都不影响别的事：存不上就继续用临时文件，拍照、分析、记账照旧，
  // 只是照片留在 App 自己的临时目录里（跟这次改动之前一模一样）。
  //
  // exif：拍照结果自带的拍摄信息。用来判断"相机已经打了时间没有"，
  // 相机已打（多半画面里也烤进了时间）→ App 就不再叠一层，避免一张照片两个时间。
  const saveToAlbumWithStamp = async (
    uri: string,
    w: number,
    h: number,
    exif?: Record<string, any> | null,
  ) => {
    // 尺寸都不知道就没法按比例摆画面，直接放弃。
    // 相机几乎总会报尺寸，真遇到就当没有这回事，不打扰用户。
    if (!w || !h) {
      return;
    }

    // 上一次性还没走完就又拍了一张（手快连拍）：先把上一次了结掉。
    // 不了结的话，上一次那个 await 会永远挂在那儿 —— 不影响用，但白占着不放。
    stampJobRef.current?.settle(null);
    stampJobRef.current = null;

    // 记下"我是第几次快门"。下面拿到结果时要回头看它一眼。
    const mySeq = ++albumSeqRef.current;

    // 摆多大：按比例缩到屏幕里，留一点边，照片完整可见。
    // 截出来的照片就是这个尺寸的**实际像素**（一千出头）—— 存进相册看清
    // 餐盘绰绰有余，文件也小，相册本身也省地方。
    // 减 48 是左右各留一点边；乘 0.62 是上下也给别的内容留位置。
    const { boxW, boxH } = fitBox(w, h, Math.max(160, winW - 48), Math.max(160, winH * 0.62));

    // 这一张到底打不打 App 自己的时间戳（见 lib/meal/photoSettings.ts）：
    //   - 设置「总是添加」→ 打
    //   - 设置「不添加」→ 不打
    //   - 设置「自动」(默认) → 照片本身已有拍摄时间(EXIF)就不打，没有才打
    // 相机已带时间水印的照片，这样就不会被 App 再叠一层。
    const mode = await getWatermarkMode();
    const doStamp = shouldStamp(mode, exif);
    const text = doStamp ? stampText(new Date()) : '';

    const shot = await new Promise<string | null>((resolve) => {
      const job: StampJob = { uri, boxW, boxH, text, settle: resolve };
      stampJobRef.current = job;
      setStampJob(job);

      // 兜底：八秒还没弄完就放弃。这一屏绝不能赖在屏幕上不走 ——
      // 宁可这次不存相册，也不能让界面卡在那儿。
      setTimeout(() => {
        if (stampJobRef.current === job) {
          stampJobRef.current = null;
          setStampJob(null);
          resolve(null);
        }
      }, 8000);
    });

    // 只有"还是最新那一次快门"才把界面切到相册里那一份。
    // 否则会出现：用户已经拍到第二张了，第一张的存相册流程慢了一拍才回来，
    // 把屏幕上刚显示的新照片**换成旧那张** —— 用户会觉得"照片自己变了"，极难查。
    // （老的那一张这会儿其实也已经存进相册了，只是不再占用屏幕。）
    if (shot && mySeq === albumSeqRef.current) {
      // 存进去了：界面从此改用相册里那一份。
      // 这不只是"换个路径"—— 临时文件将来被系统清掉，也不影响回看了。
      setImageUri(shot);
      setPhotoGone(false);
    }
  };

  // 画面摆好了、照片也画出来了 → 截下来，存进相册。
  const captureStamp = async (job: StampJob) => {
    try {
      // 截图能力同样按需加载，理由和上面 loadPicker 一样：
      // 老安装包里没有这个原生模块，直接 import 会让整页白屏。
      const { captureRef } = await import('react-native-view-shot');
      const node = stampRef.current;
      if (!node) {
        throw new Error('水印画面还没摆好');
      }
      // 不传 width / height = 按这块画面的**实际像素**出图，不放大也不缩小。
      // 这一点很要紧：一放大，右下角那行字就发虚了。
      const tmp = await captureRef(node, {
        format: 'jpg',
        quality: 0.92,
        result: 'tmpfile',
      });
      // ⚠️ 用的是 job 自己带的收尾函数，不是"当前那一个" —— 见 StampJob 的注释。
      job.settle(await savePhotoToAlbum(tmp));
    } catch {
      // 截图失败、相册不给权限、存储满了…… 一律当作"没存上"，
      // 退回用临时文件，别的功能全都不受影响。
      job.settle(null);
    } finally {
      // 只撤自己那一屏：用户已经又拍了一张的话，屏幕上摆的是新那张，别把人家的撤了。
      if (stampJobRef.current === job) {
        stampJobRef.current = null;
        setStampJob(null);
      }
    }
  };

  // 把照片发到云端函数去分析。
  const run = async () => {
    if (!imageBase64 || stage === 'analyzing') {
      return;
    }
    setErrMsg('');
    setStage('analyzing');
    try {
      const r = await analyzeMeal(imageBase64, mimeType);
      setRows(r.items.map(toRow));
      setSummary(r.summary);
      setConfidence(r.confidence);
      setScale(r.scale ?? '');
      setStaleCloud(r.legacyFormat === true);
      setLegacyFilled(r.legacyFilled ?? 0);
      setEditingId(null);
      setStage('done');
    } catch (e) {
      setErrMsg(String((e as Error)?.message ?? e));
      setStage('ready'); // 退回「可以再试一次」的状态
    }
  };

  const reset = () => {
    setStage('idle');
    setImageUri(null);
    setImageBase64(null);
    setRows([]);
    setSummary('');
    setScale('');
    setErrMsg('');
    setStaleCloud(false);
    setLegacyFilled(0);
    setEditingId(null);
    // 已经记进账本的那一条**留着**（首页上看得见），这里只是把本页和它断开，
    // 好让下一张照片重新选餐次 —— 想给同一餐补一张，就是这个流程。
    setSlot(null);
    entryIdRef.current = null;
    entryAtRef.current = null;
    entryDateRef.current = null;
    setLock(null);
    // 本页和那一笔彻底断开。
    // ⚠️ 照片一律不管：账本里那条记录还留着（首页上看得到），它指的照片得在；
    //    就算那条后来被顶掉、被删掉，相册里那张也照样留着（见文件顶部说明）。
    setPhotoGone(false);
    setFromLog(false);
  };

  // 从首页移除这一笔（回看历史时才看得见这个入口，见下面的界面）。
  // 用在：这一餐记错了、整笔不想要了。
  // 既然一餐只留一张（2026-09-26 晚起），那"这一笔不要了"就等于
  // "这一餐空出来"，接着重新拍一张就行。
  const removeFromLog = () => {
    const id = entryIdRef.current;
    // 日期要在 reset()（它把这个 ref 清掉）**之前**取下来。
    const date = entryDateRef.current ?? today();
    reset(); // 先把本页和这一笔断开（账本里的那条由下面这行负责删）
    // ⚠️ 照片不删：账本里这条不要了，相册里那张还留着 ——
    //    回头想再记上这一餐，去相册里把它选回来就行。
    // ⚠️ 删只删**这一天这一笔**（removeEntry 认 id + date），
    //    别只认 id —— 同一条 id 挂在两天上时，只认 id 会顺手把另一天也删了。
    if (id) {
      void removeEntry(id, date);
      refreshTaken(); // 这一餐空出来了，选餐次那边要跟着解锁
    }
  };

  // ---------- 编辑 / 添加 ----------

  // ⚠️ 过了时间窗口的那一笔，底下这些改动的入口全都不开（界面上也是灰的），
  //    这里再挡一次，防的是"点得比界面更新还快"。
  const lockedNow = () => lock !== null;

  const beginEdit = (row: Row) => {
    if (lockedNow()) {
      return;
    }
    setEditingId(row.id);
    setDraftName(row.name);
    setDraftGrams(row.grams > 0 ? String(row.grams) : '');
    setEditErr('');
  };

  const beginAdd = () => {
    if (lockedNow()) {
      return;
    }
    setEditingId(NEW_ID);
    setDraftName('');
    setDraftGrams('');
    setEditErr('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditErr('');
  };

  // 确定：改完名称和克数后重算这一项。
  // 两条路：
  //   只改克数（名字没动、又有每100克基准）→ 本地换算，瞬间出结果
  //   改了名字（或原来没有基准）→ 重新估算（先查本地食物表，查不到问云端）
  const commitEdit = async () => {
    const name = draftName.trim();
    const g = Number(draftGrams.replace(/[^0-9.]/g, ''));
    if (!name) {
      setEditErr('请填食物名称。');
      return;
    }
    if (!isFinite(g) || g <= 0) {
      setEditErr('请填一个大于 0 的克数。');
      return;
    }
    setEditErr('');
    setBusy(true);
    try {
      if (editingId === NEW_ID) {
        const est = await estimateFood(name, g);
        if (est.legacyCloud) setStaleCloud(true);
        const row: Row = {
          id: newId(),
          name,
          grams: Math.round(g),
          portion: `约 ${Math.round(g)} 克`,
          calories: est.calories,
          carb: est.carb,
          source: 'user',
          // 自己加的：名称和克数都是用户填的，两项都算「改过」。
          edited: 'both',
          per100: est.per100,
          basis: basisText(est),
          orig: null,
        };
        setRows((prev) => [...prev, row]);
        setEditingId(null);
        return;
      }

      const old = rows.find((r) => r.id === editingId);
      if (!old) {
        setEditingId(null);
        return;
      }

      // 名称和克数都没动，直接关掉，别白标记一个「已改过」。
      if (name === old.name && Math.round(g) === old.grams) {
        setEditingId(null);
        return;
      }

      // 只动了克数（名字一个字都没改、又有每 100 克基准）→ 本地换算，不用联网。
      const onlyGrams = name === old.name && old.per100 !== null;
      if (onlyGrams && old.per100) {
        const s = scaleNutrient(old.per100, g);
        setRows((prev) =>
          prev.map((r) =>
            r.id === old.id
              ? {
                  ...r,
                  grams: Math.round(g),
                  portion: `约 ${Math.round(g)} 克`,
                  calories: s.calories,
                  carb: s.carb,
                  // 这个分支只在「名称一个字都没动」时走到（见上面的 onlyGrams），
                  // 所以染色只给克数那块 —— 改哪一项，哪一项变。
                  edited: 'grams',
                }
              : r,
          ),
        );
      } else {
        const est = await estimateFood(name, g);
        if (est.legacyCloud) setStaleCloud(true);
        setRows((prev) =>
          prev.map((r) =>
            r.id === old.id
              ? {
                  ...r,
                  name,
                  grams: Math.round(g),
                  portion: `约 ${Math.round(g)} 克`,
                  calories: est.calories,
                  carb: est.carb,
                  // 名字变了，原来的备注（如「油炸」）就不准了，清掉
                  note: name === old.name ? old.note : undefined,
                  // ★★ 这里就是 10-01 那个 bug：原来名称一动就标 'both'，
                  //    于是右边「150 克」那块跟着被染成淡黄 —— 用户根本没动克数。
                  //    现在写死按「名称动没动」来标：只改名称 → 'name'（只有名称变），
                  //    名称没动、是克数变了 → 'grams'。哪一项变，才标哪一项。
                  //    （这个 else 分支也可能承接「只改克数但 AI 没给每100克基准」的情况，
                  //    那条路径里 name 同样没变，会被正确判成 'grams'。）
                  edited: name === old.name ? 'grams' : 'name',
                  per100: est.per100,
                  basis: basisText(est),
                }
              : r,
          ),
        );
      }
      setEditingId(null);
    } catch (e) {
      setEditErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  // 这一项恢复成 AI 原来的估算值。
  const revert = (row: Row) => {
    if (lockedNow()) return;
    if (!row.orig) return;
    const o = row.orig;
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              name: o.name,
              grams: o.grams,
              portion: o.portion,
              calories: o.calories,
              carb: o.carb,
              note: o.note,
              per100: o.per100,
              basis: undefined,
              // 恢复原值 = 这一项又回到 AI 原样，染色一并撤销。
              edited: 'none',
            }
          : r,
      ),
    );
    setEditingId(null);
  };

  const removeRow = (id: string) => {
    if (lockedNow()) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    setEditingId(null);
  };

  // 打开全屏大图。
  // 顺手把屏幕方向解锁 —— 这样手机转成横屏时，照片能跟着横过来铺满整屏。
  // 老安装包里没有方向模块（loadOrientation 返回 null）时，就只打开大图、不转屏。
  const openViewer = () => {
    // 每次都从「整张照片」开始，不沿用上次捏出来的倍数
    resetViewerZoom();
    setViewerOpen(true);
    void (async () => {
      const mod = await loadOrientation();
      if (!mod) {
        return;
      }
      try {
        // 四个方向全放开：手机怎么转，照片就怎么跟着转。
        // 这个弹层里没有任何界面文字（只剩照片），所以就算上下颠倒也不影响 ——
        // 照片始终是正的，反而更方便从各种角度举着手机看。
        await mod.lockAsync(mod.OrientationLock.ALL);
      } catch {
        // 转不了屏不影响看图，安静放过
      }
    })();
  };

  // 关掉全屏大图，回到原来那个页面；同时把屏幕锁回竖屏
  // —— 别的页面都没做横屏适配，可不能让它们跟着横过来。
  const closeViewer = () => {
    resetViewerZoom();
    setViewerOpen(false);
    void (async () => {
      const mod = await loadOrientation();
      if (!mod) {
        return;
      }
      try {
        await mod.lockAsync(mod.OrientationLock.PORTRAIT_UP);
      } catch {
        // 同上
      }
    })();
  };

  // ---------- 全屏看图：双指捏合缩放 + 放大后单指拖动 ----------
  //
  // ⚠️ 这里踩过两个坑，写在代码里，免得以后换个人又撞上去：
  //
  // 坑一：最早用 RN 自带的 PanResponder「数手指头」（读 evt.nativeEvent.touches）
  //   判断是不是双指。但在 RN 的新架构下这个数组是空的（官方文档里
  //   PressEvent 的示例就明写着 touches: []），于是「两根手指」这个条件
  //   永远不成立，双指那条路根本进不去。而「点一下退出」那条路不看手指数量、
  //   一直正常 —— 症状就伪装成「只有双指坏了」，非常能骗人。
  //
  // 坑二：第二版改成自己记账（读 changedTouches，维护一张"现在有几根手指"的表），
  //   实测仍然不稳。
  //
  // 最终方案：用专门做手势的库（react-native-gesture-handler）。
  //   它的原生部分本来就打在你手机上的安装包里（libgesturehandler.so），
  //   所以换成它**不需要重新打包、也不需要重装**。
  //
  // 两条硬要求，少一条手势就完全没反应：
  //   ① 手势必须身处「手势根」(GestureHandlerRootView) 之内 —— 全 App 那个根
  //      在 app/_layout.tsx；
  //   ② 这个全屏弹层是独立的一层窗口，外面那个根**管不到它**，
  //      所以弹层里要再包一层（见下面 JSX）。
  //
  // 用 Animated.Value 驱动缩放和位移（而不是普通 state）：
  // 手指移动时直接改数值、不触发 React 重新渲染，画面才跟得上手指。
  const vScale = useRef(new Animated.Value(1)).current;
  const vTx = useRef(new Animated.Value(0)).current;
  const vTy = useRef(new Animated.Value(0)).current;
  // Animated.Value 存进去就读不回来了，所以「当前生效的倍数和位移」自己记一份
  const vNow = useRef({ scale: 1, tx: 0, ty: 0 }).current;
  // 一次手势「开始生效那一刻」的基准：当时的倍数、位移、两指中心，
  // 以及系统给的原始读数（只用来算增量，免得手指还没动画面就跳一下）
  const vBase = useRef({
    scale: 1,
    tx: 0,
    ty: 0,
    fx: 0,
    fy: 0,
    eScale: 1,
    pX: 0,
    pY: 0,
  }).current;
  // 这一整次触摸里到底有没有真的动过（捏过或拖过）。
  // 它是「点一下退出」唯一的门槛 —— 少了它，捏完／拖完松手会被误判成
  // 「点了一下」，全屏自己就关掉了。
  const vUsed = useRef(false);

  // 回到「整张照片」的状态：1 倍、不偏移
  const resetViewerZoom = () => {
    vNow.scale = 1;
    vNow.tx = 0;
    vNow.ty = 0;
    vScale.setValue(1);
    vTx.setValue(0);
    vTy.setValue(0);
  };

  // 放大之后能拖动多远：按「多出来的那部分」算，拖到边就停住，
  // 不会把照片拖出屏幕、在边上留下一片莫名其妙的黑。
  const offsetLimit = (scale: number) => ({
    x: Math.max(0, ((scale - 1) * winW) / 2),
    y: Math.max(0, ((scale - 1) * winH) / 2),
  });

  // 手机转成横屏后照片会重新铺满，之前的缩放和偏移就不作数了 —— 复位。
  useEffect(() => {
    resetViewerZoom();
    // 只在屏幕尺寸变化时跑；resetViewerZoom 每次都新建但功能一样，不需要进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winW, winH]);

  const viewerGesture = useMemo(() => {
    // 双指捏合。以两指中心为「定点」缩放 —— 手指按住的那个位置
    // 会一直停在手指下面，跟真实看图工具的手感一致。
    const pinch = Gesture.Pinch()
      // 回调放在普通 JS 线程执行，不牵扯 worklet 那一套，最稳
      .runOnJS(true)
      .onBegin(() => {
        vUsed.current = false;
      })
      .onStart((e) => {
        vUsed.current = true;
        vBase.scale = vNow.scale;
        vBase.tx = vNow.tx;
        vBase.ty = vNow.ty;
        // 两指中心，换算成「相对屏幕中心」的偏移
        vBase.fx = e.focalX - winW / 2;
        vBase.fy = e.focalY - winH / 2;
        // 系统给的 scale 是「相对两根手指最初的距离」，以这一刻为基准才不跳
        vBase.eScale = e.scale || 1;
      })
      .onUpdate((e) => {
        const ratio = vBase.eScale > 0 ? e.scale / vBase.eScale : 1;
        const scale = clamp(vBase.scale * ratio, 1, 4);
        // 定点缩放：新位移 = 定点 - (新倍数 ÷ 旧倍数) × (定点 - 旧位移)
        const k = vBase.scale > 0 ? scale / vBase.scale : 1;
        const limit = offsetLimit(scale);
        const tx = clamp(vBase.fx - k * (vBase.fx - vBase.tx), -limit.x, limit.x);
        const ty = clamp(vBase.fy - k * (vBase.fy - vBase.ty), -limit.y, limit.y);
        vNow.scale = scale;
        vNow.tx = tx;
        vNow.ty = ty;
        vScale.setValue(scale);
        vTx.setValue(tx);
        vTy.setValue(ty);
      })
      .onEnd(() => {
        // 捏回一比一左右 → 干脆归位，免得停在一个「半大不小」的别扭状态
        if (vNow.scale < 1.05) {
          resetViewerZoom();
        }
      });

    // 单指拖动（只在放大之后才有意义）。
    // maxPointers(1)：两根手指时这条不参与，全交给捏合处理，两边不打架。
    const pan = Gesture.Pan()
      .runOnJS(true)
      .maxPointers(1)
      .onBegin(() => {
        vUsed.current = false;
      })
      .onStart((e) => {
        // 拖动要移开一小段距离才算「生效」，所以能走到这里就说明用户是在拖、
        // 不是在点 —— 记下来，松手时就不该退出全屏。
        vUsed.current = true;
        vBase.tx = vNow.tx;
        vBase.ty = vNow.ty;
        vBase.pX = e.translationX;
        vBase.pY = e.translationY;
      })
      .onUpdate((e) => {
        if (vNow.scale <= 1) {
          return;
        }
        const limit = offsetLimit(vNow.scale);
        const tx = clamp(vBase.tx + (e.translationX - vBase.pX), -limit.x, limit.x);
        const ty = clamp(vBase.ty + (e.translationY - vBase.pY), -limit.y, limit.y);
        vNow.tx = tx;
        vNow.ty = ty;
        vTx.setValue(tx);
        vTy.setValue(ty);
      });

    // 点一下（手指基本没动就抬起）→ 退回原来的页面。
    const tap = Gesture.Tap()
      .runOnJS(true)
      .maxDistance(24)
      .onEnd(() => {
        if (!vUsed.current) {
          closeViewer();
        }
      });

    // 三种手势同时挂上：捏合、拖动、点击各管各的，靠 vUsed 这个门槛
    // 保证「点一下」只认真正的点击。
    return Gesture.Simultaneous(pinch, pan, tap);
    // 屏幕尺寸变了（横竖屏切换）要重算；其余依赖都是 ref，不需要进
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winW, winH]);

  // ---------- 顶上那两颗按钮该显示什么（2026-09-26 夜）----------
  // 屏幕上已经有照片（拍到的、从相册选的、或正在分析）→ 左边那颗显示「重拍」。
  // 规则只有这一条，用户不用记两套。
  const hasPhoto = stage !== 'idle';
  // 分析那一两秒里不让换照片：换了之后回来的结果就对不上照片了。
  // ★ 时间窗口锁着的时候也不让：重拍 / 从相册导回都会**顶掉**这一笔，
  //   那就是"换一种方式的改"——规矩既然是不许改，几条路得一起封住。
  //   想动这一顿，还是走撤掉重记那条（下面的「从首页移除这一笔」「再拍一张」）。
  const canRepick = stage !== 'analyzing' && !lock;

  // 注意：最外层用 <>...</> 包起来，只因为后面要再挂一个全屏看图的弹层。
  // 一层空标签不占空间、不影响布局，页面本身和原来一模一样。
  return (
    <>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>拍照分析餐盘</Text>
        <Text style={styles.heroSub}>
          拍一张餐盘照片，AI 帮你认出有哪些食物、大概多少份量，并估算热量和碳水化合物。
        </Text>
      </View>

      <View
        style={[
          styles.photoBox,
          // 横图用横框、竖图用竖框；还没选照片时用固定高度占位。
          imageUri
            ? photoLandscape
              ? styles.photoBoxWide
              : styles.photoBoxTall
            : styles.photoBoxEmpty,
        ]}
      >
        {imageUri && !photoGone ? (
          // 点一下 → 全屏看大图。卡片里这张是缩过的，看不清细节。
          <Pressable
            style={styles.photoTap}
            onPress={openViewer}
            accessibilityLabel="点一下看这张照片的大图"
          >
            {/* contain = 整张图缩到框里，宁可两边留点白，也不切掉任何一边。 */}
            <Image
              source={{ uri: imageUri }}
              style={styles.photo}
              resizeMode="contain"
              // 账本里存的是照片的**位置**，不是照片本身（见 lib/meal/log.ts）。
              // 打不开只有两种可能：这张已经被你从相册里删了，
              // 或者相册权限被收回了 —— 如实说一句，
              // 不要留一块空白让人对着猜"是不是我记错餐了"。
              onError={() => setPhotoGone(true)}
            />
          </Pressable>
        ) : photoGone ? (
          <View style={styles.photoGoneBox}>
            <Text style={styles.photoHint}>这张照片打不开了</Text>
            <Text style={styles.photoHintSub}>可能被相册删了 · 分析结果还留着</Text>
          </View>
        ) : (
          <Text style={styles.photoHint}>还没有选照片</Text>
        )}
      </View>

      {/* 左右两颗按钮。
          左边那颗的**字随状态变**（2026-09-26 夜，用户定）：
            · 屏幕上还没有照片 →「拍照」
            · 已经有照片、还没按分析 →「重拍」
          原话：「按过拍照以后，照片出来，一是下面可以按分析，二是拍照的那个
          按键要改成重拍 —— 刚刚拍的用户也可以选择看到照片以后觉得不合适，
          马上就重拍，满意了才按那个分析。」
          → 分析之前重拍几次都行，每按一次快门都会往相册里存一张，一张都不删。
          为什么不做成两颗并排的按钮：同一个位置只换一个字，用户不用重新找按钮在哪。
          分析中两颗都变灰按不动 —— 那一刻换照片，回来的结果就对不上照片了。 */}
      <View style={styles.btnRow}>
        <Pressable
          style={[styles.btn, styles.btnPrimary, !canRepick && styles.btnOff]}
          onPress={() => pick('camera')}
          disabled={!canRepick}
          accessibilityRole="button"
          accessibilityLabel={hasPhoto ? '重新拍一张（这一张会留在相册里）' : '拍照'}
        >
          <Text style={styles.btnText}>{hasPhoto ? '重拍' : '拍照'}</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnGhost, !canRepick && styles.btnOff]}
          onPress={() => pick('library')}
          disabled={!canRepick}
        >
          <Text style={styles.btnGhostText}>从相册选择</Text>
        </Pressable>
      </View>

      {stage !== 'idle' ? (
        <Pressable
          style={[styles.analyzeBtn, stage !== 'ready' && styles.analyzeBtnOff]}
          onPress={run}
          disabled={stage !== 'ready'}
        >
          {stage === 'analyzing' ? (
            <View style={styles.analyzingRow}>
              <ActivityIndicator color="#FFFFFF" />
              {/* 用户 2026-09-25 21:07 定：不要写时间提示（「最多约半分钟」），
                  只留「分析中，请稍等…」。等待时长由界面外的自动重试兜底
                  （见 lib/meal/api.ts），不需要在按钮上做说明。 */}
              <Text style={styles.analyzeText}>分析中，请稍等…</Text>
            </View>
          ) : (
            <Text style={styles.analyzeText}>
              {stage === 'done' ? '已分析完成' : '开始分析'}
            </Text>
          )}
        </Pressable>
      ) : null}

      {errMsg ? (
        <View style={styles.errBox}>
          <Text style={styles.errText}>{errMsg}</Text>
        </View>
      ) : null}

      {stage === 'done' ? (
        <View style={styles.resultWrap}>
          {/* 云端函数没更新时，数字会不准 —— 必须明说，不能让人对着错数字发呆 */}
          {staleCloud ? (
            <View style={styles.staleBox}>
              <Text style={styles.staleText}>
                {legacyFilled > 0
                  ? `云端分析函数还是旧版（只算「糖 / 油」，不算碳水）。下面标了来源的 ${legacyFilled} 项，碳水是按本地常见食物表估算的，会有偏差；云端函数更新后会自动变准。`
                  : '云端分析函数还是旧版（只算「糖 / 油」，不算碳水），本地食物表也没能匹配上，碳水数字不准。请按《餐盘分析-部署说明》重新部署一次云端函数（只需粘贴一次代码）。'}
              </Text>
            </View>
          ) : null}

          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>本餐合计</Text>
            <View style={styles.totalRow}>
              <View style={styles.totalCell}>
                <Text style={styles.totalNum} numberOfLines={1} adjustsFontSizeToFit>
                  {totals.calories}
                </Text>
                <Text style={styles.totalUnit}>千卡</Text>
              </View>
              <View style={styles.totalCell}>
                <Text style={styles.totalNum} numberOfLines={1} adjustsFontSizeToFit>
                  {totals.carb}
                </Text>
                <Text style={styles.totalUnit}>克碳水</Text>
              </View>
            </View>
            {touched ? <Text style={styles.totalNote}>已按你调整的内容重算</Text> : null}

            {/* ---------- 记到哪一餐（2026-09-26 新增）----------
                为什么紧贴在合计下面、而不是摆到页面最底部：
                它管的就是「这个合计要放到哪儿去」，离开这个数字就没有意义。
                摆远了，用户看完数就往下滑走了，根本不知道还有这一步。

                没有多余的说明文字：三个按钮摆在这儿，选中的那个会变成实色 ——
                实色本身就是"已经记进去了"的答案。
                ⚠️ 但再点一次同一格 = 撤掉这一顿，会弄丢首页上那一格的数字，
                   所以走的是下面那个确认框（'cancel' 那一支），不是直接撤。 */}
            <View style={styles.slotDivider} />
            <Text style={styles.slotTitle}>记到哪一餐</Text>
            <View style={styles.slotRow}>
              {SLOTS.map((s) => {
                const on = slot === s.key;
                // 2026-09-29 定的规矩：后面的不能抵消前面的 ——
                // 全新按快门拍的这张，不能再记进今天已经拍过的那一餐
                // （灰掉、按不动）。想替换某一餐：回首页点那一行进去重拍，
                // 或者「从相册选择」把旧图导回来（这两条路不受此限）。
                // 第一道是老规矩（新拍的一张不许记进今天已拍过的餐）；
                // 第二道是新的时间窗口：这一笔锁住了，除了它自己（再点 = 撤掉这一顿）
                // 那颗还能按，另外两颗都灰掉 —— 它不许被搬去别的餐，也不许去顶别的餐。
                const blocked =
                  (freshShot && !on && takenSlots.includes(s.key)) || (!!lock && !on);
                return (
                  <Pressable
                    key={s.key}
                    style={[styles.slotBtn, on && styles.slotBtnOn, blocked && styles.slotBtnBlocked]}
                    onPress={() => chooseSlot(s.key)}
                    disabled={blocked}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: blocked, selected: on }}
                    accessibilityLabel={
                      blocked
                        ? `${s.label}今天已拍过，不能再选`
                        : on
                          ? `确认撤掉记入${s.label}`
                          : `记入${s.label}，会先问一句`
                    }
                  >
                    <Text
                      style={[
                        styles.slotText,
                        on && styles.slotTextOn,
                        blocked && styles.slotTextBlocked,
                      ]}
                    >
                      {s.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {slot ? (
              <>
                <Text style={styles.slotDone}>已记入{slotLabel(slot)}，首页同步</Text>
                {/* ★ 这一顿已经过了能改的时间窗口（2026-10-02）。
                    不是说它错了，而是"最新那一餐以后，旧的就不再动了" ——
                    写清楚是哪一顿挡着、想改该怎么办，别让人对着一群灰按钮发懵。
                    下面「再点一次这一餐 = 撤掉这一顿」是唯一还留着的出口：
                    撤掉 → 重新记一次 → 那一次是最新的一餐，又能改了。 */}
                {lock ? (
                  <View style={styles.lockBox}>
                    <Text style={styles.lockTitle}>这一顿改不动了</Text>
                    <Text style={styles.lockText}>{lockHint()}</Text>
                  </View>
                ) : null}
              </>
            ) : freshShot && takenSlots.length >= SLOT_KEYS.length ? (
              // 三餐全满了又拍了一张新的：不解释一句，用户会对着三个灰按钮发懵。
              <Text style={styles.slotBlockedNote}>
                三餐都已拍过。想替换某一餐，回首页点那一行进去重拍。
              </Text>
            ) : null}
          </View>

          {/* ★ 点餐次之前的那句"问一句"（2026-10-01 加）
              会弄丢记录的三种情形（顶掉已有的 / 把这一笔搬走 / 撤掉这一餐）
              都在这儿收口。遮罩、左边那个按钮、安卓的返回键，全都是"不作改变"；
              只有右边那个是"照做"。
              刻意不用系统弹窗（Alert）：那上面两句话挤不下「原来那顿（620 千卡、
              米饭、鸡蛋）就没了」这种实话，而"悄悄顶掉"正是这次要堵的事。 */}
          <Modal
            visible={guard !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setGuard(null)}
          >
            <Pressable style={styles.guardMask} onPress={() => setGuard(null)}>
              {/* 点卡片本身不算"取消"也不算"确认" —— 停在原地最安全，
                  用户想好了再点。所以这里单纯不冒泡到遮罩上。 */}
              <Pressable style={styles.guardCard} onPress={() => undefined}>
                <Text style={styles.guardTitle}>{guardText?.title ?? ''}</Text>
                <Text style={styles.guardBody}>{guardText?.body ?? ''}</Text>
                <View style={styles.guardBtns}>
                  <Pressable
                    style={styles.guardBtn}
                    onPress={() => setGuard(null)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.guardBtnText}>{guardText?.keep ?? ''}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.guardBtn, styles.guardBtnGo]}
                    onPress={confirmGuard}
                    accessibilityRole="button"
                  >
                    <Text style={styles.guardBtnTextGo}>{guardText?.go ?? ''}</Text>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          </Modal>

          {rows.length === 0 && editingId !== NEW_ID ? (
            lock ? null : (
              <Text style={styles.emptyResult}>
                没能从这张照片里认出食物。换个角度重拍，或者点下面的「添加食物」自己填。
              </Text>
            )
          ) : null}

          {rows.map((it) => {
            const isEditing = editingId === it.id;
            const canEdit = it.grams > 0 || it.per100 !== null;
            // 小字提示：优先用模型的备注；没备注时，在「没改过」的情况下
            // 补一句原始份量说法（如「一小碗」）。改过之后原来的说法就不准了，不再显示。
            const hint =
              it.note ?? (it.edited !== 'none' || /[0-9]/.test(it.portion) ? '' : it.portion);
            // 把「括号说明 + 云端 note + 手动添加的估算依据(basis)」合并到同一行展示，
            // 满足「说明都放在一起」的诉求；任一项没有就不占位。
            const noteLine = [hint, it.basis].filter(Boolean).join(' · ');
            // 这种食物的升糖指数。每次渲染现查 —— 因为名称是可以改的，
            // 用户把「米饭」改成「苹果」，GI 必须当场跟着变，不能存死。
            // 查表很便宜（几十条关键词比对），不必缓存。
            //
            // ★ 2026-09-28：同时把「每 100 克有多少碳水」传进去 ——
            //   表里查不到这个菜名时，`lookupGi` 会拿它估一个值（显示成「GI 约 45」），
            //   所以**界面上再也不会出现「GI 无数据」**。用户原话：
            //   「不能有『无数据』这个说法。如果无数据，一定要查。怎么样也要有近似的。」
            // ⚠️ 仍然要传，别图省事省略 —— 省略了就只能按默认档（中）给，
            //   那才是真的「不看东西瞎报」。
            const per100 = it.grams > 0 ? (it.carb / it.grams) * 100 : null;
            const giInfo = lookupGi(it.name, per100);

            return (
              <View key={it.id} style={styles.itemCard}>
                {isEditing ? (
                  <EditBox
                    heading={it.name}
                    isNew={false}
                    name={draftName}
                    grams={draftGrams}
                    err={editErr}
                    busy={busy}
                    canRevert={it.edited !== 'none' && it.orig !== null}
                    hint={
                      it.orig && it.orig.grams > 0 && it.orig.grams !== Number(draftGrams)
                        ? `原来估的是 ${it.orig.grams} 克。`
                        : ''
                    }
                    onName={setDraftName}
                    onGrams={setDraftGrams}
                    onCancel={cancelEdit}
                    onConfirm={commitEdit}
                    onRevert={() => revert(it)}
                    onDelete={() => removeRow(it.id)}
                  />
                ) : (
                  <>
                    <View style={styles.itemHead}>
                      {/* 名称本身也要能点开编辑 —— 之前这里是一段死文字，
                          免责声明却写着「点名称改」，用户点了没反应，是实打实的 bug。 */}
                      {/* ★「改哪一项、哪一项变色」就落在这两块上（2026-09-30）：
                          改了名称 → 只有名称这块变淡黄；改了克数 → 只有克数那块变淡黄。
                          以前是共用一个 `edited` 布尔，改名称也会把右边的克数一起染黄，
                          用户原话：「我改变食物名称，食物名称它没有变色，而后面的重量变色了」。
                          所以这里各自用 editedName / editedGrams 单独判断。 */}
                      <Pressable
                        style={
                          // 锁住时把淡色底**撤掉**：本页「带淡色底 = 可以点」，
                          // 这一块已经点不动了，留着底色就是让人白点一次。
                          // 文字还染着色（历史里确实改过），那两样互不相干。
                          lock
                            ? styles.nameHitLocked
                            : [styles.nameHit, editedName(it.edited) && styles.nameHitEdited]
                        }
                        onPress={() => beginEdit(it)}
                        disabled={!!lock}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={
                          lock ? `${it.name}（这顿已过了能改的时候）` : `修改 ${it.name} 的名称和克数`
                        }
                      >
                        <Text
                          style={[styles.itemName, editedName(it.edited) && styles.itemNameEdited]}
                          numberOfLines={2}
                        >
                          {it.name}
                        </Text>
                      </Pressable>

                      {/* 夹在名称和克数中间的 GI 值。
                          只上色、不加底色 —— 本页「带淡色底」=「点它可以改」，
                          这块不可点，所以不能给它铺底色，否则会让人白点一次。

                          ⚠️⚠️ 2026-09-28 用户废止了「GI 无数据」这一档：
                          「不能有『无数据』这个说法。如果无数据，一定要查。
                            怎么样也要有近似的。这个 App 最重要的就是数据，
                            你写个『无数据』还有什么用呢？」
                          → 于是这里**只剩两种长相**，但含义还是三码事：
                            · 有值（含碳水的食物）→ 彩色「GI 83」
                            · 血糖不动（肉蛋鱼油）→ 灰色「GI 极低」，不写数值
                            · 表里没查到           → 彩色「GI 约 45」，**带一个「约」字**
                          ★ 「约」字不能省：它是「这是我按碳水估的，不是查来的」
                            的唯一标记。省掉就等于把估算冒充成查到的值 ——
                            用户是拿这个数决定吃多少的（他原话：「数据就是生命线」）。
                          ★ 「GI」两个字母也不能省（2026-09-25 第六轮）：
                            少了它，单独一个「约 45」没人知道在说什么。
                          ★ 2026-09-25 21:13 第十三轮（用户原话：「那个较高较低那个字不要，
                            只用颜色来表示就行，不需要在下面注上较低低高什么的」）：
                            删掉每项下面的档位名（低 / 较低 / 中 / 较高 / 高），
                            档位**只由颜色表示**。底部说明里那张档位对照表也一并删掉。
                          ★ 同一轮他还提出：橙色和红色在这么小的字上「看不出什么差别」。
                            第一版解法是给颜色加一条实心色条（面积是笔画的十几倍）——
                            **当轮就被否了**（用户 22:33 原话：「要把色条去掉，
                            不要这个色条非常突兀」）。最终走的是**调色**这条路：
                            把橙色提亮（见 lib/theme.ts 的四轮沿革），
                            橙红色差 27.8 → 36.3，颜色只由这个 13/800 的数字承担。
                            ⚠️ 仍然不能铺底色：那会违反上面「带淡色底 = 可点」的约定。 */}
                      <View style={styles.giBlock}>
                        {giInfo.kind === 'zero' ? (
                          // 血糖不动的那批：只有这一行字，但「GI」得带上 ——
                          // 「极低」单独摆着像是评价，「GI 极低」才是在说升糖指数。
                          <Text
                            style={[styles.giZeroText, { color: giInfo.level.color }]}
                            numberOfLines={1}
                          >
                            GI {giInfo.level.label}
                          </Text>
                        ) : giInfo.kind === 'est' ? (
                          // 表里没查到 → 按碳水密度估的值。样式和下面的确切值**完全一样**
                          //（同样字号、同样按档位上色），差别只在那一个「约」字上。
                          // 不把它做小做淡是有意的：它是一个真结论（有的估，只是不精确），
                          // 不是「我们没数据」——后者才是他嫌的那种废物信息。
                          <Text
                            style={[styles.giValue, { color: giInfo.level.color }]}
                            numberOfLines={1}
                          >
                            GI 约 {giInfo.gi}
                          </Text>
                        ) : (
                          // 只上色、不写档位名 —— 档位完全由这个数字的颜色表示。
                          // ⚠️ 色条试过一版（第十三轮），用户 22:33 否掉：
                          //    「要把色条去掉，不要这个色条非常突兀」——
                          //    颜色改用「提亮橙」来拉开差距（见 lib/theme.ts 的四轮沿革）。
                          <Text
                            style={[styles.giValue, { color: giInfo.level.color }]}
                            numberOfLines={1}
                          >
                            GI {giInfo.gi}
                          </Text>
                        )}
                      </View>

                      <Pressable
                        style={
                          lock
                            ? styles.gramsBtnLocked
                            : [styles.gramsBtn, editedGrams(it.edited) && styles.gramsBtnEdited]
                        }
                        onPress={() => beginEdit(it)}
                        disabled={!!lock}
                      >
                        <Text style={[styles.gramsText, editedGrams(it.edited) && styles.gramsTextEdited]}>
                          {/* 单位一律用中文 —— 用户 2026-09-25 定：
                              「要用中文就都用中文，要用字母就都用字母」。
                              本页热量写「千卡」、碳水写「克碳水」，所以这里
                              也必须是「克」，不能是「g」。 */}
                          {canEdit ? `${it.grams} 克` : '填克数'}
                        </Text>
                      </Pressable>
                    </View>

                    {/* 热量和碳水并排一行。单位同上：一律中文（千卡 / 克）。 */}
                    <View style={styles.nutriRow}>
                      <Text style={styles.nutriKcal}>{it.calories} 千卡</Text>
                      <Text style={styles.nutriSep}>·</Text>
                      <Text style={styles.nutriCarb}>碳水 {it.carb} 克</Text>
                    </View>

                    <View style={styles.tagRow}>
                      {it.source === 'user' ? (
                        <Text style={styles.tagUser}>手动添加</Text>
                      ) : null}
                      {/* 标签直接说清改的是哪一项，而不是笼统一句「已改过」——
                          用户抱怨的正是「看不出到底哪一项被改了」。
                          两个都改时写「都改过」，比分开两行省地方。 */}
                      {it.edited !== 'none' ? (
                        <Text style={styles.tagEdited}>
                          {it.edited === 'grams'
                            ? '克数已改'
                            : it.edited === 'name'
                              ? '名称已改'
                              : '名称·克数已改'}
                        </Text>
                      ) : null}
                    </View>

                    {noteLine ? <Text style={styles.itemNote}>{noteLine}</Text> : null}
                  </>
                )}
              </View>
            );
          })}

          {/* 底部：自己添加食物。照片没拍全、或者拍到了看不清的，都从这里补。 */}
          {editingId === NEW_ID ? (
            <View style={styles.itemCard}>
              <EditBox
                heading="添加食物"
                isNew
                name={draftName}
                grams={draftGrams}
                err={editErr}
                busy={busy}
                canRevert={false}
                hint=""
                onName={setDraftName}
                onGrams={setDraftGrams}
                onCancel={cancelEdit}
                onConfirm={commitEdit}
                onRevert={() => undefined}
                onDelete={null}
              />
            </View>
          ) : lock ? null : (
            // 锁住时这一颗整颗不摆 —— 摆一颗按下去没反应的按钮，比不摆更糟。
            <Pressable style={styles.addBtn} onPress={beginAdd}>
              <Text style={styles.addPlus}>＋</Text>
              <Text style={styles.addText}>添加食物</Text>
            </Pressable>
          )}

          <View style={styles.summaryCard}>
            <Text style={styles.summaryText}>{summary}</Text>
            {/* 这次是「量出来的」还是「猜的」—— 有参照物就如实写出来。
                没有参照物时不显示（逐项的小字里已经说了），
                界面上不留一句「没找到尺子」的丧气话。 */}
            {scale ? <Text style={styles.scaleText}>参照物：{scale}</Text> : null}
            {confidence === 'low' ? (
              <Text style={styles.lowConf}>照片不太清楚，这次结果的可信度偏低。</Text>
            ) : null}
          </View>

          {/* ⚠️ （2026-09-27 深夜定）这一段**上面**原来还有一段 GI 说明，正好三行，
              整个删掉了 —— 用户原话：「餐盘分析里最下面那个说明，第一段三个小节
              有关 GI 的，都不要，把它去掉。」
              → 页面底部现在只剩这一段。
              为什么敢删：三态**在卡片里就说得清**（一律以「GI」打头 ——
              `GI 83` / `GI 极低` / `GI 约 45`），颜色再说快慢，
              不必在页面底下再解释一遍。这是他 9/25→9/27 连着七轮收窄下来的
              同一件事：**不留空白、不留歧义，也不留废话。**
              ⛔ 别自己加回来。真要恢复，先问他。
              （三态来龙去脉见上面 GI 单元格那段注释、skill `myapp-gi-db-update`。） */}
          {/* 锁住时换一段短话：下面那段是教人怎么改的，这一顿改不了，
              摆着它会自相矛盾（说"点名称能改"，偏偏点不动）。 */}
          {lock ? (
            <Text style={styles.disclaimer}>
              这一顿是最新那一餐记下之前的那一次，已经关了修改。要重新记这一餐，
              点上面的「再拍一张」，或者点下面「从首页移除这一笔」把它先撤掉。
            </Text>
          ) : (
            <Text style={styles.disclaimer}>
              份量和营养都是估算值，仅供日常参考，不等于实际称量。认错了就点那项的食物名，
              或者点右边的克数 —— 凡是带淡色底的一块都能点，名称和克数都能修；
              漏掉的可以点下面「添加食物」自己补 —— 你填名称和克数，热量和碳水会自动算。
            </Text>
          )}

          {/* 这一屏是"从首页点进来回看的历史记录"时，才给一个移除的出口。
              刚拍完的新分析不显示 —— 那时候"移除"就是"我刚记的东西不要了"，
              该点的是上面餐次那三个按钮（再点一下就能取消）。 */}
          {fromLog ? (
            <Pressable style={styles.removeLogBtn} onPress={removeFromLog}>
              <Text style={styles.removeLogText}>从首页移除这一笔</Text>
            </Pressable>
          ) : null}

          <Pressable style={styles.resetBtn} onPress={reset}>
            <Text style={styles.resetText}>再拍一张</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>

      {/* ---------- 存进相册的那一瞬间 ----------
          先把「照片 + 右下角时间」摆出来，紧接着被截下来存进手机相册，
          然后这一屏自己撤掉。全程不到一秒，不需要谁去点。
          pointerEvents="none"：它绝不拦截触摸，万一用户手快在想点的地方点了，
          下面的按钮照样收到，不会出现"点了没反应"。 */}
      {stampJob ? (
        <View style={styles.stampLayer} pointerEvents="none">
          <StampPhoto
            ref={stampRef}
            uri={stampJob.uri}
            width={stampJob.boxW}
            height={stampJob.boxH}
            text={stampJob.text}
            // 照片真的画出来了才截 —— 早一帧截出来就是一块黑。
            onReady={() => void captureStamp(stampJob)}
            // 这张照片读不出来了：如实收场，退回用临时文件，不卡在屏幕上。
            onFailed={() => {
              if (stampJobRef.current === stampJob) {
                stampJobRef.current = null;
                setStampJob(null);
              }
              stampJob.settle(null);
            }}
          />
        </View>
      ) : null}

      {/* ---------- 全屏看大图 ---------- */}
      {/* 刻意只用系统自带的弹层（Modal）和图片（Image）来画 ——
          它俩是手机系统直接提供的，不依赖任何额外的安装包，
          所以就算你手机上装的是旧版 App，这段新代码推过去也不会闪退。 */}
      <Modal
        visible={viewerOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeViewer}
      >
        {/* ⚠️ 弹层里必须**再包一层手势根**：弹层是独立的一层窗口，
            页面最外层那个手势根管不到这里 —— 少了这一层，手势会完全没反应。 */}
        <GestureHandlerRootView style={styles.viewerRoot}>
          {/* 整块黑底铺满全屏，照片按比例缩到屏幕内 —— 尽量撑到最大，但一刀不裁。
              尺寸用 winW / winH 算：手机转成横屏时这两个值会更新，照片跟着重新铺满。
              整块都能操作：双指捏合放大 → 放大后单指拖动看细节 → 点一下退回去。
              所以屏幕上不需要任何按钮或文字。 */}
          <GestureDetector gesture={viewerGesture}>
            <View style={styles.viewerBackdrop}>
              {imageUri ? (
                /* 两层套着：外层管拖动（位移），内层管缩放。分开就不会互相干扰。 */
                <Animated.View
                  style={{ transform: [{ translateX: vTx }, { translateY: vTy }] }}
                >
                  <Animated.View style={{ transform: [{ scale: vScale }] }}>
                    <Image
                      source={{ uri: imageUri }}
                      style={{ width: winW, height: winH }}
                      resizeMode="contain"
                    />
                  </Animated.View>
                </Animated.View>
              ) : null}
            </View>
          </GestureDetector>
        </GestureHandlerRootView>
      </Modal>
    </>
  );
}

// ---------- 编辑框（改已有的一项 / 添加新的一项，共用） ----------
function EditBox(props: {
  heading: string;
  isNew: boolean;
  name: string;
  grams: string;
  err: string;
  busy: boolean;
  canRevert: boolean;
  hint: string;
  onName: (v: string) => void;
  onGrams: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onRevert: () => void;
  onDelete: (() => void) | null;
}) {
  return (
    <View style={styles.editBox}>
      <View style={styles.editHead}>
        <Text style={styles.editName} numberOfLines={1}>
          {props.heading}
        </Text>
        <Text style={styles.editTitle}>{props.isNew ? '新加一项' : '改名称 / 份量'}</Text>
      </View>

      <TextInput
        style={styles.editNameInput}
        value={props.name}
        onChangeText={props.onName}
        placeholder={props.isNew ? '食物名称，比如：米饭、红烧肉' : '食物名称'}
        placeholderTextColor={colors.sub}
        autoFocus={props.isNew}
      />

      <View style={styles.editRow}>
        <TextInput
          style={styles.editInput}
          value={props.grams}
          onChangeText={props.onGrams}
          keyboardType="numeric"
          autoFocus={!props.isNew}
          selectTextOnFocus
          placeholder="克数"
          placeholderTextColor={colors.sub}
        />
        <Text style={styles.editUnit}>克</Text>
      </View>

      {props.err ? (
        <Text style={styles.editErr}>{props.err}</Text>
      ) : (
        <Text style={styles.editHint}>
          {props.hint}
          {props.isNew
            ? '你只填名称和克数，热量和碳水会自动算。'
            : '名称或克数改了，热量和碳水会跟着重算。'}
        </Text>
      )}

      <View style={styles.editBtns}>
        {props.onDelete ? (
          <Pressable onPress={props.onDelete} disabled={props.busy}>
            <Text style={styles.delText}>删除这项</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <View style={styles.editBtnsRight}>
          {props.canRevert ? (
            <Pressable style={styles.smallGhost} onPress={props.onRevert} disabled={props.busy}>
              <Text style={styles.smallGhostText}>恢复原值</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.smallGhost} onPress={props.onCancel} disabled={props.busy}>
            <Text style={styles.smallGhostText}>取消</Text>
          </Pressable>
          <Pressable
            style={[styles.smallPrimary, props.busy && styles.smallPrimaryOff]}
            onPress={props.onConfirm}
            disabled={props.busy}
          >
            {props.busy ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.smallPrimaryText}>确定</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: space.md,
    gap: space.md,
    paddingBottom: space.xl,
  },
  // 存相册那一瞬间铺满全屏的一层。压暗背景，把「照片 + 时间」衬出来。
  stampLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
  },
  hero: {
    gap: space.xs,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  heroSub: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.sub,
  },
  photoBox: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // 框只有两种高度：横图一个、竖图一个。
  // 高度写死、不跟着照片比例走 —— 框的大小才稳定可预期；
  // 照片用 contain 完整缩进去，放不满的地方自然留白，绝不裁剪。
  photoBoxWide: {
    height: 250,
  },
  photoBoxTall: {
    height: 400,
  },
  // 还没选照片：占位高度，跟原来的样子一致
  photoBoxEmpty: {
    height: 220,
  },
  // 点击区铺满整个照片框，手指点哪儿都算（不用瞄准照片本身）
  photoTap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoHint: {
    fontSize: 13,
    color: colors.sub,
  },
  // 照片打不开时的占位（见上面 Image 的 onError）。
  // 两行：第一行说清发生了什么，第二行马上把人的注意力拉回"分析还在" ——
  // 只写第一行的话，用户会以为整条记录都废了。
  photoGoneBox: {
    alignItems: 'center',
    gap: 4,
  },
  photoHintSub: {
    fontSize: 12,
    color: colors.sub,
  },
  btnRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  btnGhost: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  btnGhostText: {
    fontSize: 15,
    color: colors.text,
  },
  // 分析那一两秒里，「拍照 / 重拍」和「从相册选择」按不动。
  // 只降透明度、不换底色 —— 它俩平时一个是实色一个是白底，
  // 用同一个"变淡"来表达"暂时不能点"，比给两种底各配一个禁用色更不容易看错。
  btnOff: {
    opacity: 0.4,
  },
  analyzeBtn: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  analyzeBtnOff: {
    backgroundColor: colors.line,
  },
  analyzeText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  analyzingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  errBox: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: space.md,
  },
  errText: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.danger,
  },
  staleBox: {
    backgroundColor: colors.warnSoft,
    borderRadius: radius.md,
    padding: space.md,
  },
  staleText: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.warn,
  },

  /* ---------- 「这一顿改不动了」（2026-10-02 时间窗口）----------
    用和「云端函数旧版」同一套色（warnSoft 底 + warn 字）：
    它俩的性质一样 —— 都是"能看、只是这块先动不了"，不是出错，
    所以不套红色（danger），免得让人以为刚才点错了什么。 */
  lockBox: {
    backgroundColor: colors.warnSoft,
    borderRadius: radius.md,
    padding: space.md,
    gap: 4,
  },
  lockTitle: {
    fontSize: 13,
    fontWeight: '600',
    // warn 在白底上小字看不清（2.1:1），标题这行改用深橙（3.3:1）。
    color: colors.warnDeep,
  },
  lockText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.warnDeep,
  },
  resultWrap: {
    gap: space.sm,
  },
  totalCard: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  totalLabel: {
    fontSize: 12,
    color: colors.sub,
  },
  totalRow: {
    flexDirection: 'row',
  },
  totalCell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  totalNum: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.accent,
    // 2026-10-12 hotfix：安卓 fontWeight:'700' 走描边加粗，绘制时比常规粗体宽，
    // 文本框被量窄 → 末位折到第二行被裁（664 显示成 66）。stretch 撑满整格 + 居中 +
    // 最小字号缩放，保证「本餐合计」永远完整显示末位。
    alignSelf: 'stretch',
    textAlign: 'center',
    minimumFontScale: 0.5,
  },
  totalUnit: {
    fontSize: 11,
    color: colors.sub,
  },
  totalNote: {
    fontSize: 11,
    color: colors.accent,
  },

  /* ---------- 「记到哪一餐」（2026-09-26） ---------- */
  // 这一小块长在「本餐合计」卡片里面，底色是主色的浅蓝 accentSoft，
  // 所以分割线不能用 colors.line（#E6EDF3 和浅蓝底几乎同色，等于没画）——
  // 用主色本身的半透明版，深浅刚好，也不会抢走上面那两个大数字的注意力。
  slotDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(31,162,255,0.25)',
    marginTop: space.xs,
  },
  slotTitle: {
    fontSize: 12,
    color: colors.sub,
  },
  slotRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  // 默认是"空心"的：白底 + 主色边框 —— 一眼就知道这仨能点。
  slotBtn: {
    flex: 1,
    height: 38,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 选中 = 实心主色底。靠颜色说"已经记进去了"，不再多写一行提示。
  slotBtnOn: {
    backgroundColor: colors.accent,
  },
  slotText: {
    fontSize: 14,
    color: colors.accent,
  },
  slotTextOn: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  slotDone: {
    fontSize: 11,
    color: colors.accent,
  },
  // 已拍过的餐：按钮和字都灰掉 —— 能不能点一眼分出来，不用读字。
  slotBtnBlocked: {
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  slotTextBlocked: {
    fontSize: 14,
    color: colors.sub,
  },
  slotBlockedNote: {
    fontSize: 11,
    color: colors.sub,
  },

  /* ---------- 点餐次之前的确认框（2026-10-01 加）----------
    两句话 + 两个按钮，不再多一个字：
      左边「再想想 / 留着这一顿」= 什么都不动；右边才是真动手。
    右边用淡黄底 + 深橙字（warnDeep），和上面"改过"的染色一套色 ——
    看一眼就知道这是"动过点什么"的操作，不是普通确认。 */
  guardMask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  guardCard: {
    width: '100%',
    maxWidth: 300,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  guardTitle: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '600',
  },
  guardBody: {
    fontSize: 13,
    color: colors.sub,
  },
  guardBtns: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.xs,
  },
  guardBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guardBtnText: {
    fontSize: 14,
    color: colors.accent,
  },
  guardBtnGo: {
    backgroundColor: colors.warnSoft,
    borderColor: colors.warn,
  },
  guardBtnTextGo: {
    fontSize: 14,
    color: colors.warnDeep, // 淡黄底上用深橙：对比度 3.0:1，看得清（见 theme 里的 warnDeep 注释）
    fontWeight: '500',
  },

  /* ---------- 单项卡片 ---------- */
  itemCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: 6,
  },
  itemHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  // 名称区域：淡色底 = 可以改。
  // 和右边的克数块用同一套内边距 / 圆角 / 底色 —— 全页统一规则：
  // 「凡是带淡色底的一块，都能点开改」。
  nameHit: {
    flexShrink: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  // 改过名称：整块（底色 + 字色）一起换成「淡黄 + 深橙」，
  // 和右边克数那块改过时的样子同一套 —— 两处长得像，才知道是同一种「被改过」。
  // 只染文字不染底是没用的：这一行字本来就深黑，橙色一上去几乎看不出区别。
  // ⚠️ 字用 warnDeep 不用 warn：淡黄底上 warn(#F4A100) 只有 2.1:1，看着发淡像"变小了"，
  //    warnDeep 是 3.0:1，同样大小会显得更实。（2026-09-30）
  itemNameEdited: {
    color: colors.warnDeep,
  },
  nameHitEdited: {
    backgroundColor: colors.warnSoft,
  },
  // 时间窗口锁住时：撤掉淡色底（本页「淡色底 = 可以点」的约定，见上面 nameHit 的注释）。
  // 文字那层染色不走这条路 —— 它说的是"历史上改过这一项"，跟能不能改是两回事。
  nameHitLocked: {
    backgroundColor: 'transparent',
  },
  // 中间那块「GI 值」：夹在名称和克数中间的一小块窄条。
  // 宽度让给食物名 —— 名字才是这一行的主角，GI 是补充信息。
  // 颜色由五档色阶内联给，所以这里不写 color。
  giBlock: {
    alignItems: 'center',
    // ⚠️ 显式声明「这一块不许被压缩」：现在这里最长是「GI 约 83」7 个字符，
    //    挤的时候该让食物名换行（nameHit 是 flexShrink:1），
    //    不能让 GI 这两个字母被截掉 —— 用户明确要求它必须留着。
    flexShrink: 0,
  },
  // ⚠️ 这里曾经给数字前加过一条 4×14 的竖色条（想让橙红好分辨），
  //    2026-09-25 22:33 被用户否掉：「要把色条去掉，不要这个色条非常突兀」。
  //    **别再往这块加色条了** —— 档位色差最终是靠调色解决的（提亮橙，见 lib/theme.ts）。
  // 「GI 极低」那批：跟数值行差不多大小。灰色本身就在说「它不在五档色阶上」。
  giZeroText: {
    fontSize: 12,
    fontWeight: '700',
  },
  // 数值行：13/800 是为了让档位色看得出来而定的下限。
  // （原来 11/700，用户 2026-09-25 反馈「很小的字很细，看不出什么差别」。）
  // ★ 2026-09-28 起这条同时管**估算值**（「GI 约 45」）—— 两者共用同一个样式是有意的：
  //   估算值也是个真结论，不该做得比查到的值小一号、淡一截。
  //   唯一的差别就是数字前面那个「约」字（见渲染处）。
  // ⚠️ 别再单开一个 `giNoData` 那种更小更淡的样式 —— 那对应的是已经废止的
  //   「GI 无数据」，样式留着会诱着后人把它加回来。
  giValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  // 右边那颗「克数」胶囊 —— 点它就能改
  gramsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
  },
  gramsBtnEdited: {
    backgroundColor: colors.warnSoft,
  },
  gramsBtnLocked: {
    backgroundColor: 'transparent',
  },
  gramsText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.accent,
  },
  gramsTextEdited: {
    color: colors.warnDeep,
  },
  // 热量 + 碳水 并排一行
  nutriRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  nutriKcal: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.accent,
  },
  nutriSep: {
    fontSize: 12,
    color: colors.line,
  },
  nutriCarb: {
    fontSize: 13,
    color: colors.sub,
  },
  tagRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  // 标签一律「不带底色」—— 全页只有「食物名」和「克数」两块是淡色底，
  // 而淡色底在本页代表「可以点开改」。标签不可点却带底色，会让人白点一次。
  tagUser: {
    fontSize: 10,
    color: colors.sub,
  },
  tagEdited: {
    fontSize: 10,
    // 10 号小字最怕淡色：warn 在白底上只有 2.1:1，小字几乎糊掉，
    // 换成 warnDeep（3.3:1）后「克数已改」这种四个字才真的看得清。
    color: colors.warnDeep,
  },
  itemNote: {
    fontSize: 12,
    color: colors.warn,
  },
  basis: {
    fontSize: 11,
    color: colors.sub,
  },

  /* ---------- 底部「添加食物」 ---------- */
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  addPlus: {
    fontSize: 20,
    lineHeight: 22,
    color: colors.accent,
  },
  addText: {
    fontSize: 15,
    color: colors.accent,
  },

  /* ---------- 编辑态 ---------- */
  editBox: {
    gap: space.sm,
  },
  editHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  editName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  editTitle: {
    fontSize: 11,
    color: colors.sub,
  },
  editNameInput: {
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  editInput: {
    flex: 1,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    fontSize: 17,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  editUnit: {
    fontSize: 14,
    color: colors.sub,
  },
  editHint: {
    fontSize: 11,
    lineHeight: 17,
    color: colors.sub,
  },
  editErr: {
    fontSize: 12,
    color: colors.danger,
  },
  editBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editBtnsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  delText: {
    fontSize: 13,
    color: colors.danger,
  },
  smallGhost: {
    paddingHorizontal: 14,
    height: 36,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallGhostText: {
    fontSize: 13,
    color: colors.text,
  },
  smallPrimary: {
    minWidth: 64,
    paddingHorizontal: 18,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallPrimaryOff: {
    opacity: 0.6,
  },
  smallPrimaryText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#FFFFFF',
  },

  /* ---------- 汇总 ---------- */
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  summaryText: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
  },
  // 「参照物：筷子24cm + 鸡蛋」——比正文再小一号、更淡，
  // 它是一句证据不是一句结论，不该跟总评抢注意力。
  scaleText: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.sub,
  },
  lowConf: {
    fontSize: 12,
    color: colors.warn,
  },
  emptyResult: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.sub,
    paddingHorizontal: space.xs,
  },
  disclaimer: {
    fontSize: 11,
    lineHeight: 17,
    color: colors.sub,
    paddingHorizontal: space.xs,
  },
  resetBtn: {
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetText: {
    fontSize: 15,
    color: colors.text,
  },
  // 「从首页移除这一笔」：只有回看历史时才出现。
  // 做成一行红字、不加框 —— 它不是这一页的主操作（主操作是上面那个「再拍一张」），
  // 但红色能让人在需要的时候一眼找到它。
  removeLogBtn: {
    alignItems: 'center',
    paddingVertical: space.sm,
  },
  removeLogText: {
    fontSize: 13,
    color: colors.danger,
  },

  /* ---------- 全屏看大图 ---------- */
  // 弹层里的手势根：手势库要求的容器，弹层里手势能不能用全靠它。
  viewerRoot: {
    flex: 1,
  },
  // 纯黑底铺满全屏：照片本身的颜色不会被界面干扰，这是看图工具的惯例。
  // 整块都能操作 —— 双指捏合放大、放大后单指拖动、点一下退回原页面。
  viewerBackdrop: {
    flex: 1,
    backgroundColor: '#000000',
    // 照片居中放；双指捏合时也是围绕着中心放大，这是看图工具的惯例
    alignItems: 'center',
    justifyContent: 'center',
  },
});
