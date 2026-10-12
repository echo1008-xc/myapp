import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import UpdateSheet from '../../components/UpdateSheet';
import { isCloudEnabled } from '../../lib/supabase';
import { clearSyncCode, getSyncCode, setSyncCode } from '../../lib/syncCode';
import {
  getWatermarkMode,
  setWatermarkMode,
  type WatermarkMode,
} from '../../lib/meal/photoSettings';
import { colors, radius, space } from '../../lib/theme';
import { checkForUpdate, getLocalVersion } from '../../lib/update/checker';
import type { ReleaseInfo } from '../../lib/update/types';

// 界面版本号（2026-10-12 hotfix）：每次推热更前升一号。设置页「App 更新」卡片里
// 显示这一行 —— 旧代码没有它，所以「看到这行 = 新代码已生效」，一眼就能确认热更到没到。
const UI_VERSION = 'v1012h';

type RowProps = {
  label: string;
  value: string;
};

const WMLABEL: Record<WatermarkMode, string> = {
  auto: '自动',
  always: '总是添加',
  never: '不添加',
};

function Row({ label, value }: RowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

// 关于页。这里没有业务，只放「我该怎么继续」的提示，方便你随时回来看。
export default function SettingsScreen() {
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'local' | 'cloud'>('loading');

  // 更新相关：release 有值就弹更新卡片；checking 控制按钮转圈；checkMsg 是检查结果一句话。
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState('');

  // 拍照时间戳策略：默认「自动」（照片自带时间就不打，没有才打）。
  const [wmMode, setWmMode] = useState<WatermarkMode>('auto');

  const local = getLocalVersion();

  // 进页面先读一次：之前设过同步码没？云端配了没？时间戳策略设过没？
  useEffect(() => {
    void (async () => {
      const c = await getSyncCode();
      setSaved(c);
      setCode(c ?? '');
      setStatus(c && isCloudEnabled ? 'cloud' : 'local');
    })();
    getWatermarkMode().then(setWmMode);
  }, []);

  const pickWm = async (m: WatermarkMode) => {
    setWmMode(m);
    await setWatermarkMode(m);
  };

  const save = async () => {
    const v = code.trim();
    if (!v) {
      return;
    }
    await setSyncCode(v);
    setSaved(v);
    setStatus(isCloudEnabled ? 'cloud' : 'local');
  };

  const clear = async () => {
    await clearSyncCode();
    setCode('');
    setSaved(null);
    setStatus('local');
  };

  const onCheckUpdate = async () => {
    setChecking(true);
    setCheckMsg('');
    const result = await checkForUpdate();
    setChecking(false);
    if (result.status === 'available') {
      setRelease(result.release);
    } else if (result.status === 'latest') {
      setCheckMsg(`已经是最新版（${result.current.version}）`);
    } else if (result.status === 'unconfigured') {
      // 这不是"已是最新"，是"云端还没有可比的信息"。
      // 以前这里报"已是最新"，会让人以为没得更新、于是就不升级了 —— 必须说清。
      setCheckMsg(
        `云端还没登记版本信息，查不出有没有新版（现在跑的是 ${result.current.version}）。` +
          '这是"还不知道"，不是"你已经最新"。',
      );
    } else if (result.status === 'disabled') {
      setCheckMsg('云端还没配置，暂时查不了');
    } else {
      setCheckMsg('没查成：' + result.message);
    }
  };

  const statusText =
    status === 'loading'
      ? '读取中…'
      : status === 'cloud'
        ? `已同步到云端（同步码：${saved}）`
        : isCloudEnabled
          ? '仅存在手机（还没设同步码）'
          : '仅存在手机（云端还没配置）';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.h2}>当前状态</Text>
      <View style={styles.card}>
        <Row label="数据来源" value={status === 'cloud' ? '云端（多设备同步）' : '存在手机里（本地存储）'} />
        <Row label="技术栈" value="Expo + React Native + TypeScript" />
        <Row label="目标平台" value="先安卓，同一套代码可扩展 iOS" />
      </View>

      <Text style={styles.h2}>App 更新</Text>
      <View style={styles.card}>
        <Row label="当前版本" value={`${local.version}（第 ${local.versionCode} 版）`} />
        <Row label="界面版本" value={UI_VERSION} />
        <Text style={styles.syncHint}>
          以后出新版本，这里点一下就能在 App 里直接下载安装，不用再去浏览器找安装包。
        </Text>
        <View style={styles.btnRow}>
          <Pressable
            style={[styles.btn, checking && styles.btnOff]}
            onPress={onCheckUpdate}
            disabled={checking}
          >
            <Text style={styles.btnText}>{checking ? '检查中…' : '检查更新'}</Text>
          </Pressable>
        </View>
        {checkMsg ? <Text style={styles.checkMsg}>{checkMsg}</Text> : null}
      </View>

      <Text style={styles.h2}>多设备同步（云端）</Text>
      <View style={styles.card}>
        <Text style={styles.syncStatus}>{statusText}</Text>
        <Text style={styles.syncHint}>
          设一个同步码（比如 aiKe2026）。在另一台设备输入同一串，任务就自动同步。
          不用注册账号、不用配邮箱。
        </Text>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          placeholder="输入同步码，例如 aiKe2026"
          placeholderTextColor={colors.sub}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={40}
        />
        <View style={styles.btnRow}>
          <Pressable
            style={[styles.btn, !code.trim() && styles.btnOff]}
            onPress={save}
            disabled={!code.trim()}
          >
            <Text style={styles.btnText}>保存同步码</Text>
          </Pressable>
          {saved ? (
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={clear}>
              <Text style={[styles.btnText, styles.btnGhostText]}>取消同步</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <Text style={styles.h2}>拍照时间戳</Text>
      <View style={styles.card}>
        <Text style={styles.syncHint}>
          如果你的相机本身就带时间水印，App 可以不再叠一个，避免一张照片出现两个时间。
        </Text>
        <Text style={styles.syncHint}>
          选「自动」：照片本身有拍摄时间就不打，没有才打（推荐）。
        </Text>
        <View style={styles.segRow}>
          {(['auto', 'always', 'never'] as const).map((m) => (
            <Pressable
              key={m}
              style={[styles.seg, wmMode === m && styles.segOn]}
              onPress={() => void pickWm(m)}
            >
              <Text style={[styles.segText, wmMode === m && styles.segTextOn]}>
                {WMLABEL[m]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={styles.h2}>你现在能做什么</Text>
      <View style={styles.card}>
        <Row label="新增" value="首页底部输入框写一条，按「添加」" />
        <Row label="勾选" value="点左边的小圆圈" />
        <Row label="找任务" value="顶部搜索框，标题和备注都会搜" />
        <Row label="筛选" value="点「全部 / 未完成 / 已完成 / 重要」，后面是各自条数" />
        <Row label="分类" value="列表顶部按「工作 / 生活 / 学习 / 紧急」筛，详情页里能改" />
        <Row label="标重要" value="详情页点「☆ 标为重要」，列表和详情页都会亮一颗星" />
        <Row label="改内容" value="点「详情」进去，按「编辑」，改完按「保存修改」" />
        <Row label="截止日期" value="详情页里点「今天 / 明天」，或手动输入 2026-09-20" />
        <Row label="删掉" value="长按一条，或在详情页点「删掉」" />
        <Row label="保存" value="改完立刻存下来（设了同步码就存到云端），杀掉 App 再打开还在" />
      </View>

      <Text style={styles.h2}>下一步做什么</Text>
      <View style={styles.card}>
        <Row label="1" value="设好同步码，在另一台设备上验证任务真的同步过去了" />
        <Row label="2" value="试试「饮食」页：拍一张餐盘，看 AI 算出的热量和糖油" />
        <Row label="3" value="以后发新版，直接在 App 里点「检查更新」就能升级" />
      </View>

      <Text style={styles.h2}>数据存在哪儿（已接云端）</Text>
      <Text style={styles.p}>
        这个 App 现在是「本地 + 云端」双轨：没设同步码时，数据只存在这台手机里；
        一设同步码，就改成读写云端（Supabase），换台设备输入同一串码就能看到同一份任务。
        两者随时可切换，设了码又会把云端当主数据源，不会丢东西。
      </Text>
      <Text style={styles.p}>
        ⚠️ 这是「玩具级」云端，表对拿到密钥的人是可读的——别往任务里写密码、身份证号这类真秘密。
      </Text>
      <Text style={styles.p}>
        第一次开启同步时，云端是空的，当前手机里的任务不会自动搬过去——
        需要你在本机随便加一条新任务（触发一次保存即把整份推上云），云端就有数据了。
      </Text>

      <Text style={styles.h2}>以后想上 iOS</Text>
      <Text style={styles.p}>
        代码不用重写。你需要的是：一台 Mac（或用云打包服务），以及苹果开发者账号（每年 99 美元）。
        在那之前，安卓这条路可以一直走下去。
      </Text>

      <UpdateSheet
        visible={release !== null}
        release={release}
        onClose={() => setRelease(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: space.md,
    gap: space.sm,
  },
  h2: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    marginTop: space.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowLabel: {
    width: 72,
    fontSize: 13,
    color: colors.sub,
  },
  rowValue: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
  },
  syncStatus: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  syncHint: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.sub,
    paddingTop: space.sm,
  },
  checkMsg: {
    fontSize: 12,
    color: colors.sub,
    paddingBottom: space.md,
  },
  input: {
    marginTop: space.md,
    height: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    fontSize: 15,
    color: colors.text,
  },
  btnRow: {
    flexDirection: 'row',
    gap: space.sm,
    paddingVertical: space.md,
  },
  btn: {
    height: 40,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOff: {
    backgroundColor: colors.line,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  btnGhostText: {
    color: colors.sub,
  },
  p: {
    fontSize: 13,
    lineHeight: 21,
    color: colors.sub,
  },
  segRow: {
    flexDirection: 'row',
    gap: space.sm,
    paddingVertical: space.md,
  },
  seg: {
    flex: 1,
    height: 38,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  segOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  segText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.sub,
  },
  segTextOn: {
    color: '#FFFFFF',
  },
});
