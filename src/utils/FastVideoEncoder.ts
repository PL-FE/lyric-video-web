import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export interface FastVideoEncoderOptions {
  canvas: HTMLCanvasElement;
  audioFile: File | null;
  duration: number;
  fps?: number;
  width: number;
  height: number;
  bitrate?: number; // 比特率 (bps)
  drawFrameAtTime: (ctx: CanvasRenderingContext2D, time: number) => void | Promise<void>;
  onProgress?: (progress: number) => void;
}

export class FastVideoEncoder {
  private canvas: HTMLCanvasElement;
  private audioFile: File | null;
  private duration: number;
  private fps: number;
  private width: number;
  private height: number;
  private bitrate: number;
  private drawFrameAtTime: (ctx: CanvasRenderingContext2D, time: number) => void | Promise<void>;
  private onProgress?: (progress: number) => void;
  private isCancelled = false;

  constructor(options: FastVideoEncoderOptions) {
    this.canvas = options.canvas;
    this.audioFile = options.audioFile;
    this.duration = options.duration;
    this.fps = options.fps || 30;
    // H.264 编码器要求分辨率宽度和高度必须为 2 的倍数（偶数）
    this.width = Math.floor(options.width / 2) * 2;
    this.height = Math.floor(options.height / 2) * 2;
    this.bitrate = options.bitrate || 2_500_000; // 默认 2.5 Mbps
    this.drawFrameAtTime = options.drawFrameAtTime;
    this.onProgress = options.onProgress;
  }

  /**
   * 中断/取消视频编码
   */
  public cancel(): void {
    this.isCancelled = true;
  }

  /**
   * 解码音频文件为 AudioBuffer
   */
  private async decodeAudio(file: File): Promise<AudioBuffer> {
    const arrayBuffer = await file.arrayBuffer();
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContextClass();
    try {
      return await audioCtx.decodeAudioData(arrayBuffer);
    } finally {
      await audioCtx.close();
    }
  }

  /**
   * 启动离线快速导出视频
   */
  public async encode(): Promise<Blob> {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('无法获取 Canvas 2D 绘图上下文');
    }

    let encoderError: Error | null = null;

    // 1. 解码音频（如果存在）
    let audioBuffer: AudioBuffer | null = null;
    if (this.audioFile) {
      if (this.onProgress) this.onProgress(2); // 开始解码
      audioBuffer = await this.decodeAudio(this.audioFile);
    }

    const sampleRate = audioBuffer ? audioBuffer.sampleRate : 44100;
    const numberOfChannels = audioBuffer ? audioBuffer.numberOfChannels : 2;

