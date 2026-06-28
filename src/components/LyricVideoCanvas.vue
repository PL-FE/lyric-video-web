<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { Icon } from '@iconify/vue'
import { parseLrc, type LrcLine } from '../utils/lrcParser'
import { FastVideoEncoder } from '../utils/FastVideoEncoder'

// ——— 音频和歌词文件状态 ———
const audioFile = ref<File | null>(null)
const lrcFile = ref<File | null>(null)
const bgVideoFile = ref<File | null>(null)
const bgVideoUrl = ref('')
const bgVideoRef = ref<HTMLVideoElement | null>(null)
const decodedAudioBuffer = ref<AudioBuffer | null>(null)

// ——— 新增的可定制背景与封面配置 ———
const bgMode = ref<'image' | 'video'>('image')
const lrcLinesToShow = ref<number>(2) // 默认 2 行
const showCover = ref<boolean>(true)
const coverTitle = ref<string>('')
const coverSubtitle = ref<string>('')

// ——— 预置背景图片数组 ———
const presetImageUrls = [
  './preset_bgs/bg1.jpg',
  './preset_bgs/bg2.jpg',
  './preset_bgs/bg3.jpg',
  './preset_bgs/bg4.jpg',
  './preset_bgs/bg5.jpg',
  './preset_bgs/bg6.jpg',
  './preset_bgs/bg7.jpg',
  './preset_bgs/bg8.jpg',
  './preset_bgs/bg9.jpg',
  './preset_bgs/bg10.jpg',
  './preset_bgs/bg11.jpg',
  './preset_bgs/bg12.jpg',
  './preset_bgs/bg13.jpg',
  './preset_bgs/bg14.jpg',
  './preset_bgs/bg15.jpg'
]

const uploadedImageFiles = ref<File[]>([])
const uploadedImageUrlList = ref<string[]>([])
const uploadedImageElements = ref<HTMLImageElement[]>([])

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
const strokeWidth = ref(0)
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
const showOverflowModal = ref(false)

// ——— DOM & 绘图句柄 ———
const audioRef = ref<HTMLAudioElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
let animationFrameId: number | null = null

// 背景图缓存

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

// 计算当前配置下是否有歌词溢出画布边界
const overflowState = computed(() => {
  if (lrcLines.value.length === 0) return { hasOverflow: false, count: 0, lines: [] }
  
  // 创建临时 canvas 测量，不污染主画面
  const tempCanvas = document.createElement('canvas')
  const tempCtx = tempCanvas.getContext('2d')
  if (!tempCtx) return { hasOverflow: false, count: 0, lines: [] }
  
  tempCtx.font = `bold ${fontSize.value}px ${textFont.value}`
  const maxW = canvasWidth.value * 0.98 // 预留左右 1% 的安全边距
  const lines: { index: number; text: string; time: number }[] = []
  
  lrcLines.value.forEach((line, index) => {
    if (tempCtx.measureText(line.text).width > maxW) {
      lines.push({
        index: index + 1,
        text: line.text,
        time: line.time
      })
    }
  })
  
  return {
    hasOverflow: lines.length > 0,
    count: lines.length,
    lines
  }
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
    decodedAudioBuffer.value = null

    // 异步离线解码音频数据，以便绘制波形图与视频合成使用
    const reader = new FileReader()
    reader.onload = async (e) => {
      const arrayBuffer = e.target?.result as ArrayBuffer
      if (!arrayBuffer) return
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
      const ctx = new AudioContextClass()
      try {
        decodedAudioBuffer.value = await ctx.decodeAudioData(arrayBuffer)
      } catch (err) {
        console.error('音频解码失败:', err)
      } finally {
        await ctx.close()
      }
    }
    reader.readAsArrayBuffer(file)

    // 智能回填封面大标题
    coverTitle.value = file.name.replace(/\.[^/.]+$/, "")

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
    // 智能回填封面小标题及大标题
    const parts = file.name.replace(/\.[^/.]+$/, "").split(' - ')
    if (parts.length > 1) {
      coverSubtitle.value = parts[0]
      if (!coverTitle.value) {
        coverTitle.value = parts[1]
      }
    } else {
      coverSubtitle.value = "未知歌手"
    }

    notify(`歌词导入成功，解析出 ${lrcLines.value.length} 行歌词`)
  }
}

// ——— IndexedDB 本地图片持久化工具 ———
const DB_NAME = 'LyricVideoMakerDB'
const STORE_NAME = 'background_images'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function saveImagesToDB(files: File[]) {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.clear()
    for (let i = 0; i < files.length; i++) {
      store.put({ id: i, file: files[i], name: files[i].name })
    }
  } catch (e) {
    console.error('保存背景图到 IndexedDB 失败:', e)
  }
}

async function loadImagesFromDB(): Promise<File[]> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.getAll()
      req.onsuccess = () => {
        const results = req.result || []
        results.sort((a, b) => a.id - b.id)
        resolve(results.map(r => r.file))
      }
      req.onerror = () => reject(req.error)
    })
  } catch (e) {
    console.error('读取本地持久化背景图失败:', e)
    return []
  }
}

async function clearImagesDB() {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
  } catch (e) {
    console.error('清空本地背景图缓存失败:', e)
  }
}

async function onBgImagesUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files || [])
  if (files.length > 0) {
    const startIdx = uploadedImageFiles.value.length
    uploadedImageFiles.value = [...uploadedImageFiles.value, ...files]
    
    // 保存至本地 IndexedDB
    await saveImagesToDB(uploadedImageFiles.value)
    
    let loadedCount = 0
    files.forEach((file, index) => {
      const url = URL.createObjectURL(file)
      const targetIdx = startIdx + index
      uploadedImageUrlList.value[targetIdx] = url
      const img = new Image()
      img.onload = () => {
        uploadedImageElements.value[targetIdx] = img
        loadedCount++
        if (loadedCount === files.length) {
          drawFrame()
          notify(`成功追加并本地保存 ${files.length} 张背景图片`)
        }
      }
      img.src = url
    })
  }
}

