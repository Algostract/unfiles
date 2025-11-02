import { execa } from 'execa'

export const codecs = ['avc', 'vp9', 'hevc', 'av1'] as const
export type Codec = (typeof codecs)[number]

export const resolutions = ['1440p', '1080p', '720p'] as const

export const devices = ['cpu', 'gpu'] as const
export type Device = (typeof devices)[number]

const codecOptions = {
  avc: {
    extension: 'mp4',
    cpu: { lib: 'libx264', preset: 'slower', extra: '-threads 0', audio: 'aac' },
    gpu: { lib: 'h264_nvenc', preset: 'slower', audio: 'aac' },
  },
  vp9: {
    extension: 'webm',
    cpu: { lib: 'libvpx-vp9', deadline: 'best', extra: '-threads 0', audio: 'libvorbis' },
  },
  hevc: {
    extension: 'mp4',
    cpu: { lib: 'libx265', preset: 'slow', extra: '-threads 0', audio: 'aac' },
    gpu: { lib: 'h265_nvenc', preset: 'slow', audio: 'aac' },
  },
  av1: {
    extension: 'webm',
    cpu: { lib: 'libsvtav1', preset: '1', extra: '-threads 0', audio: 'libopus' },
    gpu: { lib: 'av1_nvenc', preset: '1', audio: 'libopus' },
  },
} as const

