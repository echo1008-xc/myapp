// 一张「照片 + 右下角时间」的画面。
//
// 它本身平平无奇，特殊之处在于：**把它截下来，得到的就是存进相册的那张照片**。
// 也就是说时间是"烧"进图里的 —— 存到相册之后，用别的看图软件打开、发给别人，
// 时间都在，不依赖本 App。
//
// 尺寸由外面传进来（width/height），因为这块画面一会儿要缩到屏幕上给用户看，
// 一会儿要按原比例截成文件，两处的尺寸不一样但比例必须一致。

import { forwardRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

// 水印字号 = 画面宽度的这个比例。
// 用比例而不是写死的数字：不管外面传多大的尺寸进来，水印看起来都一样大。
const FONT_RATIO = 0.038;
// 水印离底边、右边的距离，同样按宽度算。
const PAD_RATIO = 0.026;

export type StampPhotoProps = {
  uri: string;
  width: number;
  height: number;
  text: string;
  // 照片真的画出来了。截图必须等这一刻 —— 早一帧截出来就是一块黑。
  onReady?: () => void;
  // 这张照片读不出来了（被系统清掉、文件坏了）。
  onFailed?: () => void;
};

export const StampPhoto = forwardRef<View, StampPhotoProps>(function StampPhoto(
  { uri, width, height, text, onReady, onFailed },
  ref,
) {
  const fontSize = Math.max(10, Math.round(width * FONT_RATIO));
  const pad = Math.max(6, Math.round(width * PAD_RATIO));

  return (
    // collapsable={false} 不能省：安卓上如果一个 View 没有任何"值得渲染"的属性，
    // RN 会把它从原生视图树里抹掉（叫"视图扁平化"）—— 抹掉之后截图就找不到它了。
    <View ref={ref} collapsable={false} style={[styles.box, { width, height }]}>
      <Image
        source={{ uri }}
        style={{ width, height }}
        // 这块画面的宽高就是按这张图的比例算出来的，所以 cover 和 contain
        // 结果一样 —— 都不会裁、也都不会留白。用 cover 是防止凑整时差一像素露底。
        resizeMode="cover"
        // ⛔ fadeDuration={0} 不能省 —— 它是「拍出来照片全黑」这个 bug 的解药。
        // （2026-09-28 查出：艾可看到原照彩色闪 0.1 秒后就变黑。）
        // 安卓上那张照片会**淡入**（ReactImageView 对 file:// 默认约 300ms 淡入），
        // 而下面的 onLoad 是在淡入**刚开始**时就触发的 —— 我们紧接着截图，
        // 截到的是只有约 4% 不透明度的照片：存进相册、显示出来自然几乎全黑。
        // （白字水印不淡入，所以它一直是清楚的 —— 这正是"能亮字、黑照片"的原因。）
        // 设成 0：照片一到位就是全不透明，截到的就是完整照片，不再靠"等一帧"赌运气。
        fadeDuration={0}
        onLoad={onReady}
        onError={onFailed}
      />
      {/* 白字 + 一圈黑影。为什么要黑影：食堂餐盘是白的，光写白字直接看不见。
          黑影让它在白的、黑的、花的背景上都能读。 */}
      {/* text 为空就不渲染水印：相机已自带时间水印时，App 不再叠一层 */}
      {text ? (
        <Text
          style={[
            styles.stamp,
            {
              fontSize,
              right: pad,
              bottom: pad,
              textShadowRadius: Math.round(fontSize * 0.32),
              textShadowOffset: { width: 0, height: Math.round(fontSize * 0.08) },
            },
          ]}
        >
          {text}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    // 万一照片还没画出来，露出来的是黑底，不是刺眼的白。
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  stamp: {
    position: 'absolute',
    color: '#FFFFFF',
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
  },
});
