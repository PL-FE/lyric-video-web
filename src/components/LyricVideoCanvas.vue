<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { Icon } from '@iconify/vue'
import { parseLrc, type LrcLine } from '../utils/lrcParser'
import { VideoRecorder } from '../utils/VideoRecorder'

// ——— 音频和歌词文件状态 ———
const audioFile = ref<File | null>(null)
const lrcFile = ref<File | null>(null)
const bgImageFile = ref<File | null>(null)

const audioUrl = ref<string>('')
const lrcContent = ref<string>('')
const lrcLines = ref<LrcLine[]>([])

// ——— 画面配置参数（自动保存到 LocalStorage） ———
const bgColor = ref('#111827') // 深色夜空背景
const textFont = ref('sans-serif')
const fontSize = ref(60)
const sungColor = ref('#f43f5e') // 玫瑰粉红
const unsungColor = ref('#ffffff') // 纯白
const strokeColor = ref('#000000') // 黑色描边
const strokeWidth = ref(4)
const resolution = ref('1280x720') // 默认 720P

// 辅助状态
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const isRecording = ref(false)
const recordProgress = ref(0)
const isAudioLoaded = ref(false)
const showNotification = ref(false)
const notificationText = ref('')

// ——— DOM & 绘图句柄 ———
const audioRef = ref<HTMLAudioElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
let animationFrameId: number | null = null

// 背景图缓存
let bgImageElement: HTMLImageElement | null = null

// ——— Web Audio API 句柄 (用于音频波形图和录制) ———
let audioCtx: AudioContext | null = null
let audioSourceNode: MediaElementAudioSourceNode | null = null
let analyserNode: AnalyserNode | null = null
let mediaStreamDest: MediaStreamAudioDestinationNode | null = null
let gainNode: GainNode | null = null

const resolutionOptions = [
  { label: '横屏 720P (1280×720)', value: '1280x720' },
  { label: '横屏 1080P (1920×1080)', value: '1920x1080' },
  { label: '竖屏 720P (720×1280)', value: '720x1280' }
]

// 根据分辨率计算 Canvas 的实际高宽
const canvasWidth = computed(() => {
  const [w] = resolution.value.split('x')
  return parseInt(w) || 1280
})
const canvasHeight = computed(() => {
  const [, h] = resolution.value.split('x')
  return parseInt(h) || 720
})

// ——— 消息提示工具 ———
function notify(text: string) {
  notificationText.value = text
  showNotification.value = true
  setTimeout(() => {
    showNotification.value = false
  }, 3000)
}

// ——— 文件上传处理 ———
function onAudioUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    audioFile.value = file
    audioUrl.value = URL.createObjectURL(file)
    isAudioLoaded.value = false
    isPlaying.value = false
    currentTime.value = 0
    notify(`歌曲导入成功: ${file.name}`)
  }
}

async function onLrcUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    lrcFile.value = file
    const text = await file.text()
    lrcContent.value = text
    lrcLines.value = parseLrc(text, duration.value)
    notify(`歌词导入成功，解析出 ${lrcLines.value.length} 行歌词`)
  }
}

function onBgImageUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    bgImageFile.value = file
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        bgImageElement = img
        drawFrame() // 重绘
        notify('背景图片载入成功')
      };
      img.src = e.target?.result as string
    };
    reader.readAsDataURL(file)
  }
}

function clearBgImage() {
  bgImageFile.value = null
  bgImageElement = null
  drawFrame()
  notify('背景图片已清除')
}