async function resetPresetImages() {
  uploadedImageUrlList.value.forEach(url => {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  })
  uploadedImageUrlList.value = []
  uploadedImageElements.value = []
  uploadedImageFiles.value = []
  
  // 清除本地图片缓存
  await clearImagesDB()
  
  notify('正在下载并本地化 15 张预置背景大图...')
  
  const files: File[] = []
  let loadedCount = 0
  
  async function checkAndSave() {
    if (loadedCount === presetImageUrls.length) {
      // 批量保存下载的图片对象到本地 IndexedDB
      const validFiles = files.filter(Boolean)
      if (validFiles.length > 0) {
        uploadedImageFiles.value = validFiles
        await saveImagesToDB(validFiles)
        
        // 重新生成 Blob URL，保证与持久化的 file 保持绑定一致
        uploadedImageFiles.value.forEach((file, index) => {
          if (uploadedImageUrlList.value[index] && uploadedImageUrlList.value[index].startsWith('blob:')) {
            URL.revokeObjectURL(uploadedImageUrlList.value[index])
          }
          const blobUrl = URL.createObjectURL(file)
          uploadedImageUrlList.value[index] = blobUrl
          if (uploadedImageElements.value[index]) {
            uploadedImageElements.value[index].src = blobUrl
          }
        })
      }
      drawFrame()
      notify('默认背景大图已成功下载并缓存至本地！')
    }
  }
  
  for (let index = 0; index < presetImageUrls.length; index++) {
    const url = presetImageUrls[index]
    try {
      // 采用 CORS fetch 图片并转为 Blob
      const res = await fetch(url)
      if (!res.ok) throw new Error('CORS fetch 失败')
      const blob = await res.blob()
      
      const file = new File([blob], `preset_bg_${index + 1}.jpg`, { type: 'image/jpeg' })
      files[index] = file
      
      const blobUrl = URL.createObjectURL(file)
      uploadedImageUrlList.value[index] = blobUrl
      
      const img = new Image()
      img.onload = () => {
        uploadedImageElements.value[index] = img
        loadedCount++
        checkAndSave()
      }
      img.src = blobUrl
    } catch (err) {
      console.warn(`本地化预置图失败，降级回退: ${url}`, err)
      // 降级退化：若下载失败（比如断网），直接用网络 URL 载入
      uploadedImageUrlList.value[index] = url
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = async () => {
        uploadedImageElements.value[index] = img
        
        // 通过 Canvas 将图片转为 Blob 并创建 File 对象
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth || img.width || 1280
          canvas.height = img.naturalHeight || img.height || 720
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(img, 0, 0)
            const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.95))
            if (blob) {
              const file = new File([blob], `preset_bg_${index + 1}.jpg`, { type: 'image/jpeg' })
              files[index] = file
            }
          }
        } catch (canvasErr) {
          console.error('Canvas 转换预置图为 Blob 失败:', canvasErr)
        }
        
        loadedCount++
        checkAndSave()
      }
      img.src = url
    }
  }
}

async function clearUploadedImages() {
  await resetPresetImages()
}


async function removeUploadedImage(index: number) {
  if (uploadedImageUrlList.value[index] && uploadedImageUrlList.value[index].startsWith('blob:')) {
    URL.revokeObjectURL(uploadedImageUrlList.value[index])
  }
  uploadedImageFiles.value.splice(index, 1)
  uploadedImageUrlList.value.splice(index, 1)
  uploadedImageElements.value.splice(index, 1)
  
  // 重新同步本地大图列表缓存
  await saveImagesToDB(uploadedImageFiles.value)
  
  drawFrame()
  notify('已删除该背景图片')
}

watch([bgColor, fontSize, strokeWidth, unsungColor, sungColor, resolution, textFont, bgMode, lrcLinesToShow, showCover, coverTitle, coverSubtitle], () => {
  const data = {
    bgColor: bgColor.value,
    fontSize: fontSize.value,
    strokeWidth: strokeWidth.value,
    unsungColor: unsungColor.value,
    sungColor: sungColor.value,
    resolution: resolution.value,
    textFont: textFont.value,
    bgMode: bgMode.value,
    lrcLinesToShow: lrcLinesToShow.value,
    showCover: showCover.value,
    coverTitle: coverTitle.value,
    coverSubtitle: coverSubtitle.value,
  }
  localStorage.setItem('lyric_video_maker_configs', JSON.stringify(data))
}, { deep: true })

function onBgVideoUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    bgVideoFile.value = file
    if (bgVideoUrl.value) {
      URL.revokeObjectURL(bgVideoUrl.value)
    }
    bgVideoUrl.value = URL.createObjectURL(file)
    notify('背景视频载入成功，已自动播放预览')
    
    setTimeout(() => {
      if (bgVideoRef.value) {
        bgVideoRef.value.currentTime = currentTime.value % bgVideoRef.value.duration || 0
        bgVideoRef.value.play().catch(() => {})
      }
      drawFrame()
    }, 100)
  }
}

function clearBgVideo() {
  bgVideoFile.value = null
  if (bgVideoUrl.value) {
    URL.revokeObjectURL(bgVideoUrl.value)
  }
  bgVideoUrl.value = ''
  drawFrame()
  notify('背景视频已清除')
}

watch(isPlaying, (newVal) => {
  if (bgVideoRef.value && bgVideoUrl.value) {
    if (newVal) {
      bgVideoRef.value.currentTime = currentTime.value % bgVideoRef.value.duration || 0
      bgVideoRef.value.play().catch(() => {})
    } else {
      bgVideoRef.value.pause()
    }
  }
})

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
  
  // 同步背景视频进度
  if (bgVideoRef.value && bgVideoUrl.value && !bgVideoRef.value.paused) {
    const diff = Math.abs(bgVideoRef.value.currentTime - (currentTime.value % bgVideoRef.value.duration || 0))
    if (diff > 0.3) {
      bgVideoRef.value.currentTime = currentTime.value % bgVideoRef.value.duration || 0
    }
  }
  
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

