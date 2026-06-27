export interface LrcWord {
  word: string;
  start: number; // 绝对时间，秒
  end: number;   // 绝对时间，秒
  duration: number; // 持续时间，秒
}

export interface LrcLine {
  time: number;     // 行开始时间，秒
  endTime: number;   // 行结束时间，秒
  text: string;     // 纯文本
  words: LrcWord[]; // 逐字列表
}

/**
 * 将 mm:ss.xx 或 mm:ss.xxx 格式的时间字符串解析为秒数
 */
export function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length < 2) return 0;
  const mins = parseFloat(parts[0]);
  const secs = parseFloat(parts[1]);
  if (isNaN(mins) || isNaN(secs)) return 0;
  return mins * 60 + secs;
}

/**
 * 解析歌词文件内容，自动兼容普通 LRC 歌词和带有 `<mm:ss.xxx>` 的逐字歌词
 */
export function parseLrc(lrcContent: string, audioDuration: number = 0): LrcLine[] {
  const lines = lrcContent.split(/\r?\n/);
  const result: LrcLine[] = [];
  
  // 匹配行头时间戳，如 [00:25.860] 或 [00:25.86]
  const lineTimeRegex = /^\[(\d{2,}:\d{2}(?:\.\d{2,3})?)\]/;

  for (let lineText of lines) {
    lineText = lineText.trim();
    if (!lineText) continue;

    const timeMatch = lineText.match(lineTimeRegex);
    if (!timeMatch) {
      // 过滤掉如 [by:xxx], [offset:0] 等元信息行
      continue;
    }

    const lineStartTime = parseTimeToSeconds(timeMatch[1]);
    // 去掉时间戳头，只保留歌词内容部分
    const contentPart = lineText.replace(lineTimeRegex, '').trim();

    // 判断是否包含逐字绝对时间戳，形如 <00:25.860>我<00:26.160>怕
    const hasWordTimestamps = /<\d{2,}:\d{2}(?:\.\d{2,3})?>/.test(contentPart);

    if (hasWordTimestamps) {
      // 逐字歌词解析
      // 正则匹配类似 `<00:25.860>我` 或 `<00:25.860>`（后面没有字）
      // 使用 split 结合正则提取出所有的时间戳标记和中间的文本
      const matches: { time: number; text: string }[] = [];
      const tagRegex = /<(\d{2,}:\d{2}(?:\.\d{2,3})?)>([^<]*)/g;
      let match;
      
      while ((match = tagRegex.exec(contentPart)) !== null) {
        matches.push({
          time: parseTimeToSeconds(match[1]),
          text: match[2] || ''
        });
      }

      if (matches.length > 0) {
        const words: LrcWord[] = [];
        let plainText = '';
        
        for (let i = 0; i < matches.length; i++) {
          const curr = matches[i];
          const next = matches[i + 1];
          // 如果下一个时间戳存在，则当前字的结束时间就是下一个的开始时间；
          // 否则，该句最后一个字的结束时间暂定为最后那个闭合时间戳（即 matches 中最后一个没有文本的项的开始时间），或者默认加一个时长。
          const wordEnd = next ? next.time : (curr.time + 0.3);
          const duration = Math.max(0.01, wordEnd - curr.time);

          // 只有当有实际字符时，才放入 words 列表中（剔除掉纯静音时间标签）
          if (curr.text) {
            words.push({
              word: curr.text,
              start: curr.time,
              end: wordEnd,
              duration: duration
            });
            plainText += curr.text;
          }
        }

        // 行结束时间为最后一个时间戳的开始时间
        const lineEndTime = matches[matches.length - 1]?.time || lineStartTime + 1;

        result.push({
          time: lineStartTime,
          endTime: lineEndTime,
          text: plainText,
          words: words
        });
      }
    } else {
      // 普通行级歌词解析 (不做逐字，仅有行时间)
      result.push({
        time: lineStartTime,
        endTime: lineStartTime + 1, // 占位，下一行时更新
        text: contentPart,
        words: []
      });
    }
  }

  // 排序，保证时间单调递增
  result.sort((a, b) => a.time - b.time);

  // 补齐和修正各句歌词的 endTime，并对普通行级歌词做逐字等分处理
  for (let i = 0; i < result.length; i++) {
    const current = result[i];
    const next = result[i + 1];
    
    // 更新 endTime
    if (next) {
      current.endTime = next.time;
    } else {
      current.endTime = audioDuration > current.time ? audioDuration : current.time + 4.0;
    }

    // 如果是普通歌词 (words 为空)，我们需要在前端将其做“逐字均分”
    if (current.words.length === 0 && current.text) {
      const charArray = Array.from(current.text);
      const totalDuration = current.endTime - current.time;
      const charDuration = Math.max(0.01, totalDuration / charArray.length);
      const words: LrcWord[] = [];

      for (let j = 0; j < charArray.length; j++) {
        const char = charArray[j];
        const start = current.time + j * charDuration;
        const end = start + charDuration;
        words.push({
          word: char,
          start: start,
          end: end,
          duration: charDuration
        });
      }
      current.words = words;
    }
  }

  return result;
}