// ——— Web Audio 初始化 ———
function initWebAudio() {
  if (audioCtx || !audioRef.value) return
  
  // 1. 创建 AudioContext
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
  audioCtx = new AudioContextClass()
  
  // 2. 创建音频源节点
  audioSourceNode = audioCtx.createMediaElementSource(audioRef.value)
  
  // 3. 创建波形分析节点
  analyserNode = audioCtx.createAnalyser()
  analyserNode.fftSize = 256
  
  // 4. 创建增益节点(用于静音录制)
  gainNode = audioCtx.createGain()
  
  // 5. 创建录制流输出节点
  mediaStreamDest = audioCtx.createMediaStreamDestination()
  
  // 6. 连接路由
  // audioSourceNode -> analyserNode -> gainNode -> audioCtx.destination (扬声器)
  // 同时连接到 mediaStreamDest (录制器)
  audioSourceNode.connect(analyserNode)
  analyserNode.connect(gainNode)
  gainNode.connect(audioCtx.destination)
  
  audioSourceNode.connect(mediaStreamDest)
}

// ——— 音频回调 ———
function onAudioLoadedMetadata() {
  if (!audioRef.value) return
  duration.value = audioRef.value.duration
  isAudioLoaded.value = true
  // 此时重新解析歌词，传入总时长
  if (lrcContent.value) {
    lrcLines.value = parseLrc(lrcContent.value, duration.value)
  }
}

function onAudioTimeUpdate() {
  if (!audioRef.value) return
  currentTime.value = audioRef.value.currentTime
  drawFrame()
}

// ——— 播放控制 ———
function togglePlay() {
  if (!audioRef.value || !isAudioLoaded.value) {
    notify('请先上传音频文件')
    return
  }
  
  // 激活 AudioContext
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume()
  } else {
    initWebAudio()
  }

  if (isPlaying.value) {
    audioRef.value.pause()
    isPlaying.value = false
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
  } else {
    audioRef.value.play()
    isPlaying.value = true
    loop()
  }
}

function seekAudio(event: Event) {
  const target = event.target as HTMLInputElement
  const time = parseFloat(target.value)
  if (audioRef.value) {
    audioRef.value.currentTime = time
    currentTime.value = time
    drawFrame()
  }
}

// 循环渲染帧
function loop() {
  if (!isPlaying.value && !isRecording.value) return
  if (audioRef.value) {
    currentTime.value = audioRef.value.currentTime
  }
  drawFrame()
  animationFrameId = requestAnimationFrame(loop)
}