    // 2. 初始化 mp4-muxer
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: 'avc', // H.264
        width: this.width,
        height: this.height,
      },
      audio: audioBuffer
        ? {
            codec: 'aac',
            numberOfChannels: numberOfChannels,
            sampleRate: sampleRate,
          }
        : undefined,
      fastStart: 'in-memory', // 优化在线播放的 moov atom 前置
    });

    // 3. 配置视频编码器 (WebCodecs)
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        muxer.addVideoChunk(chunk, meta);
      },
      error: (e) => {
        console.error('[FastVideoEncoder] 视频编码错误:', e);
        encoderError = e instanceof Error ? e : new Error(String(e));
      },
    });

    videoEncoder.configure({
      codec: 'avc1.42001f', // 更加通用的 H.264 Baseline Profile 3.1 编码参数类型（小写）
      width: this.width,
      height: this.height,
      bitrate: this.bitrate,
    });

    // 4. 配置音频编码器 (WebCodecs) - 仅在有音频时
    let audioEncoder: AudioEncoder | null = null;
    if (audioBuffer) {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
          muxer.addAudioChunk(chunk, meta);
        },
        error: (e) => {
          console.error('[FastVideoEncoder] 音频编码错误:', e);
          encoderError = e instanceof Error ? e : new Error(String(e));
        },
      });

      audioEncoder.configure({
        codec: 'mp4a.40.2', // AAC-LC
        numberOfChannels: numberOfChannels,
        sampleRate: sampleRate,
        bitrate: 128_000, // 128 kbps
      });
    }

    // 5. 渲染并编码视频帧
    const totalFrames = Math.ceil(this.duration * this.fps);
    const frameInterval = 1 / this.fps;

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (this.isCancelled) {
        videoEncoder.close();
        if (audioEncoder) audioEncoder.close();
        throw new Error('Encoding cancelled');
      }
      if (encoderError) {
        throw encoderError;
      }

      // 控制背压：若编码器缓冲队列中的帧数过多，等待其处理，防止积压导致崩溃或挂起
      while (videoEncoder.encodeQueueSize > 8) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (encoderError) {
          throw encoderError;
        }
      }

      const timestamp = frameIndex * frameInterval;

      // 离线渲染该帧画面
      await this.drawFrameAtTime(ctx, timestamp);

      // 创建 WebCodecs VideoFrame
      const videoFrame = new VideoFrame(this.canvas, {
        timestamp: Math.round(timestamp * 1_000_000), // 微秒
        duration: Math.round(frameInterval * 1_000_000),
      });

      // 每 30 帧生成一个关键帧
      const keyFrame = frameIndex % 30 === 0;
      videoEncoder.encode(videoFrame, { keyFrame });
      videoFrame.close();

      // 更新进度：视频编码占 0% - 50%
      if (this.onProgress) {
        this.onProgress(Math.floor((frameIndex / totalFrames) * 50));
      }

      // 释放 CPU 阻塞，让 UI 线程有机会更新进度条
      if (frameIndex % 15 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // 刷新视频编码器，确保所有帧都输出并写入 muxer
    await videoEncoder.flush();

    // 6. 编码音频帧
    if (audioBuffer && audioEncoder) {
      const totalAudioFrames = audioBuffer.length;
      const CHUNK_SIZE = 1024; // AAC 编码标准块大小
      const totalChunks = Math.ceil(totalAudioFrames / CHUNK_SIZE);

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        if (this.isCancelled) {
          videoEncoder.close();
          if (audioEncoder) audioEncoder.close();
          throw new Error('Encoding cancelled');
        }
        if (encoderError) {
          throw encoderError;
        }

        // 控制背压：若音频编码器队列积压，等待其完成
        while (audioEncoder.encodeQueueSize > 8) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          if (encoderError) {
            throw encoderError;
          }
        }

        const chunkData = new Float32Array(numberOfChannels * CHUNK_SIZE);

        const startOffset = chunkIndex * CHUNK_SIZE;
        const endOffset = Math.min(startOffset + CHUNK_SIZE, totalAudioFrames);
        const readLength = endOffset - startOffset;

        for (let channel = 0; channel < numberOfChannels; channel++) {
          const channelData = audioBuffer.getChannelData(channel);
          const destOffset = channel * CHUNK_SIZE;
          
          // 拷贝声道 data
          const subArray = chunkData.subarray(destOffset, destOffset + readLength);
          subArray.set(channelData.subarray(startOffset, endOffset));
          
          // 不足 1024 个采样点，末尾补 0
          if (readLength < CHUNK_SIZE) {
            chunkData.fill(0, destOffset + readLength, destOffset + CHUNK_SIZE);
          }
        }

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: sampleRate,
          numberOfChannels: numberOfChannels,
          numberOfFrames: CHUNK_SIZE,
          timestamp: Math.round((startOffset / sampleRate) * 1_000_000), // 微秒
          data: chunkData,
        });

        audioEncoder.encode(audioData);
        audioData.close();

        // 更新进度：音频编码占 50% - 98%
        if (this.onProgress) {
          this.onProgress(50 + Math.floor((chunkIndex / totalChunks) * 48));
        }

        // 避免主线程假死
        if (chunkIndex % 60 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      // 刷新音频编码器
      await audioEncoder.flush();
    }

    // 7. 结束编码器并打包完成
    videoEncoder.close();
    if (audioEncoder) {
      audioEncoder.close();
    }

    muxer.finalize();

    if (this.onProgress) this.onProgress(100);

    // 8. 返回视频 Blob
    const { buffer } = muxer.target;
    return new Blob([buffer], { type: 'video/mp4' });
  }
}
