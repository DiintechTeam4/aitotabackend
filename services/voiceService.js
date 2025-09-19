const WebSocket = require("ws")
const { SarvamAIClient } = require("sarvamai")

class VoiceService {
  constructor() {
    this.sarvamApiKey = process.env.SARVAM_API_KEY
    this.elevenlabsApiKey = process.env.ELEVENLABS_API_KEY
    this.openaiApiKey = process.env.OPENAI_API_KEY
    this.deepgramApiKey = process.env.DEEPGRAM_API_KEY
  }

  // Voice mappings for different services
  getVoiceMappings() {
    return {
      sarvam: {
        anushka: { name: "Anushka", id: "anushka" },
        meera: { name: "Meera", id: "meera" },
        pavithra: { name: "Pavithra", id: "pavithra" },
        maitreyi: { name: "Maitreyi", id: "maitreyi" },
        arvind: { name: "Arvind", id: "arvind" },
        amol: { name: "Amol", id: "amol" },
        amartya: { name: "Amartya", id: "amartya" },
        diya: { name: "Diya", id: "diya" },
        neel: { name: "Neel", id: "neel" },
        misha: { name: "Misha", id: "misha" },
        vian: { name: "Vian", id: "vian" },
        arjun: { name: "Arjun", id: "arjun" },
        maya: { name: "Maya", id: "maya" },
      },
      elevenlabs: {
        kumaran: { name: "Kumaran", id: "rgltZvTfiMmgWweZhh7n" },
        monika: { name: "Monika", id: "NaKPQmdr7mMxXuXrNeFC" },
        aahir: { name: "Aahir", id: "RKshBIkZ7DwU6YNPq5Jd" },
        kanika: { name: "Kanika", id: "xccfcojYYGnqTTxwZEDU" },
      }
    }
  }

  // Basic allowlist of supported Sarvam voices for bulbul:v2
  // Extend as needed based on provider docs
  getSupportedSpeakers() {
    return new Set([
      "abhilash",
      "anushka",
      "karun",
      "manisha",
      "vidya",
      "arya",
      "hitesh",
    ])
  }

  getDefaultSpeakerForLanguage(language) {
    const lang = (language || "en").toLowerCase()
    return lang === "hi" ? "anushka" : "abhilash"
  }

  sanitizeSpeaker(language, requestedSpeaker) {
    const supported = this.getSupportedSpeakers()
    if (!requestedSpeaker || typeof requestedSpeaker !== "string") {
      return this.getDefaultSpeakerForLanguage(language)
    }
    const speakerLower = requestedSpeaker.toLowerCase()
    if (!supported.has(speakerLower)) {
      console.warn(
        `[VOICE_SERVICE] Unsupported speaker '${requestedSpeaker}'. Falling back to default for language '${language}'.`
      )
      return this.getDefaultSpeakerForLanguage(language)
    }
    return speakerLower
  }

  // Convert text to speech using Sarvam AI or ElevenLabs
  async textToSpeech(text, language = "en", speaker = null, serviceProvider = "sarvam") {
    if (!text.trim()) {
      throw new Error("Empty text provided")
    }

    if (serviceProvider === "elevenlabs") {
      return await this.textToSpeechElevenLabs(text, language, speaker)
    } else {
      return await this.textToSpeechSarvam(text, language, speaker)
    }
  }