interface CodecDeviceOptions {
  lib: string
  preset?: string
  deadline?: string
  extra?: string
  audio: string
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function mapQualityToValue(codec: Codec, mode: Device, quality: number): { flag: '-crf' | '-cq'; value: number; extra?: string[] } {
  // quality: 0..100, higher is better quality (lower crf/cq)
  const q = clamp(quality ?? 60, 0, 100)
  const t = q / 100

  switch (codec) {
    case 'avc': {
      if (mode === 'gpu') {
        // NVENC CQ 0..51 (0=auto), map 0..100 -> 40..20 (rounded)
        const cq = Math.round(40 - t * 20)
        return { flag: '-cq', value: clamp(cq, 1, 51), extra: ['-rc', 'vbr'] }
      }
      // x264 CRF sane range ~17..28, map 0..100 -> 28..18
      const crf = Math.round(28 - t * 10)
      return { flag: '-crf', value: clamp(crf, 0, 51) }
    }
    case 'hevc': {
      if (mode === 'gpu') {
        const cq = Math.round(40 - t * 20)
        return { flag: '-cq', value: clamp(cq, 1, 51), extra: ['-rc', 'vbr'] }
      }
      // x265 defaults higher; map 0..100 -> 30..20
      const crf = Math.round(30 - t * 10)
      return { flag: '-crf', value: clamp(crf, 0, 51) }
    }
    case 'vp9': {
      // VP9 CRF 0..63, common ~31 with -b:v 0; map 0..100 -> 40..20
      const crf = Math.round(40 - t * 20)
      return { flag: '-crf', value: clamp(crf, 0, 63) }
    }
    case 'av1': {
      if (mode === 'gpu') {
        // NVENC AV1 CQ 0..51
        const cq = Math.round(40 - t * 20)
        return { flag: '-cq', value: clamp(cq, 1, 51), extra: ['-rc', 'vbr'] }
      }
      // SVT-AV1 CRF 0..63; map 0..100 -> 40..20
      const crf = Math.round(40 - t * 20)
      return { flag: '-crf', value: clamp(crf, 0, 63) }
    }
  }
}

function buildArgs(
  codecOptions: { cpu: CodecDeviceOptions; gpu?: CodecDeviceOptions },
  inputRes: { width: number; height: number },
  outputRes: { width: number; height: number },
  mode: Device,
  codec: Codec,
  quality: number
): string {
  const { width, height } = outputRes
  const padFilter = inputRes.width < width || inputRes.height < height ? `,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2` : ``
  const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2${padFilter}`
  const options = codecOptions[mode]!
  const q = mapQualityToValue(codec, mode, quality)
  const qualityFlag = `${q.flag} ${q.value}`
  const rateExtras = q.extra ? ` ${q.extra.join(' ')}` : ''

  // Keep your preset/deadline branching
  const speedFlag = `-${options.preset ? 'preset ' + options.preset : 'deadline ' + options.deadline}`

  // For CPU CRF, keep -b:v 0 for constant quality where it applies; for NVENC CQ use -rc vbr and omit -b:v 0
  const isGPU = mode === 'gpu'
  const bv0 = !isGPU ? ' -b:v 0' : ''

  const extra = mode === 'cpu' && options.extra ? ` ${options.extra}` : ''
  return `-c:v ${options.lib} -vf "${scaleFilter}" ${qualityFlag}${bv0} ${speedFlag}${rateExtras}${extra} -c:a ${options.audio}`
}

function parseArgs(args: string): string[] {
  const regex = /[^\s"]+|"([^"]*)"/gi
  const result: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(args)) !== null) {
    result.push(match[1] ? match[1] : match[0])
  }
  return result
}

async function countTotalFrames(filePath: string) {
  try {
    const ffmpegProcess = await execa('ffmpeg', ['-i', filePath, '-map', '0:v:0', '-f', 'null', '-'], {
      stderr: 'pipe',
    })
    const progressLog = ffmpegProcess.stderr.toString()
    const matches = [...progressLog.matchAll(/frame=\s*(\d+)/g)]
    if (matches.length === 0) {
      return 0
    }
    const lastFrameCount = parseInt(matches[matches.length - 1][1], 10)
    return lastFrameCount
  } catch {
    throw Error('Unable to countTotalFrames ' + filePath)
  }
}

// Assume getDimension + ensureDir + onUpdate exist in your module scope

export default async function (
  filePath: string,
  outputPath: string,
  expectedDim: { width: number; height: number },
  codec: Codec,
  quality: number = 60,
  device: Device = 'cpu',
  onUpdate?: (args: { fileName: string; status: string; completion: number; eta: number; fps: number }) => void
) {
  const fileName = filePath.split('/').at(-1)!
  const originalDim = await getDimension(filePath, 'video')

  const cOpt = codecOptions[codec]
  if (!cOpt) throw new Error(`Codec ${codec} not supported`)

  const presetName = `${codec}-${expectedDim.height}p-${expectedDim.width >= expectedDim.height ? 'landscape' : 'portrait'}`

  const selectedArgs =
    device === 'gpu'
      ? 'gpu' in cOpt && cOpt.gpu
        ? buildArgs(cOpt, originalDim, expectedDim, 'gpu', codec, quality)
        : (() => {
            throw new Error(`GPU not supported for codec ${codec}`)
          })()
      : buildArgs(cOpt, originalDim, expectedDim, 'cpu', codec, quality)

  try {
    console.log(`Conversion started ${fileName} to ${presetName}`)
    if (onUpdate) onUpdate({ fileName, status: `start-${presetName}`, completion: 0, eta: Infinity, fps: 0 })

    const totalFrames = await countTotalFrames(filePath)
    const progressData: Record<string, string> = {}

    await ensureDir(outputPath)

    const ffmpegProcess = execa('ffmpeg', ['-y', '-i', filePath, ...parseArgs(selectedArgs), outputPath, '-progress', 'pipe:1'], { stdout: 'pipe', stderr: 'pipe' })

    ffmpegProcess.stdout.on('data', (chunk) => {
      chunk
        .toString()
        .split('\n')
        .forEach((line: string) => {
          const [key, value] = line.split('=')
          if (key && value) progressData[key.trim()] = value.trim()
        })
    })

    const progressInterval = setInterval(() => {
      if (progressData.out_time_ms) {
        const processedFrames = parseInt(progressData.frame, 10)
        const fps = parseFloat(progressData.fps)
        if (Number.isNaN(processedFrames) || Number.isNaN(fps)) return
        const completion = Number(((processedFrames / totalFrames) * 100).toFixed(2))
        const eta = Number(((totalFrames - processedFrames) / fps).toFixed(2))
        if (onUpdate) onUpdate({ fileName, status: `process-${presetName}`, completion, eta, fps })
      }
    }, 1000)

    await ffmpegProcess
    clearInterval(progressInterval)

    console.log(`Conversion complete ${fileName} to ${presetName}`)
    if (onUpdate) onUpdate({ fileName, status: `complete-${presetName}`, completion: 100, eta: 0, fps: 0 })

    return { status: 'fulfilled', value: presetName }
  } catch (error) {
    console.error('transcode-video ', error)
    return {
      status: 'rejected',
      value: presetName,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