// ——— 核心 Canvas 绘制逻辑 ———
function drawFrame() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const W = canvas.width
  const H = canvas.height

  // 1. 绘制背景
  ctx.clearRect(0, 0, W, H)
  if (bgImageElement) {
    // 铺满剪裁绘制 (Cover)
    const imgRatio = bgImageElement.width / bgImageElement.height
    const canvasRatio = W / H
    let dw, dh, dx, dy
    if (imgRatio > canvasRatio) {
      dh = H
      dw = H * imgRatio
      dx = (W - dw) / 2
      dy = 0
    } else {
      dw = W
      dh = W / imgRatio
      dx = 0
      dy = (H - dh) / 2
    }
    ctx.drawImage(bgImageElement, dx, dy, dw, dh)
    
    // 加一层半透明黑色蒙版让歌词更清晰
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.fillRect(0, 0, W, H)
  } else {
    // 纯色背景
    ctx.fillStyle = bgColor.value
    ctx.fillRect(0, 0, W, H)
  }

  // 2. 绘制音频波形起伏线
  if (analyserNode) {
    const bufferLength = analyserNode.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    analyserNode.getByteFrequencyData(dataArray)

    ctx.lineWidth = 3
    ctx.strokeStyle = `rgba(244, 63, 94, 0.35)` // 半透明玫瑰粉
    ctx.beginPath()

    const sliceWidth = (W * 0.8) / bufferLength
    const startX = W * 0.1
    let x = startX
    const yCenter = H * 0.8 // 在画面中下部绘制

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0
      // 算出波形起伏值
      const yOffset = (v - 1.0) * 80 * Math.sin((i / bufferLength) * Math.PI) // 两侧收窄，中部隆起
      
      if (i === 0) {
        ctx.moveTo(x, yCenter + yOffset)
      } else {
        ctx.lineTo(x, yCenter + yOffset)
      }
      x += sliceWidth
    }
    ctx.lineTo(W * 0.9, yCenter)
    ctx.stroke()
  }

  // 3. 绘制歌词 (三行滚动模式)
  if (lrcLines.value.length === 0) {
    // 无歌词时展示提示文字
    ctx.font = `italic bold 44px ${textFont.value}`
    ctx.fillStyle = '#9ca3af'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('上传歌曲和歌词，在此预览效果', W / 2, H / 2)
    return
  }

  const timeNow = currentTime.value
  
  // 查找当前应该播放的歌词行索引
  let currentIdx = -1
  for (let i = 0; i < lrcLines.value.length; i++) {
    const line = lrcLines.value[i]
    if (timeNow >= line.time && timeNow < line.endTime) {
      currentIdx = i
      break
    }
  }

  // 如果没有正好匹配的，寻找最接近的前一行
  if (currentIdx === -1) {
    for (let i = lrcLines.value.length - 1; i >= 0; i--) {
      if (timeNow >= lrcLines.value[i].time) {
        currentIdx = i
        break
      }
    }
  }

  // 如果连前一行都没找到，就展示第一行
  if (currentIdx === -1) {
    currentIdx = 0
  }

  const gap = fontSize.value * 1.6
  const centerY = H / 2

  // 绘制上一行歌词
  if (currentIdx > 0) {
    const prevLine = lrcLines.value[currentIdx - 1]
    drawStaticLine(ctx, prevLine.text, W / 2, centerY - gap, fontSize.value * 0.75, 'rgba(255, 255, 255, 0.4)')
  }

  // 绘制当前行歌词 (核心：卡拉OK逐字亮起扫光效果)
  const currLine = lrcLines.value[currentIdx]
  drawKaraokeLine(ctx, currLine, W / 2, centerY, fontSize.value, timeNow)

  // 绘制下一行歌词
  if (currentIdx + 1 < lrcLines.value.length) {
    const nextLine = lrcLines.value[currentIdx + 1]
    drawStaticLine(ctx, nextLine.text, W / 2, centerY + gap, fontSize.value * 0.75, 'rgba(255, 255, 255, 0.55)')
  }
}

// 辅助方法：绘制普通静态歌词行 (带描边)
function drawStaticLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fSize: number, color: string) {
  ctx.font = `bold ${fSize}px ${textFont.value}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // 描边
  if (strokeWidth.value > 0) {
    ctx.strokeStyle = strokeColor.value
    ctx.lineWidth = strokeWidth.value * (fSize / fontSize.value) // 依比例缩小描边
    ctx.strokeText(text, x, y)
  }

  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

// 辅助方法：绘制卡拉OK扫光逐字变色行
function drawKaraokeLine(ctx: CanvasRenderingContext2D, line: LrcLine, x: number, y: number, fSize: number, timeNow: number) {
  const text = line.text
  ctx.font = `bold ${fSize}px ${textFont.value}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // 1. 测量整行文字的总像素宽度，以便计算起始绘制 x 点 (因为 textAlign = 'center')
  const totalWidth = ctx.measureText(text).width
  const startX = x - totalWidth / 2

  // 2. 首先渲染底层“未唱完”颜色的整行文字 (带描边)
  if (strokeWidth.value > 0) {
    ctx.strokeStyle = strokeColor.value
    ctx.lineWidth = strokeWidth.value
    ctx.strokeText(text, x, y)
  }
  ctx.fillStyle = unsungColor.value
  ctx.fillText(text, x, y)

  // 3. 计算已唱文字的像素宽度 W_sung
  let sungWidth = 0
  
  for (const word of line.words) {
    const wordWidth = ctx.measureText(word.word).width
    
    if (timeNow >= word.end) {
      // 字唱完了，加上完整宽度
      sungWidth += wordWidth
    } else if (timeNow >= word.start) {
      // 字正在唱，按时间比例计算当前字内部的扫光进度
      const progress = (timeNow - word.start) / word.duration
      sungWidth += wordWidth * progress
      break // 后面字都还没唱到，停止累加
    } else {
      break
    }
  }

  // 4. 如果已唱宽度大于 0，则把对应宽度的区域剪裁出来，并在里面用“已唱”颜色二次渲染
  if (sungWidth > 0) {
    ctx.save()
    ctx.beginPath()
    
    // 裁剪矩形范围 (覆盖从 startX 开始，宽度为 sungWidth 的左侧唱过区域)
    // 高度需完全包裹文字层
    ctx.rect(startX, y - fSize, sungWidth, fSize * 2)
    ctx.clip()

    // 重新在相同位置以亮色绘制文字层 (同样需要包含描边，覆盖之前的黑色描边以防止锯齿)
    if (strokeWidth.value > 0) {
      ctx.strokeStyle = strokeColor.value
      ctx.lineWidth = strokeWidth.value
      ctx.strokeText(text, x, y)
    }
    ctx.fillStyle = sungColor.value
    ctx.fillText(text, x, y)

    ctx.restore()
  }
}

