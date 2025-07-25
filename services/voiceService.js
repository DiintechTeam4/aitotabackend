const WebSocket = require("ws")
const { SarvamAIClient } = require("sarvamai")

class VoiceService {
  constructor() {
    this.sarvamApiKey = process.env.SARVAM_API_KEY
    this.openaiApiKey = process.env.OPENAI_API_KEY
    this.deepgramApiKey = process.env.DEEPGRAM_API_KEY
  }

  // Convert text to speech using Sarvam AI (matching your unifiedVoiceServer)
  async textToSpeech(text, language = "en", speaker = null) {
    if (!this.sarvamApiKey || !text.trim()) {
      throw new Error("Sarvam API key not configured or empty text provided")
    }

    try {
      // Build request body matching your unifiedVoiceServer implementation
      const requestBody = {
        inputs: [text],
        target_language_code: language === "hi" ? "hi-IN" : "en-IN",
        speaker: speaker || (language === "hi" ? "anushka" : "abhilash"),
        pitch: 0,
        pace: 1.0,
        loudness: 1.0,
        speech_sample_rate: 22050,
        enable_preprocessing: true,
        model: "bulbul:v2",
      }

      console.log("[VOICE_SERVICE] TTS Request:", requestBody)

      const response = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "API-Subscription-Key": this.sarvamApiKey,
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { error: errorText }
        }
        console.error("[VOICE_SERVICE] API Error:", {
          status: response.status,
          error: errorData.error || "Unknown error",
          requestBody,
        })
        throw new Error(`Sarvam AI API error: ${response.status} - ${errorData.error || "Unknown error"}`)
      }

      const responseData = await response.json()
      if (!responseData.audios || responseData.audios.length === 0) {
        throw new Error("No audio data received from Sarvam AI")
      }

      // Convert base64 audio to buffer (bytes format for database storage)
      const audioBase64 = responseData.audios[0]
      const audioBuffer = Buffer.from(audioBase64, "base64")

      console.log(`[VOICE_SERVICE] Audio generated successfully: ${audioBuffer.length} bytes`)

      return {
        audioBuffer: audioBuffer,
        audioBase64: audioBase64,
        sampleRate: 22050,
        channels: 1,
        format: "mp3",
      }
    } catch (error) {
      console.error(`[VOICE_SERVICE] TTS error: ${error.message}`)
      throw error
    }
  }

  // Convert buffer to Python bytes string format (matching your unifiedVoiceServer)
  bufferToPythonBytesString(buffer) {
    let result = "b'"
    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i]
      if (byte >= 32 && byte <= 126 && byte !== 92 && byte !== 39) {
        result += String.fromCharCode(byte)
      } else {
        result += "\\x" + byte.toString(16).padStart(2, "0")
      }
    }
    result += "'"
    return result
  }

  // Create WAV header for audio processing
  createWAVHeader(audioBuffer, sampleRate = 22050, channels = 1, bitsPerSample = 16) {
    const byteRate = (sampleRate * channels * bitsPerSample) / 8
    const blockAlign = (channels * bitsPerSample) / 8
    const dataSize = audioBuffer.length
    const fileSize = 36 + dataSize

    const header = Buffer.alloc(44)
    let offset = 0

    header.write("RIFF", offset)
    offset += 4
    header.writeUInt32LE(fileSize, offset)
    offset += 4
    header.write("WAVE", offset)
    offset += 4
    header.write("fmt ", offset)
    offset += 4
    header.writeUInt32LE(16, offset)
    offset += 4
    header.writeUInt16LE(1, offset)
    offset += 2
    header.writeUInt16LE(channels, offset)
    offset += 2
    header.writeUInt32LE(sampleRate, offset)
    offset += 4
    header.writeUInt32LE(byteRate, offset)
    offset += 4
    header.writeUInt16LE(blockAlign, offset)
    offset += 2
    header.writeUInt16LE(bitsPerSample, offset)
    offset += 2
    header.write("data", offset)
    offset += 4
    header.writeUInt32LE(dataSize, offset)

    return Buffer.concat([header, audioBuffer])
  }

  // Test API connectivity
  async testConnection() {
    try {
      const testText = "Hello, this is a test message."
      const result = await this.textToSpeech(testText, "en")
      return {
        success: true,
        message: "Voice service connection successful",
        audioSize: result.size,
      }
    } catch (error) {
      return {
        success: false,
        message: `Voice service connection failed: ${error.message}`,
      }
    }
  }
}

module.exports = VoiceService