// 跳转到指定时间段并更新画面与关闭弹窗
function jumpToTime(time: number) {
  if (audioRef.value) {
    audioRef.value.currentTime = time
    currentTime.value = time
    drawFrame()
  }
  showOverflowModal.value = false
  notify(`已跳转至 ${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`)
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
async function drawFrame(timeOverride?: number, isRecordingFrame = false) {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const W = canvas.width
  const H = canvas.height

  const timeNow = timeOverride !== undefined ? timeOverride : currentTime.value
  if (timeOverride !== undefined) {
    currentTime.value = timeOverride
  }

  // 1. 绘制背景
  ctx.clearRect(0, 0, W, H)
  if (bgVideoRef.value && bgVideoUrl.value) {
    const video = bgVideoRef.value
    
    // 如果是离线压制，设置 currentTime 并等待 seeked 解码完毕
    if (isRecordingFrame) {
      video.currentTime = timeNow % video.duration
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }
        video.addEventListener('seeked', onSeeked)
        setTimeout(() => {
          video.removeEventListener('seeked', onSeeked)
          resolve()
        }, 150) // 超时保护
      })
    }
    
    const videoRatio = video.videoWidth / video.videoHeight || W / H
    const canvasRatio = W / H
    let dw, dh, dx, dy
    if (videoRatio > canvasRatio) {
      dh = H
      dw = H * videoRatio
      dx = (W - dw) / 2
      dy = 0
    } else {
      dw = W
      dh = W / videoRatio
      dx = 0
      dy = (H - dh) / 2
    }
    ctx.drawImage(video, dx, dy, dw, dh)
    
    // 加一层半透明黑色蒙版让歌词更清晰
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.fillRect(0, 0, W, H)
  } else {
    // 图片轮播背景 (默认)
    const images = uploadedImageElements.value
    
    if (images.length > 0) {
      const T = 15 // 每张图片展示15秒
      const idx = Math.floor(timeNow / T) % images.length
      const progress = (timeNow % T) / T
      
      const fadeDuration = 1.2
      const fadeRatio = fadeDuration / T
      
      if (progress < fadeRatio && images.length > 1) {
        const prevIdx = (idx - 1 + images.length) % images.length
        const t_fade = progress / fadeRatio
        const prevP = (T - fadeDuration + progress * T) / T
        drawKenBurnsImage(ctx, images[prevIdx], prevP, 1 - t_fade)
        drawKenBurnsImage(ctx, images[idx], progress, t_fade)
      } else {
        drawKenBurnsImage(ctx, images[idx], progress, 1.0)
      }
      
      // 加一层半透明黑色蒙版
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.fillRect(0, 0, W, H)
    } else {
      // 纯色背景
      ctx.fillStyle = bgColor.value
      ctx.fillRect(0, 0, W, H)
    }
  }

  // 1.5 绘制片头封面 (0s - 2s)
  const COVER_DURATION = 2.0
  const FADE_DURATION = 0.5 // 1.5s - 2.0s 为淡出区
  
  let drawLyricsAndWave = true
  
  if (showCover.value && timeNow < COVER_DURATION) {
    const titleText = coverTitle.value || (audioFile.value ? audioFile.value.name.replace(/\.[^/.]+$/, "") : '未知歌曲')
    const subtitleText = coverSubtitle.value || (lrcFile.value ? lrcFile.value.name.replace(/\.[^/.]+$/, "").split(' - ')[0] : '未知歌手')
    
    let coverAlpha = 1.0
    if (timeNow > COVER_DURATION - FADE_DURATION) {
      coverAlpha = (COVER_DURATION - timeNow) / FADE_DURATION
    }
    
    if (timeNow < COVER_DURATION - FADE_DURATION) {
      drawLyricsAndWave = false
    }
    
    ctx.save()
    ctx.globalAlpha = coverAlpha
    
    // 封面大毛玻璃磨砂背板
    ctx.fillStyle = 'rgba(15, 23, 42, 0.35)'
    ctx.fillRect(0, 0, W, H)
    
    // 大标题 (歌曲名)
    ctx.font = `bold ${Math.round(fontSize.value * 1.5)}px ${textFont.value}`
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.shadowBlur = 10
    ctx.shadowOffsetX = 2
    ctx.shadowOffsetY = 2
    ctx.fillText(titleText, W / 2, H / 2 - fontSize.value * 0.7)
    
    // 小标题 (歌手名)
    ctx.font = `italic ${Math.round(fontSize.value * 0.8)}px ${textFont.value}`
    ctx.fillStyle = '#cbd5e1'
    ctx.fillText(subtitleText, W / 2, H / 2 + fontSize.value * 0.8)
    
    ctx.restore()
  }

  // 2. 绘制音频波形起伏线 (已根据用户要求移除)
  if (!drawLyricsAndWave) return

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

  if (lrcLinesToShow.value === 1) {
    // 单行居中模式
    const currLine = lrcLines.value[currentIdx]
    drawKaraokeLine(ctx, currLine, W / 2, centerY, fontSize.value, timeNow)
  } else if (lrcLinesToShow.value === 2) {
    // 双行整页切换模式 (1、2行都唱完再切换)
    const upperY = centerY - gap * 0.5
    const lowerY = centerY + gap * 0.5
    
    const groupStartIdx = Math.floor(currentIdx / 2) * 2
    const line1 = lrcLines.value[groupStartIdx]
    const line2 = groupStartIdx + 1 < lrcLines.value.length ? lrcLines.value[groupStartIdx + 1] : null
    
    if (currentIdx === groupStartIdx) {
      // 正在唱上行 (上行扫光，下行候场)
      drawKaraokeLine(ctx, line1, W / 2, upperY, fontSize.value, timeNow)
      if (line2) {
        drawStaticLine(ctx, line2.text, W / 2, lowerY, fontSize.value, unsungColor.value)
      }
    } else {
      // 正在唱下行 (上行唱完，保持已唱高亮色；下行扫光)
      drawKaraokeLine(ctx, line1, W / 2, upperY, fontSize.value, line1.endTime + 1)
      if (line2) {
        drawKaraokeLine(ctx, line2, W / 2, lowerY, fontSize.value, timeNow)
      }
    }
  } else {
    // 三行滚动模式
    if (currentIdx > 0) {
      const prevLine = lrcLines.value[currentIdx - 1]
      drawStaticLine(ctx, prevLine.text, W / 2, centerY - gap, fontSize.value * 0.75, 'rgba(255, 255, 255, 0.4)')
    }

    const currLine = lrcLines.value[currentIdx]
    drawKaraokeLine(ctx, currLine, W / 2, centerY, fontSize.value, timeNow)

    if (currentIdx + 1 < lrcLines.value.length) {
      const nextLine = lrcLines.value[currentIdx + 1]
      drawStaticLine(ctx, nextLine.text, W / 2, centerY + gap, fontSize.value * 0.75, 'rgba(255, 255, 255, 0.55)')
    }
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

// 辅助方法：绘制带 Ken Burns 动效的图片背景
function drawKenBurnsImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, p: number, alpha: number) {
  const W = ctx.canvas.width
  const H = ctx.canvas.height
  const imgRatio = img.width / img.height
  const canvasRatio = W / H
  
  // 缓缓放大 (1.03x -> 1.13x)
  const scale = 1.03 + p * 0.10
  
  // 缓缓平移
  const moveX = (p - 0.5) * 30
  const moveY = (p - 0.5) * 15

  let dw, dh
  if (imgRatio > canvasRatio) {
    dh = H * scale
    dw = H * scale * imgRatio
  } else {
    dw = W * scale
    dh = (W * scale) / imgRatio
  }
  
  const dx = (W - dw) / 2 + moveX
  const dy = (H - dh) / 2 + moveY

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.drawImage(img, dx, dy, dw, dh)
  ctx.restore()
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

  // 2. 首先渲染底层描边 (如果设置了描边)
  if (strokeWidth.value > 0) {
    ctx.strokeStyle = strokeColor.value
    ctx.lineWidth = strokeWidth.value
    ctx.strokeText(text, x, y)
  }

  // 3. 计算已唱文字的像素宽度 W_sung
  let sungWidth = 0
  let allSung = true
  let hasStarted = false
  
  for (const word of line.words) {
    const wordWidth = ctx.measureText(word.word).width
    
    if (timeNow >= word.end) {
      // 字唱完了，加上完整宽度
      sungWidth += wordWidth
      hasStarted = true
    } else if (timeNow >= word.start) {
      // 字正在唱，按时间比例计算当前字内部的扫光进度
      const progress = (timeNow - word.start) / word.duration
      sungWidth += wordWidth * progress
      allSung = false
      hasStarted = true
      break // 后面字都还没唱到，停止累加
    } else {
      allSung = false
      break
    }
  }

  // 4. 计算渐变比例，使用渐变填充渲染文字层 (避免双重绘制及裁切导致的抗锯齿白边)
  let ratio = 0
  if (allSung && hasStarted) {
    ratio = 1
  } else if (totalWidth > 0) {
    ratio = Math.min(1, Math.max(0, sungWidth / totalWidth))
  }

  if (ratio > 0) {
    if (ratio >= 1) {
      ctx.fillStyle = sungColor.value
    } else {
      const grad = ctx.createLinearGradient(startX, y, startX + totalWidth, y)
      grad.addColorStop(0, sungColor.value)
      grad.addColorStop(ratio, sungColor.value)
      grad.addColorStop(ratio, unsungColor.value)
      grad.addColorStop(1, unsungColor.value)
      ctx.fillStyle = grad
    }
  } else {
    ctx.fillStyle = unsungColor.value
  }
  ctx.fillText(text, x, y)
}

