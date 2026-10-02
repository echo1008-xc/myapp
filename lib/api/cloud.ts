import { supabase } from '../supabase';
import type { Task } from '../../types/task';
import { getCategory } from '../categories';

// 云端的字段用 snake_case（created_at / due_date），App 里用 camelCase（createdAt / dueDate）。
// 两边各写一份转换函数，别处不用关心这个差别。
type CloudTask = {
  id: string;
  owner: string;
  title: string;
  note: string;
  done: boolean;
  created_at: string;
  due_date: string | null;
  important: boolean;
  category: string;
};

function toCloud(t: Task, owner: string): CloudTask {
  return {
    id: t.id,
    owner,
    title: t.title,
    note: t.note,
    done: t.done,
    created_at: t.createdAt,
    due_date: t.dueDate,
    important: t.important,
    category: t.category,
  };
}

function fromCloud(c: CloudTask): Task {
  return {
    id: c.id,
    title: c.title,
    note: c.note,
    done: c.done,
    createdAt: c.created_at,
    dueDate: c.due_date,
    important: c.important,
    // 云端存的是普通字符串，这里用 getCategory 转回合法的 CategoryKey，
    // 万一存进了奇怪的值也不会让 App 崩。
    category: getCategory(c.category).key,
  };
}

// 取某一串同步码对应的全部任务。
export async function fetchCloudTasks(owner: string): Promise<Task[]> {
  if (!supabase) throw new Error('云端未配置');
  const { data, error } = await supabase.from('tasks').select('*').eq('owner', owner);
  if (error) throw new Error(error.message);
  return (data as CloudTask[]).map(fromCloud);
}

// 把本地这一整份任务推到云端，做到「云端 == 本地」。
// 思路：先按 id 删掉云端有、本地没有的（本地删了，云端也要删），再把整份 upsert 上去。
// 个人清单数据量极小，全量覆盖比逐条 diff 简单可靠，也不会漏。
export async function saveCloudTasks(tasks: Task[], owner: string): Promise<void> {
  if (!supabase) throw new Error('云端未配置');

  if (tasks.length === 0) {
    const { error } = await supabase.from('tasks').delete().eq('owner', owner);
    if (error) throw new Error(error.message);
    return;
  }

  const ids = tasks.map((t) => t.id);
  const { error: delErr } = await supabase
    .from('tasks')
    .delete()
    .eq('owner', owner)
    .not('id', 'in', `(${ids.join(',')})`);
  if (delErr) throw new Error(delErr.message);

  const { error } = await supabase.from('tasks').upsert(tasks.map((t) => toCloud(t, owner)));
  if (error) throw new Error(error.message);
}
