/**
 * 纯前端视频录制引擎 (VideoRecorder)
 * 通过捕捉 Canvas 的渲染画面和 Web Audio API 的音频流，在浏览器本地合成 MP4/WebM 视频。
 */
export class VideoRecorder {
  private canvas: HTMLCanvasElement;
  private audioStream: MediaStream;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private mimeType: string = '';

  constructor(canvas: HTMLCanvasElement, audioStream: MediaStream) {
    this.canvas = canvas;
    this.audioStream = audioStream;
    this.mimeType = this.getSupportedMimeType();
  }

  /**
   * 获取当前浏览器支持的最佳视频编码 MimeType
   */
  private getSupportedMimeType(): string {
    const candidateTypes = [
      // Chrome / Firefox 对 MP4 的实验性/标准支持
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=h264,aac',
      'video/mp4',
      // WebM 在 Chrome/Firefox/Safari 中有很好的硬件加速支持
      'video/webm;codecs=h264,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];

    for (const type of candidateTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log(`[VideoRecorder] 选中浏览器支持的编码格式: ${type}`);
        return type;
      }
    }
    console.warn('[VideoRecorder] 没有找到完美匹配的视频编码格式，将使用浏览器默认值');
    return '';
  }

  /**
   * 开始录制视频
   */
  public start(): void {
    this.recordedChunks = [];
    
    // 1. 获取 Canvas 的画面流 (30 帧/秒)
    const videoStream = this.canvas.captureStream(30);

    // 2. 将视频轨道和音频轨道混合到一个新的 MediaStream 中
    const tracks: MediaStreamTrack[] = [
      ...videoStream.getVideoTracks(),
      ...this.audioStream.getAudioTracks()
    ];
    
    const combinedStream = new MediaStream(tracks);

    // 3. 初始化 MediaRecorder
    const options = this.mimeType ? { mimeType: this.mimeType, videoBitsPerSecond: 5_000_000 } : {};
    this.mediaRecorder = new MediaRecorder(combinedStream, options);

    // 4. 监听录制数据
    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };

    // 5. 开启录制
    this.mediaRecorder.start(1000); // 每隔 1 秒切片一次，保障数据安全
    console.log('[VideoRecorder] 录制已开始...');
  }

  /**
   * 停止录制并返回视频 Blob 结果
   */
  public stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('MediaRecorder 尚未初始化或未启动'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        console.log('[VideoRecorder] 录制已停止，正在打包生成视频文件...');
        
        // 确定最终生成的文件类型后缀
        let extension = 'webm';
        if (this.mimeType.includes('video/mp4')) {
          extension = 'mp4';
        }
        
        const videoBlob = new Blob(this.recordedChunks, {
          type: this.mimeType || 'video/webm'
        });
        
        resolve(videoBlob);
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * 自动获取当前录制生成的文件后缀名 (.mp4 或 .webm)
   */
  public getFileExtension(): string {
    return this.mimeType.includes('video/mp4') ? 'mp4' : 'webm';
  }
}
