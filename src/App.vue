<script setup lang="ts">
import LyricVideoCanvas from './components/LyricVideoCanvas.vue'
</script>

<template>
  <div class="min-h-screen bg-[#070a13] text-slate-100 flex flex-col font-sans">
    <!-- Header -->
    <header class="w-full border-b border-slate-900 bg-[#090d1a]/80 backdrop-blur-md sticky top-0 z-40">
      <div class="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-rose-500 text-xl font-black tracking-wider uppercase flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse"></span>
            LyricLab
          </span>
          <span class="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">MVP</span>
        </div>
        <div class="text-xs text-slate-400">
          本地离线压制 • 零服务器负载
        </div>
      </div>
    </header>

    <!-- Main -->
    <main class="flex-grow flex items-center justify-center py-6">
      <LyricVideoCanvas />
    </main>

    <!-- Footer -->
    <footer class="w-full border-t border-slate-900/60 py-6 text-center text-xs text-slate-500 bg-[#070a13]">
      LyricLab Karaoke Video Maker © 2026. Made for high performance.
    </footer>
  </div>
</template>
