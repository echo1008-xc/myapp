import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import 'react-native-url-polyfill/auto';

// 从 app.json 的 expo.extra 读取。没填就是「云端未启用」，App 自动退回本地存储，绝不崩。
const url = Constants.expoConfig?.extra?.supabaseUrl as string | undefined;
const anonKey = Constants.expoConfig?.extra?.supabaseAnonKey as string | undefined;

export const isCloudEnabled = Boolean(url && anonKey);

// 只有两边都配置了才真正建立连接；否则这里为 null，调用方一律走本地兜底。
export const supabase: SupabaseClient | null = isCloudEnabled
  ? createClient(url as string, anonKey as string, {
      auth: {
        // 这个 App 不用 Supabase 的账号登录功能（身份靠「同步码」），
        // 关掉会话持久化，既省电、也避开手机端没有 localStorage 的兼容问题。
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;
