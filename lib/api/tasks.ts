import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Task } from '../../types/task';
import { today } from '../date';
import { getSyncCode } from '../syncCode';
import { isCloudEnabled } from '../supabase';
import { fetchCloudTasks, saveCloudTasks } from './cloud';
import { getCategory } from '../categories';

// 数据在手机里存放的名字。哪天想看"全新安装"的样子，把这个名字改一下就行。
const STORAGE_KEY = 'myapp.tasks.v1';

// 第一次打开 App 时预置的任务。之后你自己加的任务存在手机里，不会再碰这个列表。
const SEED_TASKS: Task[] = [
  {
    id: '1',
    title: '装好 Expo Go，用手机连到这一页',
    note: '这一步跑通，开发环境就算过关了',
    done: true,
    createdAt: '2026-09-13',
    dueDate: null,
    important: false,
    category: 'none',
  },
  {
    id: '2',
    title: '改一句话，看手机上是不是立刻变了',
    note: '这就是热更新：存盘即刷新，不用重新打包',
    done: true,
    createdAt: '2026-09-13',
    dueDate: null,
    important: false,
    category: 'none',
  },
  {
    id: '3',
    title: '新增一条任务，把 App 杀掉再打开，看它还在不在',
    note: '还在，就说明数据真的存进手机了',
    done: false,
    createdAt: '2026-09-14',
    dueDate: null,
    // 故意留一条标着「重要」的：哪天你重装 App，一打开就能看见星星长什么样。
    important: true,
    category: 'work',
  },
  {
    id: '4',
    title: '进详情页改标题、写备注、设个截止日期',
    note: '改完点「保存修改」，退回列表看有没有变',
    done: false,
    createdAt: '2026-09-14',
    dueDate: null,
    important: false,
    category: 'life',
  },
];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 把从手机里读出来的一条原始数据，整理成标准的 Task。
//
// 为什么需要这一步：你今天之前存进去的任务里**没有 dueDate 这个字段**。
// 如果不补齐，代码读到 undefined 就可能算错、甚至崩掉。
// 这里给老数据填默认值，你就**不用清空已有任务**。
function normalize(raw: unknown): Task | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const item = raw as Partial<Task>;
  // 连 id 和标题都没有的，不是一条正常任务，直接丢掉
  if (typeof item.id !== 'string' || typeof item.title !== 'string') {
    return null;
  }
  return {
    id: item.id,
    title: item.title,
    note: typeof item.note === 'string' ? item.note : '',
    done: item.done === true,
    createdAt: typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : today(),
    // 只认非空的字符串，其余（undefined / 空串 / 数字）一律当"没设截止日期"
    dueDate:
      typeof item.dueDate === 'string' && item.dueDate.length > 0 ? item.dueDate : null,
    // 老任务里没有这个字段，读出来是 undefined —— 不补这一行，星星的显示逻辑就会读到
    // 一个"既不是 true 也不是 false"的值。一律当"不重要"，老任务原封不动照常显示。
    // 注意：这里必须写 === true，不能写成 item.important —— 存坏的数据里可能是字符串 "false"，
    // 而 "false" 在判断真假时算"真"，那就全反了。
    important: item.important === true,
    // 老任务里没有分类字段，一律退回「未分类」；云端或别人手抖写错的分类 key
    // 也在这里被 getCategory 兜住，不会让界面拿到一个不认识的字符串。
    category: getCategory(item.category).key,
  };
}

// 从手机存储里读出全部任务。第一次读是空的，就把预置任务写进去。
async function readLocal(): Promise<Task[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_TASKS));
    return SEED_TASKS;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return SEED_TASKS;
    }
    const list = parsed
      .map(normalize)
      .filter((item): item is Task => item !== null);
    // 原本有内容，整理完却一条不剩 —— 说明存的格式彻底坏了，退回预置任务。
    // （空数组是合法状态：用户把任务全删光了。所以这里只处理"原本非空"的情况。）
    if (list.length === 0 && parsed.length > 0) {
      return SEED_TASKS;
    }
    return list;
  } catch {
    // 存的内容坏掉了，退回预置任务，别让 App 直接崩给你看。
    return SEED_TASKS;
  }
}

async function writeLocal(tasks: Task[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// 云端优先、本地兜底：设了同步码且配置齐全就走 Supabase；否则用手机本地存储。
// 调用方（界面）完全无感，永远拿到一份 Task[]。
async function resolveMode(): Promise<'cloud' | 'local'> {
  const code = await getSyncCode();
  return code && isCloudEnabled ? 'cloud' : 'local';
}

// 取列表。
export async function fetchTasks(): Promise<Task[]> {
  if ((await resolveMode()) === 'cloud') {
    return fetchCloudTasks((await getSyncCode()) as string);
  }
  await wait(400);
  return readLocal();
}

// 取单条。
export async function fetchTask(id: string): Promise<Task> {
  if ((await resolveMode()) === 'cloud') {
    const all = await fetchCloudTasks((await getSyncCode()) as string);
    const found = all.find((item) => item.id === id);
    if (!found) {
      throw new Error('这条任务不存在');
    }
    return found;
  }
  await wait(250);
  const found = (await readLocal()).find((item) => item.id === id);
  if (!found) {
    throw new Error('这条任务不存在');
  }
  return found;
}

// 整份存回。新增、勾选、删除都走这里，改完立刻落盘 / 上云。
export async function saveTasks(tasks: Task[]): Promise<void> {
  if ((await resolveMode()) === 'cloud') {
    await saveCloudTasks(tasks, (await getSyncCode()) as string);
    return;
  }
  await writeLocal(tasks);
}

// 只改一条。详情页点「保存修改」走的就是这里。
// 找不到就当成新增插到最前面 —— 这样将来做"复制一条"时也能直接复用。
export async function saveTask(task: Task): Promise<void> {
  if ((await resolveMode()) === 'cloud') {
    const code = (await getSyncCode()) as string;
    const all = await fetchCloudTasks(code);
    const exists = all.some((item) => item.id === task.id);
    const next = exists
      ? all.map((item) => (item.id === task.id ? task : item))
      : [task, ...all];
    await saveCloudTasks(next, code);
    return;
  }
  const all = await readLocal();
  const exists = all.some((item) => item.id === task.id);
  const next = exists
    ? all.map((item) => (item.id === task.id ? task : item))
    : [task, ...all];
  await writeLocal(next);
}

// 删掉一条。
export async function removeTask(id: string): Promise<void> {
  if ((await resolveMode()) === 'cloud') {
    const code = (await getSyncCode()) as string;
    const all = await fetchCloudTasks(code);
    await saveCloudTasks(
      all.filter((item) => item.id !== id),
      code,
    );
    return;
  }
  const all = await readLocal();
  await writeLocal(all.filter((item) => item.id !== id));
}