// ——— 核心合成录制逻辑 ———
async function startRecording() {
  if (!audioRef.value || !isAudioLoaded.value) {
    notify('请上传音频文件后再进行合成')
    return
  }
  if (lrcLines.value.length === 0) {
    notify('请上传歌词文件后再进行合成')
    return
  }

  // 1. 初始化 Web Audio 环境
  initWebAudio()
  if (audioCtx && audioCtx.state === 'suspended') {
    await audioCtx.resume()
  }

  // 2. 进入录制状态
  isRecording.value = true
  isPlaying.value = false
  recordProgress.value = 0

  // 3. 重置音频播放状态
  audioRef.value.pause()
  audioRef.value.currentTime = 0
  currentTime.value = 0

  // 4. 将扬声器的输出音量调整为 0 (录制静音合成，体验极佳，防止录制时环境嘈杂)
  if (gainNode) gainNode.gain.value = 0

  // 5. 实例化录制引擎
  if (!canvasRef.value || !mediaStreamDest) return
  const recorder = new VideoRecorder(canvasRef.value, mediaStreamDest.stream)
  
  // 6. 启动录制和音频播放
  recorder.start()
  audioRef.value.play()
  isPlaying.value = true
  loop()

  // 7. 进度条监控轮询
  const progressTimer = setInterval(() => {
    if (audioRef.value) {
      const pct = Math.min(100, Math.floor((audioRef.value.currentTime / duration.value) * 100))
      recordProgress.value = pct
    }
  }, 300)

  // 8. 监听音频播放结束，触发保存
  audioRef.value.onended = async () => {
    clearInterval(progressTimer)
    isPlaying.value = false
    
    // 停止录制并生成 Blob
    const videoBlob = await recorder.stop()
    isRecording.value = false
    
    // 恢复扬声器音量
    if (gainNode) gainNode.gain.value = 1

    // 触发浏览器下载
    const ext = recorder.getFileExtension()
    const url = URL.createObjectURL(videoBlob)
    const a = document.createElement('a')
    a.href = url
    
    // 以歌曲名命名
    const songName = audioFile.value ? audioFile.value.name.replace(/\.[^.]+$/, '') : 'lyric_video'
    a.download = `${songName}_karaoke.${ext}`
    a.click()

    notify('视频合成完成，已触发下载！')
    
    // 清空 onended 监听器
    if (audioRef.value) audioRef.value.onended = null
  }
}

// 监听分辨率发生变化，重绘画面
watch([resolution, bgColor], () => {
  setTimeout(() => {
    drawFrame()
  }, 10)
})

onMounted(() => {
  drawFrame()
})

onUnmounted(() => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId)
  if (audioCtx) audioCtx.close()
})
</script>