// ——— 核心合成录制逻辑 (修改为 WebCodecs 离线倍速压制版) ———
async function startRecording() {
  if (!audioFile.value || !isAudioLoaded.value) {
    notify('请上传音频文件后再进行合成')
    return
  }
  if (lrcLines.value.length === 0) {
    notify('请上传歌词文件后再进行合成')
    return
  }
  if (!canvasRef.value) return

  // 1. 进入录制状态
  isRecording.value = true
  isPlaying.value = false
  recordProgress.value = 0

  // 停止音频播放器
  if (audioRef.value) {
    audioRef.value.pause()
  }

  try {
    // 2. 初始化离线快速编码器
    const encoder = new FastVideoEncoder({
      canvas: canvasRef.value,
      audioFile: audioFile.value,
      duration: duration.value,
      fps: 30,
      width: canvasWidth.value,
      height: canvasHeight.value,
      drawFrameAtTime: async (_, timestamp) => {
        // 传递 timestamp 给 drawFrame，实现非实时画面离线精确绘制
        await drawFrame(timestamp, true)
      },
      onProgress: (progress) => {
        recordProgress.value = progress
      }
    })

    // 3. 执行视频导出
    const videoBlob = await encoder.encode()

    // 4. 触发浏览器下载
    const url = URL.createObjectURL(videoBlob)
    const a = document.createElement('a')
    a.href = url
    
    // 以歌曲名命名
    const songName = audioFile.value ? audioFile.value.name.replace(/\.[^.]+$/, '') : 'lyric_video'
    a.download = `${songName}_karaoke.mp4`
    a.click()

    notify('视频合成完成，已触发下载！')
  } catch (error) {
    console.error('合成失败:', error)
    notify(`合成出错: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    isRecording.value = false
    // 恢复画面预览
    drawFrame()
  }
}

// 监听分辨率发生变化，重绘画面
watch([resolution, bgColor], () => {
  setTimeout(() => {
    drawFrame()
  }, 10)
})

// ——— 在线音乐搜索弹窗状态 ———
const showSearchDialog = ref(false)
const showLrcPreview = ref(false)
const searchKeyword = ref('')
const searchLoading = ref(false)
const searchResults = ref<any[]>([])
const currentUsingHash = ref<string | null>(null) // 记录当前正在“下载使用”的歌曲 Hash
const previewAudio = ref<HTMLAudioElement | null>(null)
const previewHash = ref<string | null>(null) // 当前正在试听的歌曲 Hash

// 打开搜索弹窗
function openSearchDialog() {
  showSearchDialog.value = true
  searchKeyword.value = ''
  searchResults.value = []
}

// 格式化时长（秒 -> 分:秒）
function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// 在线搜索歌曲
async function handleSearch() {
  if (!searchKeyword.value.trim()) return
  searchLoading.value = true
  searchResults.value = []
  try {
    const res = await fetch(`http://localhost:8000/api/music/search?keyword=${encodeURIComponent(searchKeyword.value)}`)
    const data = await res.json()
    if (data.code === 200) {
      searchResults.value = data.data
    } else {
      notify(data.message || '搜索失败')
    }
  } catch (error) {
    console.error('搜索歌曲出错:', error)
    notify('网络错误，搜索歌曲失败')
  } finally {
    searchLoading.value = false
  }
}

// 试听/暂停试听
function togglePreview(song: any) {
  if (previewHash.value === song.hash) {
    // 暂停
    if (previewAudio.value) {
      previewAudio.value.pause()
      previewAudio.value = null
    }
    previewHash.value = null
  } else {
    // 播放新的
    if (previewAudio.value) {
      previewAudio.value.pause()
    }
    previewHash.value = song.hash
    // 使用 HTMLAudioElement 播放
    previewAudio.value = new Audio(`http://localhost:8000/api/music/audio-proxy?hash=${song.hash}`)
    previewAudio.value.play().catch(e => {
      console.error('试听失败:', e)
      notify('该音频文件加载失败或无可用音源')
      previewHash.value = null
      previewAudio.value = null
    })
  }
}

// 使用该歌曲
async function useSong(song: any) {
  if (currentUsingHash.value) return
  currentUsingHash.value = song.hash
  
  // 停止试听
  if (previewAudio.value) {
    previewAudio.value.pause()
    previewAudio.value = null
    previewHash.value = null
  }

  notify(`正在下载《${song.song_name}》歌词资源，请稍候...`)

  let audioFileObj: File | null = null
  let audioBlob: Blob | null = null
  let audioSuccess = false

  // 1. 尝试下载音频
  try {
    const audioRes = await fetch(`http://localhost:8000/api/music/audio-proxy?hash=${song.hash}`)
    if (audioRes.ok) {
      audioBlob = await audioRes.blob()
      if (audioBlob.size > 100000) { // 大于 100KB 确认为音频
        const fileName = `${song.singer_name} - ${song.song_name}.mp3`
        audioFileObj = new File([audioBlob], fileName, { type: 'audio/mpeg' })
        audioSuccess = true
      }
    }
  } catch (e) {
    console.error('音频下载失败:', e)
  }

  // 2. 下载歌词
  let lyricText = ''
  try {
    const lrcUrl = `http://localhost:8000/api/music/lrc?hash=${song.hash}&song_name=${encodeURIComponent(song.song_name)}&artist_name=${encodeURIComponent(song.singer_name)}`
    const lrcRes = await fetch(lrcUrl)
    if (lrcRes.ok) {
      const lrcData = await lrcRes.json()
      if (lrcData.code === 200 && lrcData.lyric) {
        lyricText = lrcData.lyric
      }
    }
  } catch (e) {
    console.error('歌词下载失败:', e)
  }
  
  // 如果没有获取到歌词，生成一个提示性临时歌词
  if (!lyricText) {
    lyricText = `\x5b00:00.00\x5d${song.song_name} - ${song.singer_name}\n\x5b00:02.00\x5d（未能自动匹配到精准字轴歌词，请手动在这里编辑）\n`
  }

  const lrcFileObj = new File([lyricText], `${song.singer_name} - ${song.song_name}.lrc`, { type: 'text/plain' })

  // 3. 填充歌词状态
  lrcFile.value = lrcFileObj
  lrcContent.value = lyricText

  // 4. 填充音频状态 (仅在音频下载成功时)
  if (audioSuccess && audioFileObj && audioBlob) {
    audioFile.value = audioFileObj
    if (audioRef.value) {
      audioRef.value.pause()
    }
    audioUrl.value = URL.createObjectURL(audioFileObj)
    isAudioLoaded.value = false
    decodedAudioBuffer.value = null
    
    // 延迟 load 确保 Vue 已将 src 绑定到 DOM
    setTimeout(() => {
      audioRef.value?.load()
    }, 50)

    // 5. 解码音频为 AudioBuffer
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new AudioContextClass()
    try {
      const arrayBuffer = await audioBlob.arrayBuffer()
      decodedAudioBuffer.value = await ctx.decodeAudioData(arrayBuffer)
    } catch (e) {
      console.error('AudioBuffer 解码失败:', e)
    } finally {
      await ctx.close()
    }

    // 6. 解析歌词行
    duration.value = song.duration || 200
    lrcLines.value = parseLrc(lyricText, duration.value)

    notify(`《${song.song_name}》音频与字轴歌词导入成功！`)
  } else {
    // 音频获取失败，仅导入歌词
    duration.value = duration.value || song.duration || 240
    lrcLines.value = parseLrc(lyricText, duration.value)
    
    notify(`歌词导入成功！但音频因版权保护未能下载，您可以自行上传本地音频匹配`)
  }

  // 智能回填封面大标题与小标题
  coverTitle.value = song.song_name
  coverSubtitle.value = song.singer_name

  showSearchDialog.value = false

  // 延迟重绘确保 DOM 完全就绪
  setTimeout(() => {
    drawFrame()
  }, 200)

  currentUsingHash.value = null
}

onMounted(async () => {
  // 1. 从 localStorage 恢复用户配置
  try {
    const cached = localStorage.getItem('lyric_video_maker_configs')
    if (cached) {
      const data = JSON.parse(cached)
      if (data.bgColor !== undefined) bgColor.value = data.bgColor
      if (data.fontSize !== undefined) fontSize.value = data.fontSize
      if (data.strokeWidth !== undefined) strokeWidth.value = data.strokeWidth
      if (data.unsungColor !== undefined) unsungColor.value = data.unsungColor
      if (data.sungColor !== undefined) sungColor.value = data.sungColor
      if (data.resolution !== undefined) resolution.value = data.resolution
      if (data.textFont !== undefined) textFont.value = data.textFont
      if (data.bgMode !== undefined) bgMode.value = data.bgMode
      if (data.lrcLinesToShow !== undefined) lrcLinesToShow.value = data.lrcLinesToShow
      if (data.showCover !== undefined) showCover.value = data.showCover
      if (data.coverTitle !== undefined) coverTitle.value = data.coverTitle
      if (data.coverSubtitle !== undefined) coverSubtitle.value = data.coverSubtitle
    }
  } catch (e) {
    console.error('还原配置缓存失败:', e)
  }

  // 2. 尝试从 IndexedDB 中恢复持久化的本地背景图片
  try {
    const cachedFiles = await loadImagesFromDB()
    if (cachedFiles && cachedFiles.length > 0) {
      uploadedImageFiles.value = cachedFiles
      let loadedCount = 0
      cachedFiles.forEach((file, index) => {
        const url = URL.createObjectURL(file)
        uploadedImageUrlList.value[index] = url
        const img = new Image()
        img.onload = () => {
          uploadedImageElements.value[index] = img
          loadedCount++
          if (loadedCount === cachedFiles.length) {
            drawFrame()
          }
        }
        img.src = url
      })
      notify(`已从本地缓存还原 ${cachedFiles.length} 张背景图`)
    } else {
      // 否则加载默认 15 张图
      resetPresetImages()
    }
  } catch (err) {
    console.error('还原本地背景图缓存失败:', err)
    resetPresetImages()
  }

  // 3. 绘制初始帧
  drawFrame()
})

onUnmounted(() => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId)
  if (audioCtx) audioCtx.close()
  if (previewAudio.value) {
    previewAudio.value.pause()
    previewAudio.value = null
  }
  if (bgVideoUrl.value) {
    URL.revokeObjectURL(bgVideoUrl.value)
  }
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
            <!-- 在线歌曲搜索下载按钮 -->
            <button @click="openSearchDialog" class="w-full py-3 px-4 mb-2 rounded-2xl bg-gradient-to-r from-rose-500 to-orange-500 hover:from-rose-600 hover:to-orange-600 text-white font-bold text-sm shadow-lg shadow-rose-500/25 transition-all flex items-center justify-center gap-2 group cursor-pointer border-0">
              <Icon icon="solar:music-library-bold" class="text-lg group-hover:scale-110 transition-transform" />
              ✨ 在线搜索歌曲与字轴歌词
            </button>

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
              <div class="flex gap-2">
                <div class="relative flex-1 border-2 border-dashed border-slate-700 hover:border-rose-500/50 rounded-2xl p-4 flex flex-col items-center justify-center transition-all bg-slate-950/50 cursor-pointer overflow-hidden group">
                  <input type="file" accept=".lrc" @change="onLrcUpload" class="absolute inset-0 opacity-0 cursor-pointer" />
                  <Icon icon="solar:document-text-bold-duotone" class="text-3xl text-slate-500 group-hover:text-rose-400 transition-colors mb-2" />
                  <span class="text-sm font-semibold text-slate-300 truncate max-w-full">
                    {{ lrcFile ? lrcFile.name : '点击选择或拖入歌词文件' }}
                  </span>
                </div>
                <button v-if="lrcContent" @click="showLrcPreview = true" class="w-12 rounded-2xl bg-slate-950 border border-slate-700 hover:bg-rose-950/30 hover:border-rose-900 transition-all flex items-center justify-center text-rose-400 cursor-pointer">
                  <Icon icon="solar:eye-bold" class="text-lg" />
                </button>
              </div>
            </div>

            <!-- 背景类型选择 -->
            <div>
              <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">3. 背景类型 (图片轮播 vs 视频背景)</label>
              <div class="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-2xl border border-slate-800">
                <button 
                  type="button"
                  @click="bgMode = 'image'; drawFrame()" 
                  :class="[bgMode === 'image' ? 'bg-rose-500 text-white' : 'text-slate-400 hover:text-slate-200']"
                  class="py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border-0"
                >
                  图片模式 (Ken Burns 轮播)
                </button>
                <button 
                  type="button"
                  @click="bgMode = 'video'; drawFrame()" 
                  :class="[bgMode === 'video' ? 'bg-rose-500 text-white' : 'text-slate-400 hover:text-slate-200']"
                  class="py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border-0"
                >
                  视频模式 (精确帧同步)
                </button>
              </div>
            </div>

            <!-- 背景图片上传 (若为图片模式) -->
            <div v-if="bgMode === 'image'">
              <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                4. 自定义背景图片 (可选，可多选轮播)
              </label>
              <div class="flex gap-2">
                <div class="relative flex-1 border-2 border-dashed border-slate-700 hover:border-rose-500/50 rounded-2xl p-4 flex flex-col items-center justify-center transition-all bg-slate-950/50 cursor-pointer overflow-hidden group">
                  <input type="file" accept="image/*" multiple @change="onBgImagesUpload" class="absolute inset-0 opacity-0 cursor-pointer" />
                  <Icon icon="solar:gallery-bold-duotone" class="text-3xl text-slate-500 group-hover:text-rose-400 transition-colors mb-2" />
                  <span class="text-sm font-semibold text-slate-300 truncate max-w-full">
                    {{ uploadedImageFiles.length > 0 ? `已载入 ${uploadedImageFiles.length} 张背景图` : '默认使用 15 张预置大图循环' }}
                  </span>
                </div>
                <button v-if="uploadedImageFiles.length > 0" @click="clearUploadedImages" class="w-12 rounded-2xl bg-slate-950 border border-slate-700 hover:bg-rose-950/30 hover:border-rose-900 transition-all flex items-center justify-center text-rose-400 cursor-pointer">
                  <Icon icon="solar:trash-bin-trash-bold" />
                </button>
              </div>

              <!-- 背景大图列表及操作网格 -->
              <div class="flex flex-col gap-3 mt-3 bg-slate-950/20 p-3 rounded-2xl border border-slate-800/80">
                <div class="flex justify-between items-center">
                  <span class="text-xs font-semibold text-slate-400">
                    {{ uploadedImageUrlList.length > 0 ? '自定义轮播图列表 (悬浮可单张删除)' : '默认预置轮播图列表' }}
                  </span>
                  <!-- 一键重置预置图按钮 -->
                  <button 
                    v-if="uploadedImageUrlList.length > 0" 
                    type="button"
                    @click="clearUploadedImages" 
                    class="text-xs font-bold text-rose-400 hover:text-rose-300 flex items-center gap-1 bg-transparent border-0 cursor-pointer transition-all p-0"
                  >
                    <Icon icon="solar:restart-bold" class="text-sm" />
                    重置为预置图
                  </button>
                </div>

                <!-- 5列缩略图网格 -->
                <div class="grid grid-cols-5 gap-2">
                  <template v-if="uploadedImageUrlList.length > 0">
                    <div 
                      v-for="(url, idx) in uploadedImageUrlList" 
                      :key="url" 
                      class="relative aspect-video rounded-lg overflow-hidden border border-slate-800 group"
                    >
                      <img :src="url" class="w-full h-full object-cover" />
                      <!-- 单张图片删除悬浮按钮 -->
                      <button 
                        type="button"
                        @click="removeUploadedImage(idx)" 
                        class="absolute top-1 right-1 w-5 h-5 rounded-full bg-slate-950/80 hover:bg-rose-600 text-white flex items-center justify-center border-0 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Icon icon="solar:close-circle-bold" class="text-xs" />
                      </button>
                    </div>
                  </template>
                  <template v-else>
                    <div 
                      v-for="url in presetImageUrls" 
                      :key="url" 
                      class="aspect-video rounded-lg overflow-hidden border border-slate-800/60 opacity-80 hover:opacity-100 transition-opacity"
                    >
                      <img :src="url" class="w-full h-full object-cover" />
                    </div>
                  </template>
                </div>
              </div>
            </div>

            <!-- 背景视频上传 (若为视频模式) -->
            <div v-if="bgMode === 'video'">
              <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                4. 自定义背景视频 (可选，单选)
              </label>
              <div class="flex gap-2">
                <div class="relative flex-1 border-2 border-dashed border-slate-700 hover:border-rose-500/50 rounded-2xl p-4 flex flex-col items-center justify-center transition-all bg-slate-950/50 cursor-pointer overflow-hidden group">
                  <input type="file" accept="video/*" @change="onBgVideoUpload" class="absolute inset-0 opacity-0 cursor-pointer" />
                  <Icon icon="solar:videocamera-record-bold-duotone" class="text-3xl text-slate-500 group-hover:text-rose-400 transition-colors mb-2" />
                  <span class="text-sm font-semibold text-slate-300 truncate max-w-full">
                    {{ bgVideoFile ? bgVideoFile.name : '上传背景视频' }}
                  </span>
                </div>
                <button v-if="bgVideoFile" @click="clearBgVideo" class="w-12 rounded-2xl bg-slate-950 border border-slate-700 hover:bg-rose-950/30 hover:border-rose-900 transition-all flex items-center justify-center text-rose-400 cursor-pointer">
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
            <!-- 背景颜色 (如果无有效图片或视频) -->
            <div v-if="bgMode === 'image' ? (uploadedImageFiles.length === 0) : !bgVideoFile" class="flex justify-between items-center bg-slate-950/30 p-3 rounded-xl border border-slate-800">
              <span class="text-sm font-semibold text-slate-300">纯色背景色</span>
              <input type="color" v-model="bgColor" class="w-12 h-8 rounded border-0 bg-transparent cursor-pointer" />
            </div>

            <!-- 字号滑块 -->
            <div class="flex flex-col gap-2">
              <div class="flex justify-between text-sm font-semibold text-slate-300">
                <span>歌词大小</span>
                <span class="text-rose-400 font-bold">{{ fontSize }}px</span>
              </div>
              <input type="range" min="30" max="200" v-model.number="fontSize" @input="drawFrame()" class="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-500" />
              
              <!-- 溢出智能提示 (点击可查看详情) -->
              <div v-if="overflowState.hasOverflow" @click="showOverflowModal = true" class="bg-amber-950/40 border border-amber-500/30 text-amber-300 text-xs p-3 rounded-2xl flex items-center gap-2 mt-1 cursor-pointer hover:bg-amber-900/20 transition-all select-none">
                <Icon icon="solar:danger-triangle-bold" class="text-amber-500 text-base flex-shrink-0 animate-pulse" />
                <span class="flex-1">当前字号有 <strong>{{ overflowState.count }}</strong> 行歌词超出画面边界，导出后可能会被裁剪。<span class="underline ml-1 font-semibold text-amber-400">点击查看详情</span></span>
              </div>
            </div>

            <!-- 描边粗细滑块 -->
            <div class="flex flex-col gap-2">
              <div class="flex justify-between text-sm font-semibold text-slate-300">
                <span>字体描边粗细</span>
                <span class="text-rose-400 font-bold">{{ strokeWidth }}px</span>
              </div>
              <input type="range" min="0" max="10" v-model.number="strokeWidth" @input="drawFrame()" class="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-500" />
            </div>

            <!-- 颜色选取器双列 -->
            <div class="grid grid-cols-2 gap-4">
              <div class="flex flex-col gap-1.5">
                <span class="text-xs font-semibold text-slate-400 uppercase">未唱文字颜色</span>
                <div class="flex items-center gap-2 bg-slate-950/30 p-2 rounded-xl border border-slate-800">
                  <input type="color" v-model="unsungColor" @input="drawFrame()" class="w-8 h-8 rounded border-0 bg-transparent cursor-pointer" />
                  <span class="text-xs font-mono text-slate-300">{{ unsungColor.toUpperCase() }}</span>
                </div>
              </div>
              <div class="flex flex-col gap-1.5">
                <span class="text-xs font-semibold text-slate-400 uppercase">已唱扫光颜色</span>
                <div class="flex items-center gap-2 bg-slate-950/30 p-2 rounded-xl border border-slate-800">
                  <input type="color" v-model="sungColor" @input="drawFrame()" class="w-8 h-8 rounded border-0 bg-transparent cursor-pointer" />
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

            <!-- 歌词展示行数 -->
            <div class="flex flex-col gap-2">
              <span class="text-sm font-semibold text-slate-300">歌词展示行数</span>
              <select v-model.number="lrcLinesToShow" @change="drawFrame()" class="w-full bg-slate-950 text-slate-300 rounded-2xl border border-slate-800 p-3 outline-none focus:border-rose-500/50 cursor-pointer">
                <option :value="1">单行居中模式</option>
                <option :value="2">双行交替模式 (推荐)</option>
                <option :value="3">三行滚动模式</option>
              </select>
            </div>

            <!-- 片头封面配置 (大标题/小标题) -->
            <div class="flex flex-col gap-4 border-t border-slate-800/80 pt-4">
              <div class="flex justify-between items-center">
                <span class="text-sm font-semibold text-slate-300">制作片头封面 (前2秒)</span>
                <input type="checkbox" v-model="showCover" @change="drawFrame()" class="w-4 h-4 accent-rose-500 cursor-pointer" />
              </div>
              
              <div v-if="showCover" class="flex flex-col gap-3 animate-fade-in">
                <div class="flex flex-col gap-2">
                  <span class="text-xs text-slate-400">大标题 (封面主标题，默认歌曲名)</span>
                  <input type="text" v-model="coverTitle" @input="drawFrame()" placeholder="输入大标题" class="w-full bg-slate-950 text-slate-300 rounded-2xl border border-slate-800 p-3 outline-none focus:border-rose-500/50 text-sm" />
                </div>
                <div class="flex flex-col gap-2">
                  <span class="text-xs text-slate-400">小标题 (封面副标题，默认歌手名)</span>
                  <input type="text" v-model="coverSubtitle" @input="drawFrame()" placeholder="输入小标题" class="w-full bg-slate-950 text-slate-300 rounded-2xl border border-slate-800 p-3 outline-none focus:border-rose-500/50 text-sm" />
                </div>
              </div>
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

          <!-- 背景视频播放器 (隐式，用于触发 Canvas 渲染) -->
          <video 
            ref="bgVideoRef" 
            :src="bgVideoUrl" 
            loop 
            muted 
            playsinline 
            class="hidden"
          ></video>

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
      
      <!-- 溢出歌词详情弹窗 -->
      <Transition name="modal-fade">
        <div v-if="showOverflowModal" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div class="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-3xl p-6 shadow-2xl flex flex-col gap-4 animate-scale-up">
            <div class="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 class="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Icon icon="solar:danger-triangle-bold" class="text-amber-500" />
                溢出歌词列表 (共 {{ overflowState.count }} 行)
              </h3>
              <button @click="showOverflowModal = false" class="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 flex items-center justify-center transition-all cursor-pointer border-0">
                <Icon icon="solar:close-circle-bold" class="text-lg" />
              </button>
            </div>
            
            <div class="max-h-[300px] overflow-y-auto pr-2 flex flex-col gap-2">
              <div 
                v-for="line in overflowState.lines" 
                :key="line.index" 
                @click="jumpToTime(line.time)"
                class="bg-slate-950/40 border border-slate-850 p-3 rounded-xl flex items-start gap-3 hover:border-rose-500/50 hover:bg-slate-900 cursor-pointer transition-all active:scale-[0.99] group"
              >
                <span class="text-xs font-mono font-bold bg-slate-850 text-slate-400 group-hover:text-rose-400 px-2 py-0.5 rounded flex-shrink-0">#{{ line.index }}</span>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors break-words leading-relaxed">{{ line.text }}</p>
                  <p class="text-[10px] text-slate-500 group-hover:text-rose-400 font-mono mt-1 flex items-center gap-1 transition-colors">
                    <Icon icon="solar:clock-circle-bold" />
                    时间轴位置: {{ Math.floor(line.time / 60) }}:{{ String(Math.floor(line.time % 60)).padStart(2, '0') }} (点击跳转)
                  </p>
                </div>
              </div>
            </div>
            
            <div class="flex justify-end pt-2">
              <button @click="showOverflowModal = false" class="px-5 py-2.5 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-sm cursor-pointer transition-all active:scale-95 border-0">
                知道了
              </button>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 在线歌曲搜索弹窗 (Modal) -->
      <Transition name="modal-fade">
        <div v-if="showSearchDialog" class="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-xl shadow-2xl flex flex-col gap-4 max-h-[85vh] animate-scale-up text-slate-100">
            <!-- 头部 -->
            <div class="flex justify-between items-center">
              <h3 class="text-lg font-bold flex items-center gap-2">
                <Icon icon="solar:music-note-slider-bold-duotone" class="text-rose-500 text-2xl" />
                在线搜索歌曲 & 歌词
              </h3>
              <button @click="showSearchDialog = false" class="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 hover:bg-rose-950/30 hover:border-rose-900 transition-all flex items-center justify-center text-slate-400 hover:text-rose-400 cursor-pointer">
                <Icon icon="solar:close-circle-bold" class="text-lg" />
              </button>
            </div>

            <!-- 搜索框 -->
            <div class="flex gap-2">
              <input 
                type="text" 
                v-model="searchKeyword" 
                @keyup.enter="handleSearch"
                placeholder="输入歌名、歌手，例如：得不到你的心" 
                class="flex-1 bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-rose-500 rounded-2xl px-4 py-3 text-sm text-slate-100 outline-none transition-all placeholder:text-slate-500"
              />
              <button @click="handleSearch" :disabled="searchLoading" class="px-5 rounded-2xl bg-rose-500 hover:bg-rose-600 disabled:bg-slate-800 disabled:text-slate-600 text-white font-bold text-sm cursor-pointer transition-all flex items-center justify-center gap-1 border-0">
                <Icon v-if="searchLoading" icon="svg-spinners:180-ring" class="text-sm" />
                <span v-else>搜索</span>
              </button>
            </div>

            <!-- 搜索结果列表 -->
            <div class="flex-1 overflow-y-auto min-h-[300px] max-h-[450px] pr-1 flex flex-col gap-2">
              <!-- 加载状态 -->
              <div v-if="searchLoading" class="flex-1 flex flex-col items-center justify-center gap-2 py-10">
                <Icon icon="svg-spinners:blocks-scale" class="text-4xl text-rose-500" />
                <span class="text-sm text-slate-400 font-medium">正在检索在线曲库，请稍候...</span>
              </div>

              <!-- 空状态 -->
              <div v-else-if="searchResults.length === 0" class="flex-1 flex flex-col items-center justify-center gap-2 py-12 text-slate-500">
                <Icon icon="solar:music-notes-broken" class="text-5xl opacity-40 mb-1" />
                <span class="text-sm font-semibold">
                  {{ searchKeyword ? '没有搜到这首歌，换个词试试吧' : '输入歌名开始在线检索' }}
                </span>
              </div>

              <!-- 结果渲染 -->
              <template v-else>
                <div 
                  v-for="song in searchResults" 
                  :key="song.hash"
                  class="flex items-center justify-between p-3.5 bg-slate-950/40 hover:bg-slate-950/80 rounded-2xl border border-slate-800 hover:border-slate-700/80 transition-all group"
                >
                  <div class="flex items-center gap-3 min-w-0 flex-1">
                    <!-- 试听按钮 -->
                    <button 
                      @click="togglePreview(song)"
                      class="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 hover:border-rose-900 hover:bg-rose-950/30 flex items-center justify-center text-rose-500 transition-all cursor-pointer shadow-sm"
                    >
                      <Icon 
                        :icon="previewHash === song.hash ? 'solar:pause-bold' : 'solar:play-bold'" 
                        :class="previewHash === song.hash ? 'animate-pulse text-lg' : 'text-sm translate-x-[1px]'" 
                      />
                    </button>
                    <!-- 歌名与歌手 -->
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-bold text-slate-200 truncate group-hover:text-rose-400 transition-colors">
                        {{ song.song_name }}
                      </p>
                      <p class="text-xs text-slate-400 truncate mt-0.5">
                        {{ song.singer_name }} · {{ formatDuration(song.duration) }}
                      </p>
                    </div>
                  </div>

                  <!-- 使用/下载按钮 -->
                  <button 
                    @click="useSong(song)"
                    :disabled="currentUsingHash !== null"
                    class="px-4 py-2 rounded-xl bg-slate-900 hover:bg-rose-500 border border-slate-800 hover:border-rose-500 disabled:opacity-40 text-slate-200 hover:text-white font-bold text-xs cursor-pointer transition-all active:scale-95 flex items-center gap-1.5"
                  >
                    <Icon v-if="currentUsingHash === song.hash" icon="svg-spinners:180-ring" class="text-xs" />
                    <Icon v-else icon="solar:download-bold" class="text-xs" />
                    {{ currentUsingHash === song.hash ? '解析中' : '使用' }}
                  </button>
                </div>
              </template>
            </div>

            <div class="text-[10px] text-slate-500 text-center border-t border-slate-800/60 pt-3">
              注：在线曲库功能仅供开发、测试及个人学习使用，禁止商用。
            </div>
          </div>
        </div>
      </Transition>

      <!-- 歌词纯文本预览弹窗 (Modal) -->
      <Transition name="modal-fade">
        <div v-if="showLrcPreview" class="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg shadow-2xl flex flex-col gap-4 max-h-[80vh] animate-scale-up text-slate-100">
            <div class="flex justify-between items-center">
              <h3 class="text-lg font-bold flex items-center gap-2">
                <Icon icon="solar:document-text-bold-duotone" class="text-rose-500 text-2xl" />
                歌词内容预览
              </h3>
              <button @click="showLrcPreview = false" class="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 hover:bg-rose-950/30 hover:border-rose-900 transition-all flex items-center justify-center text-slate-400 hover:text-rose-400 cursor-pointer">
                <Icon icon="solar:close-circle-bold" class="text-lg" />
              </button>
            </div>
            
            <div class="flex-1 overflow-y-auto bg-slate-950/60 border border-slate-800 rounded-2xl p-4 font-mono text-sm leading-relaxed whitespace-pre max-h-[50vh] text-slate-300">
              {{ lrcContent }}
            </div>

            <div class="flex justify-end gap-2">
              <button @click="showLrcPreview = false" class="px-5 py-2.5 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-sm cursor-pointer transition-all border-0">
                关闭预览
              </button>
            </div>
          </div>
        </div>
      </Transition>

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

/* 弹窗淡入淡出 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.25s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

/* 弹窗缩放动画 */
.animate-scale-up {
  animation: scaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes scaleUp {
  from {
    transform: scale(0.95);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
