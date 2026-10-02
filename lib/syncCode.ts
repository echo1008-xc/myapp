import AsyncStorage from '@react-native-async-storage/async-storage';

// 同步码：你给自己设的一串字符（比如 aiKe2026）。
// 同一串码在两台设备上输入，就连到云端同一份任务 —— 这就是「多设备同步」的身份。
// 不依赖邮箱/登录，零基础也能用。
const KEY = 'myapp.syncCode';

export async function getSyncCode(): Promise<string | null> {
  const v = await AsyncStorage.getItem(KEY);
  return v && v.trim() ? v.trim() : null;
}

export async function setSyncCode(code: string): Promise<void> {
  await AsyncStorage.setItem(KEY, code.trim());
}

export async function clearSyncCode(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