<template>
  <div class="max-w-6xl w-full mx-auto px-4 py-8 box-border flex flex-col gap-8 animate-fade-in">
    <!-- 浮动顶部通知提示 -->
    <Transition name="fade">
      <div v-if="showNotification" class="fixed top-6 left-1/2 transform -translate-x-1/2 bg-rose-500 text-white font-bold px-6 py-3 rounded-full shadow-lg z-50 flex items-center gap-2">
        <Icon icon="solar:info-circle-bold" />
        {{ notificationText }}
      </div>
    </Transition>

    <!-- 顶部标题 -->
    <div class="flex items-center gap-4">
      <div class="w-14 h-14 rounded-2xl bg-gradient-to-tr from-rose-500 to-orange-500 flex items-center justify-center shadow-lg text-white text-3xl shadow-rose-500/20">
        <Icon icon="solar:videocamera-record-bold-duotone" />
      </div>
      <div>
        <h1 class="text-2xl md:text-3xl font-black text-slate-100 tracking-tight">Lyric Video Maker MVP</h1>
        <p class="text-slate-400 text-xs md:text-sm mt-1">本地上传歌曲和歌词，极速测试卡拉OK扫光及视频压制合成效果</p>
      </div>
    </div>

    <!-- 主工作区两栏布局 -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      
      <!-- 左栏：控制面板 (4格) -->
      <div class="lg:col-span-5 flex flex-col gap-6">
        
        <!-- 卡片 1：素材上传 -->
        <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-md">
          <h2 class="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
            <Icon icon="solar:folder-open-bold-duotone" class="text-rose-500" />
            第一步：上传音频与歌词
          </h2>
          
          <div class="flex flex-col gap-4">
            <!-- 歌曲上传 -->
            <div>
              <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">1. 上传音频 (.mp3/Wav)</label>
              <div class="relative border-2 border-dashed border-slate-700 hover:border-rose-500/50 rounded-2xl p-4 flex flex-col items-center justify-center transition-all bg-slate-950/50 cursor-pointer overflow-hidden group">
                <input type="file" accept="audio/*" @change="onAudioUpload" class="absolute inset-0 opacity-0 cursor-pointer" />
                <Icon icon="solar:music-library-bold-duotone" class="text-3xl text-slate-500 group-hover:text-rose-400 transition-colors mb-2" />
                <span class="text-sm font-semibold text-slate-300 truncate max-w-full">
                  {{ audioFile ? audioFile.name : '点击选择或拖入音频文件' }}
                </span>
              </div>
            </div>

            <!-- 歌词上传 -->
            <div>
              <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">2. 上传歌词 (.lrc)</label>
              <div class="relative border-2 border-dashed border-slate-700 hover:border-rose-500/50 rounded-2xl p-4 flex flex-col items-center justify-center transition-all bg-slate-950/50 cursor-pointer overflow-hidden group">
                <input type="file" accept=".lrc" @change="onLrcUpload" class="absolute inset-0 opacity-0 cursor-pointer" />
                <Icon icon="solar:document-text-bold-duotone" class="text-3xl text-slate-500 group-hover:text-rose-400 transition-colors mb-2" />
                <span class="text-sm font-semibold text-slate-300 truncate max-w-full">
                  {{ lrcFile ? lrcFile.name : '点击选择或拖入歌词文件' }}
                </span>
              </div>
            </div>

            <!-- 背景图上传 (可选) -->
            <div>
              <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">3. 自定义背景图片 (可选)</label>
              <div class="flex gap-2">
                <div class="relative flex-1 border-2 border-dashed border-slate-700 hover:border-rose-500/50 rounded-2xl p-4 flex flex-col items-center justify-center transition-all bg-slate-950/50 cursor-pointer overflow-hidden group">
                  <input type="file" accept="image/*" @change="onBgImageUpload" class="absolute inset-0 opacity-0 cursor-pointer" />
                  <Icon icon="solar:gallery-bold-duotone" class="text-3xl text-slate-500 group-hover:text-rose-400 transition-colors mb-2" />
                  <span class="text-sm font-semibold text-slate-300 truncate max-w-full">
                    {{ bgImageFile ? bgImageFile.name : '上传背景大图' }}
                  </span>
                </div>
                <button v-if="bgImageFile" @click="clearBgImage" class="w-12 rounded-2xl bg-slate-950 border border-slate-700 hover:bg-rose-950/30 hover:border-rose-900 transition-all flex items-center justify-center text-rose-400">
                  <Icon icon="solar:trash-bin-trash-bold" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 卡片 2：设计配置 -->
        <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-md">
          <h2 class="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
            <Icon icon="solar:settings-bold-duotone" class="text-rose-500" />
            第二步：定制卡拉OK视觉样式
          </h2>

          <div class="flex flex-col gap-4">
            <!-- 背景颜色 (如果无背景图) -->
            <div v-if="!bgImageFile" class="flex justify-between items-center bg-slate-950/30 p-3 rounded-xl border border-slate-800">
              <span class="text-sm font-semibold text-slate-300">纯色背景色</span>
              <input type="color" v-model="bgColor" class="w-12 h-8 rounded border-0 bg-transparent cursor-pointer" />
            </div>

            <!-- 字号滑块 -->
            <div class="flex flex-col gap-2">
              <div class="flex justify-between text-sm font-semibold text-slate-300">
                <span>歌词大小</span>
                <span class="text-rose-400 font-bold">{{ fontSize }}px</span>
              </div>
              <input type="range" min="30" max="100" v-model.number="fontSize" @input="drawFrame" class="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-500" />
            </div>

            <!-- 描边粗细滑块 -->
            <div class="flex flex-col gap-2">
              <div class="flex justify-between text-sm font-semibold text-slate-300">
                <span>字体描边粗细</span>
                <span class="text-rose-400 font-bold">{{ strokeWidth }}px</span>
              </div>
              <input type="range" min="0" max="10" v-model.number="strokeWidth" @input="drawFrame" class="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-500" />
            </div>

            <!-- 颜色选取器双列 -->
            <div class="grid grid-cols-2 gap-4">
              <div class="flex flex-col gap-1.5">
                <span class="text-xs font-semibold text-slate-400 uppercase">未唱文字颜色</span>
                <div class="flex items-center gap-2 bg-slate-950/30 p-2 rounded-xl border border-slate-800">
                  <input type="color" v-model="unsungColor" @input="drawFrame" class="w-8 h-8 rounded border-0 bg-transparent cursor-pointer" />
                  <span class="text-xs font-mono text-slate-300">{{ unsungColor.toUpperCase() }}</span>
                </div>
              </div>
              <div class="flex flex-col gap-1.5">
                <span class="text-xs font-semibold text-slate-400 uppercase">已唱扫光颜色</span>
                <div class="flex items-center gap-2 bg-slate-950/30 p-2 rounded-xl border border-slate-800">
                  <input type="color" v-model="sungColor" @input="drawFrame" class="w-8 h-8 rounded border-0 bg-transparent cursor-pointer" />
                  <span class="text-xs font-mono text-slate-300">{{ sungColor.toUpperCase() }}</span>
                </div>
              </div>
            </div>

            <!-- 导出分辨率 -->
            <div class="flex flex-col gap-2">
              <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider">输出视频分辨率</label>
              <select v-model="resolution" class="w-full bg-slate-950 text-slate-300 rounded-2xl border border-slate-800 p-3 outline-none focus:border-rose-500/50 cursor-pointer">
                <option v-for="opt in resolutionOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>
          </div>
        </div>

      </div>

      <!-- 右栏：画幅视口 & 压制区 (8格) -->
      <div class="lg:col-span-7 flex flex-col gap-6">
        
        <!-- Canvas 视口区域 -->
        <div class="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-md flex flex-col gap-4">
          <div class="relative w-full aspect-video rounded-2xl overflow-hidden bg-black border border-slate-850 flex items-center justify-center">
            <canvas 
              ref="canvasRef" 
              :width="canvasWidth" 
              :height="canvasHeight" 
              class="w-full h-full object-contain max-h-[480px]"
            ></canvas>

            <!-- 录制遮罩与进度条 -->
            <div v-if="isRecording" class="absolute inset-0 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center p-8 z-20">
              <div class="relative w-24 h-24 flex items-center justify-center mb-6">
                <!-- 旋转雷达动画 -->
                <div class="absolute inset-0 rounded-full border-4 border-rose-500/20 border-t-rose-500 animate-spin"></div>
                <Icon icon="solar:videocamera-record-bold-duotone" class="text-4xl text-rose-500 animate-pulse" />
              </div>
              <h3 class="text-lg font-black text-slate-100 tracking-wide mb-2">正在合成并导出视频文件...</h3>
              <p class="text-xs text-slate-400 text-center mb-6 max-w-sm">正在抓取 Canvas 高清画面并录制音频，请保持在此标签页，请勿关闭或切入后台</p>
              
              <!-- 进度条 -->
              <div class="w-full max-w-md bg-slate-850 h-3 rounded-full overflow-hidden mb-2">
                <div class="bg-gradient-to-r from-rose-500 to-orange-500 h-full rounded-full transition-all duration-300" :style="{ width: `${recordProgress}%` }"></div>
              </div>
              <span class="text-sm font-mono font-bold text-rose-400">{{ recordProgress }}%</span>
            </div>
          </div>

          <!-- 音频播放器 (隐式，用于触发 Web Audio Source) -->
          <audio 
            ref="audioRef" 
            :src="audioUrl" 
            @loadedmetadata="onAudioLoadedMetadata"
            @timeupdate="onAudioTimeUpdate"
            class="hidden"
          ></audio>

          <!-- 播放进度与拉条 -->
          <div v-if="isAudioLoaded" class="flex flex-col gap-3 p-2 bg-slate-950/30 rounded-2xl border border-slate-850">
            <div class="flex items-center gap-4">
              <!-- 播放/暂停按钮 -->
              <button 
                @click="togglePlay" 
                class="w-12 h-12 rounded-full bg-rose-500 hover:bg-rose-600 active:scale-95 text-white flex items-center justify-center shadow-md transition-all flex-shrink-0"
              >
                <Icon :icon="isPlaying ? 'solar:pause-bold' : 'solar:play-bold'" class="text-xl" />
              </button>

              <!-- 时间拉条 -->
              <input 
                type="range" 
                min="0" 
                :max="duration" 
                :value="currentTime" 
                @input="seekAudio"
                class="flex-1 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-500" 
              />
              
              <!-- 时间文本 -->
              <div class="text-xs font-mono text-slate-400 flex-shrink-0">
                <span>{{ Math.floor(currentTime / 60) }}:{{ String(Math.floor(currentTime % 60)).padStart(2, '0') }}</span>
                <span class="mx-1">/</span>
                <span>{{ Math.floor(duration / 60) }}:{{ String(Math.floor(duration % 60)).padStart(2, '0') }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 压制合成启动按钮 -->
        <button
          @click="startRecording"
          :disabled="isRecording || !isAudioLoaded || lrcLines.length === 0"
          class="w-full h-16 rounded-3xl bg-gradient-to-r from-rose-500 to-orange-500 hover:from-rose-600 hover:to-orange-600 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-white font-black text-lg flex items-center justify-center gap-3 transition-all cursor-pointer shadow-lg shadow-rose-500/10 active:scale-[0.99] disabled:cursor-not-allowed"
        >
          <Icon icon="solar:export-bold-duotone" class="text-2xl" />
          {{ isRecording ? '正在合成视频...' : '开始合成卡拉OK视频并下载 (.mp4 / .webm)' }}
        </button>

      </div>

    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 消息淡入淡出 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -20px);
}
</style>
