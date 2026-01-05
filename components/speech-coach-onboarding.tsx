"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Mic, Square, Loader2, CheckCircle2, TrendingUp, MessageSquare, Target, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase"

type AnalysisResult = {
  base_wpm: number
  base_filler_rate: number
  current_goal: string
}

type OnboardingStep = "intro" | "recording" | "analyzing" | "results"

export function SpeechCoachOnboarding() {
  const [step, setStep] = useState<OnboardingStep>("intro")
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [firstName, setFirstName] = useState("")

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const MAX_RECORDING_TIME = 60

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }
    }
  }, [])

  const startRecording = async () => {
    if (!firstName.trim()) {
      setError("Please enter your first name before recording")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        await handleRecordingComplete()
      }

      mediaRecorder.start()
      setIsRecording(true)
      setRecordingTime(0)
      setStep("recording")

      timerIntervalRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          if (prev >= MAX_RECORDING_TIME) {
            stopRecording()
            return MAX_RECORDING_TIME
          }
          return prev + 1
        })
      }, 1000)
    } catch (err) {
      setError("Failed to access microphone. Please check permissions.")
      console.error("[v0] Microphone access error:", err)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!firstName.trim()) {
      setError("Please enter your first name before uploading")
      return
    }

    const file = event.target.files?.[0]
    if (!file) return

    const validTypes = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/webm", "audio/ogg", "audio/m4a"]
    if (!validTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|webm|ogg|m4a)$/i)) {
      setError("Please upload a valid audio file (MP3, WAV, WEBM, OGG, or M4A)")
      return
    }

    if (file.size > 50 * 1024 * 1024) {
      setError("File size must be less than 50MB")
      return
    }

    await processAudioFile(file, file.name)
  }

  const processAudioFile = async (audioBlob: Blob, originalFileName?: string) => {
    setStep("analyzing")
    setError(null)

    try {
      console.log("[v0] Starting audio processing...")
      console.log("[v0] Audio blob created, size:", audioBlob.size)

      let extension = "webm" // Default for microphone recordings

      // If original filename provided (from upload), extract its extension
      if (originalFileName) {
        const match = originalFileName.match(/\.([^.]+)$/i)
        if (match) {
          extension = match[1].toLowerCase()
        }
      } else {
        // For recordings, detect from MIME type
        if (audioBlob.type.includes("mpeg")) extension = "mp3"
        else if (audioBlob.type.includes("mp3")) extension = "mp3"
        else if (audioBlob.type.includes("wav")) extension = "wav"
        else if (audioBlob.type.includes("m4a")) extension = "m4a"
      }

      const fileName = `speech_${Date.now()}.${extension}`
      const supabase = createClient()

      console.log("[v0] Uploading to Supabase Storage...")
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("audio_files")
        .upload(fileName, audioBlob)

      if (uploadError) {
        console.error("[v0] Supabase upload error:", uploadError)
        throw new Error(`Upload failed: ${uploadError.message}`)
      }

      console.log("[v0] Upload successful:", uploadData)

      const {
        data: { publicUrl },
      } = supabase.storage.from("audio_files").getPublicUrl(fileName)

      console.log("[v0] Public URL generated:", publicUrl)

      const {
        data: { user },
      } = await supabase.auth.getUser()
      const userId = user?.id || "anonymous"

      console.log("[v0] User ID:", userId)

      // Call our new Next.js API route instead of n8n webhook
      const apiUrl = "/api/analyze-speech"

      const apiPayload = {
        public_url: publicUrl,
        user_id: userId,
        first_name: firstName.trim(),
      }

      console.log("[v0] Calling API route:", apiUrl)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 120000) // 2 minutes for transcription + analysis

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(apiPayload),
        signal: controller.signal,
      }).catch((fetchError) => {
        if (fetchError.name === "AbortError") {
          throw new Error("Analysis request timed out after 2 minutes")
        }
        throw new Error(`Network error: ${fetchError.message}`)
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        let errorMessage = `API request failed (${response.status})`
        try {
          const errorData = await response.json()
          if (errorData.error) {
            errorMessage = `Analysis error: ${errorData.error}`
          }
        } catch {
          errorMessage = `API request failed with status ${response.status}: ${response.statusText}`
        }
        throw new Error(errorMessage)
      }

      const result: AnalysisResult = await response.json()
      console.log("[v0] Analysis result received:", result)

      setAnalysisResult(result)
      setStep("results")
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to process recording"
      setError(errorMessage)
      setStep("intro")
    }
  }

  const handleRecordingComplete = async () => {
    const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" })
    await processAudioFile(audioBlob)
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const resetFlow = () => {
    setStep("intro")
    setRecordingTime(0)
    setAnalysisResult(null)
    setError(null)
    setFirstName("")
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted p-4">
      <div className="w-full max-w-2xl">
        {step === "intro" && (
          <Card className="border-2">
            <CardHeader className="text-center space-y-2">
              <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                <Mic className="w-8 h-8 text-primary" />
              </div>
              <CardTitle className="text-3xl font-bold">Welcome to AI Speech Coach</CardTitle>
              <CardDescription className="text-base">Let's establish your baseline speaking patterns</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="firstName" className="text-base">
                  First Name
                </Label>
                <Input
                  id="firstName"
                  type="text"
                  placeholder="Enter your first name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="text-base"
                />
              </div>

              <div className="bg-muted rounded-lg p-6 space-y-3">
                <h3 className="font-semibold text-lg">What we'll analyze:</h3>
                <ul className="space-y-2">
                  <li className="flex items-start gap-3">
                    <TrendingUp className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <span className="text-sm leading-relaxed">
                      <strong>Words Per Minute</strong> — Your natural speaking pace
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <MessageSquare className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <span className="text-sm leading-relaxed">
                      <strong>Filler Words</strong> — Usage of "um", "uh", "like", etc.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Target className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <span className="text-sm leading-relaxed">
                      <strong>Personalized Goal</strong> — Custom improvement recommendation
                    </span>
                  </li>
                </ul>
              </div>

              <div className="bg-accent/50 rounded-lg p-4 border border-border">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">Tip:</strong> Speak naturally about your day, a hobby, or any
                  topic you're comfortable with. Recording will automatically stop after 60 seconds.
                </p>
              </div>

              {error && (
                <div className="bg-destructive/10 text-destructive rounded-lg p-4 border border-destructive/20">
                  <p className="text-sm">{error}</p>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Button onClick={startRecording} size="lg" className="w-full" disabled={isRecording}>
                  <Mic className="w-5 h-5 mr-2" />
                  Record Audio
                </Button>

                <Button onClick={() => fileInputRef.current?.click()} size="lg" variant="outline" className="w-full">
                  <Upload className="w-5 h-5 mr-2" />
                  Upload Audio
                </Button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.webm,.ogg,.m4a"
                onChange={handleFileUpload}
                className="hidden"
              />
            </CardContent>
          </Card>
        )}

        {step === "recording" && (
          <Card className="border-2">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Recording Your Speech...</CardTitle>
              <CardDescription>Speak naturally and clearly</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col items-center justify-center py-8">
                <div className="relative">
                  <div className="w-32 h-32 rounded-full bg-destructive/20 flex items-center justify-center animate-pulse">
                    <div className="w-24 h-24 rounded-full bg-destructive/40 flex items-center justify-center">
                      <Mic className="w-12 h-12 text-destructive" />
                    </div>
                  </div>
                </div>

                <div className="mt-8 text-center space-y-2">
                  <div className="text-5xl font-bold font-mono tabular-nums">{formatTime(recordingTime)}</div>
                  <div className="text-sm text-muted-foreground">/ {formatTime(MAX_RECORDING_TIME)}</div>
                </div>
              </div>

              <div className="space-y-2">
                <Progress value={(recordingTime / MAX_RECORDING_TIME) * 100} className="h-2" />
                <p className="text-xs text-center text-muted-foreground">
                  {MAX_RECORDING_TIME - recordingTime} seconds remaining
                </p>
              </div>

              <Button onClick={stopRecording} variant="destructive" size="lg" className="w-full">
                <Square className="w-5 h-5 mr-2" />
                Stop Recording
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "analyzing" && (
          <Card className="border-2">
            <CardContent className="py-16">
              <div className="flex flex-col items-center justify-center space-y-6">
                <Loader2 className="w-16 h-16 text-primary animate-spin" />
                <div className="text-center space-y-2">
                  <h3 className="text-2xl font-semibold">Analyzing Speech Patterns...</h3>
                  <p className="text-muted-foreground">Our AI is processing your recording</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "results" && analysisResult && (
          <Card className="border-2">
            <CardHeader className="text-center space-y-2">
              <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                <CheckCircle2 className="w-8 h-8 text-primary" />
              </div>
              <CardTitle className="text-3xl font-bold">Your Baseline Report</CardTitle>
              <CardDescription className="text-base">Here's what we learned about your speaking style</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="bg-muted/50">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-primary" />
                      <CardTitle className="text-lg">Speaking Pace</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-4xl font-bold">{analysisResult.base_wpm}</div>
                    <div className="text-sm text-muted-foreground mt-1">Words per minute</div>
                  </CardContent>
                </Card>

                <Card className="bg-muted/50">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-primary" />
                      <CardTitle className="text-lg">Filler Words</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-4xl font-bold">{analysisResult.base_filler_rate}</div>
                    <div className="text-sm text-muted-foreground mt-1">Total count</div>
                  </CardContent>
                </Card>
              </div>

              <Card className="bg-primary/5 border-primary/20">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Target className="w-5 h-5 text-primary" />
                    <CardTitle className="text-lg">Your Personalized Goal</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">{analysisResult.current_goal}</p>
                </CardContent>
              </Card>

              <Button onClick={resetFlow} size="lg" className="w-full">
                Record Another Sample
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
