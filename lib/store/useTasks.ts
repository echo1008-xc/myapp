import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchTasks, saveTasks } from '../api/tasks';
import { today } from '../date';
import type { Task } from '../../types/task';

// 一个页面只有这四种状态。把这四种都画出来，界面就不「半成品」了。
export type ScreenState = 'loading' | 'error' | 'empty' | 'success';

// 造 id：时间戳 + 随机尾数。个人清单够用了，不会撞车。
function newId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

// 页面逻辑的家。界面只负责显示，数据怎么来、怎么变都在这里。
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [state, setState] = useState<ScreenState>('loading');
  const [message, setMessage] = useState('');

  // 一份「影子」记录当前的列表。
  // 作用：每次改动都从这里拿最新值，不用等界面重新渲染，避免手快连点丢数据。
  const latest = useRef<Task[]>([]);

  // silent = true 用于「下拉刷新」：不切回加载态，列表不会闪一下消失。
  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setState('loading');
    }
    try {
      const data = await fetchTasks();
      latest.current = data;
      setTasks(data);
      setState(data.length === 0 ? 'empty' : 'success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '未知错误');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  // 所有改动都从这里走：先换掉手机上的列表，再整份存进手机存储。
  // 好处是「界面显示」和「存起来的数据」永远一致，不会各说各话。
  const commit = useCallback(async (next: Task[]) => {
    latest.current = next;
    setTasks(next);
    setState(next.length === 0 ? 'empty' : 'success');
    try {
      await saveTasks(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
      setState('error');
    }
  }, []);

  // 新增一条，排在最前面。
  const add = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) {
        return;
      }
      const created: Task = {
        id: newId(),
        title: trimmed,
        note: '',
        done: false,
        createdAt: today(),
        // 新增时不设截止日期，进详情页再填。
        // 少一步输入，添加这件事才够快 —— 快，你才会真的用它。
        dueDate: null,
        // 刚写下来的事，先都当普通任务。要标重要，进详情页点一下。
        important: false,
        // 新建任务默认「未分类」，颜色区分留到详情页再选。
        category: 'none',
      };
      await commit([created, ...latest.current]);
    },
    [commit],
  );

  // 勾选 / 取消勾选。
  const toggle = useCallback(
    async (id: string) => {
      await commit(latest.current.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    },
    [commit],
  );

  // 删掉一条。
  const remove = useCallback(
    async (id: string) => {
      await commit(latest.current.filter((t) => t.id !== id));
    },
    [commit],
  );

  return { tasks, state, message, reload, refresh, add, toggle, remove };
}