  // Convert text to speech using Sarvam AI (matching your unifiedVoiceServer)
  async textToSpeechSarvam(text, language = "en", speaker = null) {
    if (!this.sarvamApiKey) {
      throw new Error("Sarvam API key not configured")
    }

    try {
      // Build request body matching your unifiedVoiceServer implementation
      const targetLanguage = language === "hi" ? "hi-IN" : "en-IN"
      const safeSpeaker = this.sanitizeSpeaker(language, speaker)
      const requestBody = {
        inputs: [text],
        target_language_code: targetLanguage,
        speaker: safeSpeaker,
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
        const extractedMessage =
          (typeof errorData.error === "string" && errorData.error) ||
          (typeof errorData.message === "string" && errorData.message) ||
          (errorData.error && errorData.error.message) ||
          JSON.stringify(errorData)
        console.error("[VOICE_SERVICE] API Error:", {
          status: response.status,
          error: extractedMessage,
          requestBody,
        })
        // Retry once with minimal payload and default speaker on 400
        if (response.status === 400) {
          const fallbackBody = {
            inputs: [text],
            target_language_code: targetLanguage,
            speaker: this.getDefaultSpeakerForLanguage(language),
            model: "bulbul:v2",
          }
          console.warn("[VOICE_SERVICE] Retrying with minimal payload:", fallbackBody)
          const retryRes = await fetch("https://api.sarvam.ai/text-to-speech", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "API-Subscription-Key": this.sarvamApiKey,
            },
            body: JSON.stringify(fallbackBody),
          })
          if (retryRes.ok) {
            const retryData = await retryRes.json()
            if (!retryData.audios || retryData.audios.length === 0) {
              throw new Error("No audio data received from Sarvam AI (fallback)")
            }
            const audioBase64 = retryData.audios[0]
            const audioBuffer = Buffer.from(audioBase64, "base64")
            console.log(`[VOICE_SERVICE] Fallback audio generated: ${audioBuffer.length} bytes`)
            return {
              audioBuffer,
              audioBase64,
              sampleRate: 22050,
              channels: 1,
              format: "mp3",
              usedSpeaker: this.getDefaultSpeakerForLanguage(language),
              targetLanguage,
            }
          } else {
            const retryErrText = await retryRes.text()
            let retryErr
            try { retryErr = JSON.parse(retryErrText) } catch { retryErr = { error: retryErrText } }
            const retryMsg = retryErr.error || retryErr.message || JSON.stringify(retryErr)
            throw new Error(`Sarvam AI API error: 400 (retry failed) - ${retryMsg}`)
          }
        }
        throw new Error(`Sarvam AI API error: ${response.status} - ${extractedMessage}`)
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
        usedSpeaker: safeSpeaker,
        targetLanguage: targetLanguage,
      }
    } catch (error) {
      console.error(`[VOICE_SERVICE] TTS error: ${error.message}`)
      throw error
    }
  }

  // Convert text to speech using ElevenLabs
  async textToSpeechElevenLabs(text, language = "en", speaker = null) {
    if (!this.elevenlabsApiKey) {
      throw new Error("ElevenLabs API key not configured")
    }

    try {
      const voiceMappings = this.getVoiceMappings()
      const voiceId = voiceMappings.elevenlabs[speaker]?.id || voiceMappings.elevenlabs.kumaran.id
      
      const requestBody = {
        text: text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5
        }
      }

      console.log("[VOICE_SERVICE] ElevenLabs TTS Request:", { voiceId, textLength: text.length })

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": this.elevenlabsApiKey,
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
        const extractedMessage =
          (typeof errorData.error === "string" && errorData.error) ||
          (typeof errorData.message === "string" && errorData.message) ||
          (errorData.error && errorData.error.message) ||
          JSON.stringify(errorData)
        console.error("[VOICE_SERVICE] ElevenLabs API Error:", {
          status: response.status,
          error: extractedMessage,
          voiceId,
        })
        throw new Error(`ElevenLabs API error: ${response.status} - ${extractedMessage}`)
      }

      const audioBuffer = await response.arrayBuffer()
      const audioBase64 = Buffer.from(audioBuffer).toString('base64')

      console.log(`[VOICE_SERVICE] ElevenLabs audio generated successfully: ${audioBuffer.byteLength} bytes`)

      return {
        audioBuffer: Buffer.from(audioBuffer),
        audioBase64: audioBase64,
        sampleRate: 22050,
        channels: 1,
        format: "mp3",
        usedSpeaker: speaker,
        targetLanguage: language,
        serviceProvider: "elevenlabs",
      }
    } catch (error) {
      console.error(`[VOICE_SERVICE] ElevenLabs TTS error: ${error.message}`)
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
