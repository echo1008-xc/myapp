import { useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '../lib/theme';
import { downloadApk, installApk, type DownloadProgressInfo } from '../lib/update/installer';
import { setSkippedVersionCode } from '../lib/update/skip';
import type { ReleaseInfo } from '../lib/update/types';

type Props = {
  visible: boolean;
  release: ReleaseInfo | null;
  onClose: () => void;
};

// 这个小弹窗的四个阶段，界面按它切显示。
type Phase = 'idle' | 'downloading' | 'installing' | 'failed';

// 把底层抛出的英文错误翻译成人话。
// 直接把 "FileSystem.downloadFileAsync has been rejected" 摆给用户看，
// 等于什么都没说 —— 用户既不知道是谁的错，也不知道下一步该干嘛。
function friendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');

  // 服务器回了明确的状态码 —— 这是安装包那边的问题，不是手机的问题。
  const code = raw.match(/status:\s*(\d{3})/);
  if (code) {
    const n = Number(code[1]);
    if (n === 400 || n === 403 || n === 404) {
      return (
        `云端还没放好这个安装包（服务器回复 ${n}）。\n` +
        '这不是你手机的问题。等安装包上传好之后再点「立即更新」。'
      );
    }
    return `下载被服务器拒绝了（${n}）。过一会儿再试一次。`;
  }

  // 根本没连上服务器。
  if (/network|timeout|timed out|unable to resolve|connection|socket/i.test(raw)) {
    return '网络好像不太通。换个网（比如切到数据流量）再点一次。';
  }

  return '下载没成功：' + raw;
}

// 发现新版本时弹出来的卡片：下载 → 交给系统安装界面。
// 全程不需要用户离开 App 去浏览器找安装包。
export default function UpdateSheet({ visible, release, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<DownloadProgressInfo | null>(null);
  const [errMsg, setErrMsg] = useState('');

  const reset = () => {
    setPhase('idle');
    setProgress(null);
    setErrMsg('');
  };

  const busy = phase === 'downloading' || phase === 'installing';

  // 用户主动关掉（稍后 / 关掉 / 安卓返回键）= 他知道了，但现在不想装。
  // 记下来，免得每次开 App 都为同一个版本再弹一次。
  const close = () => {
    if (busy) {
      return; // 正在下载/安装，先别让它关掉
    }
    if (release) {
      void setSkippedVersionCode(release.versionCode);
    }
    reset();
    onClose();
  };

  const start = async () => {
    if (!release) {
      return;
    }
    try {
      setPhase('downloading');
      setProgress(null);
      const file = await downloadApk(release.apkUrl, setProgress);
      setPhase('installing');
      const result = await installApk(file);
      if (result === 'launched') {
        // 系统的安装界面已经顶出来了，把弹窗收掉，让用户专心装。
        // 这里不走 close()，因为「装上了」不该记成「用户跳过」。
        reset();
        onClose();
      } else {
        setErrMsg('自动打开安装界面没成功，改用浏览器下载也一样能装。');
        setPhase('failed');
      }
    } catch (e) {
      setErrMsg(friendlyError(e));
      setPhase('failed');
    }
  };

  const openInBrowser = () => {
    if (release?.apkUrl) {
      void Linking.openURL(release.apkUrl);
    }
  };

  const percent = progress?.percent;
  const pctText = typeof percent === 'number' ? `${Math.round(percent * 100)}%` : '下载中…';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.mask}>
        <View style={styles.card}>
          <Text style={styles.title}>发现新版本 {release?.version ?? ''}</Text>

          {release?.notes ? <Text style={styles.notes}>{release.notes}</Text> : null}

          {phase === 'idle' ? (
            <>
              <Text style={styles.hint}>
                更新不会动你的任务数据，装完直接接着用。{'\n'}
                第一次更新时，系统会问一句「是否允许安装应用」，选允许就行。
              </Text>
              <View style={styles.btnRow}>
                <Pressable style={[styles.btn, styles.btnMain]} onPress={start}>
                  <Text style={styles.btnMainText}>立即更新</Text>
                </Pressable>
                {release?.force ? null : (
                  <Pressable style={[styles.btn, styles.btnGhost]} onPress={close}>
                    <Text style={styles.btnGhostText}>稍后</Text>
                  </Pressable>
                )}
              </View>
            </>
          ) : null}

          {busy ? (
            <View style={styles.progressBox}>
              <View style={styles.track}>
                <View
                  style={[styles.fill, { width: `${typeof percent === 'number' ? percent * 100 : 30}%` }]}
                />
              </View>
              <View style={styles.progressRow}>
                <Text style={styles.progressText}>
                  {phase === 'installing' ? '正在打开安装界面…' : pctText}
                </Text>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
              <Text style={styles.hint}>
                {phase === 'installing' ? '马上会弹出系统的安装确认框' : '装完前先别退出 App'}
              </Text>
            </View>
          ) : null}

          {phase === 'failed' ? (
            <>
              <Text style={styles.err}>{errMsg}</Text>
              <View style={styles.btnRow}>
                <Pressable style={[styles.btn, styles.btnMain]} onPress={openInBrowser}>
                  <Text style={styles.btnMainText}>用浏览器下载</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.btnGhost]} onPress={close}>
                  <Text style={styles.btnGhostText}>关掉</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: {
    flex: 1,
    backgroundColor: 'rgba(15, 27, 45, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  notes: {
    marginTop: space.sm,
    fontSize: 13,
    lineHeight: 21,
    color: colors.sub,
  },
  hint: {
    marginTop: space.sm,
    fontSize: 12,
    lineHeight: 19,
    color: colors.sub,
  },
  err: {
    marginTop: space.md,
    fontSize: 13,
    lineHeight: 20,
    color: colors.danger,
  },
  btnRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.md,
  },
  btn: {
    height: 42,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnMain: {
    flex: 1,
    backgroundColor: colors.accent,
  },
  btnMainText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  btnGhostText: {
    fontSize: 15,
    color: colors.sub,
  },
  progressBox: {
    marginTop: space.md,
  },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  fill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
  progressText: {
    fontSize: 13,
    color: colors.text,
  },
});
