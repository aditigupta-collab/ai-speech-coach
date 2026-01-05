import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase"

export async function POST(request: NextRequest) {
  try {
    const { public_url, user_id, first_name } = await request.json()

    if (!public_url || !user_id || !first_name) {
      return NextResponse.json(
        { error: "Missing required fields: public_url, user_id, first_name" },
        { status: 400 }
      )
    }

    console.log("[API] Starting audio analysis for:", first_name)

    // Step 1: Download audio file from Supabase Storage
    console.log("[API] Downloading audio from:", public_url)
    const audioResponse = await fetch(public_url)
    if (!audioResponse.ok) {
      throw new Error(`Failed to download audio: ${audioResponse.statusText}`)
    }
    const audioBuffer = await audioResponse.arrayBuffer()
    console.log("[API] Audio downloaded, size:", audioBuffer.byteLength)

    // Step 2: Upload to AssemblyAI and transcribe
    console.log("[API] Starting AssemblyAI transcription...")
    const assemblyApiKey = process.env.ASSEMBLYAI_API_KEY
    if (!assemblyApiKey) {
      throw new Error("ASSEMBLYAI_API_KEY environment variable not set")
    }

    // Upload audio to AssemblyAI
    const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: {
        authorization: assemblyApiKey,
      },
      body: audioBuffer,
    })

    if (!uploadResponse.ok) {
      throw new Error(`AssemblyAI upload failed: ${uploadResponse.statusText}`)
    }

    const { upload_url } = await uploadResponse.json()
    console.log("[API] Audio uploaded to AssemblyAI")

    // Request transcription
    const transcriptResponse = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: {
        authorization: assemblyApiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        audio_url: upload_url,
      }),
    })

    if (!transcriptResponse.ok) {
      throw new Error(`AssemblyAI transcription request failed: ${transcriptResponse.statusText}`)
    }

    const { id: transcriptId } = await transcriptResponse.json()
    console.log("[API] Transcription requested, ID:", transcriptId)

    // Poll for transcription completion
    let transcript = null
    let pollingAttempts = 0
    const maxAttempts = 60 // 60 attempts * 2 seconds = 2 minutes max

    while (pollingAttempts < maxAttempts) {
      const pollingResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: {
          authorization: assemblyApiKey,
        },
      })

      const result = await pollingResponse.json()

      if (result.status === "completed") {
        transcript = result.text
        console.log("[API] Transcription completed")
        break
      } else if (result.status === "error") {
        throw new Error(`AssemblyAI transcription failed: ${result.error}`)
      }

      // Wait 2 seconds before next poll
      await new Promise((resolve) => setTimeout(resolve, 2000))
      pollingAttempts++
    }

    if (!transcript) {
      throw new Error("Transcription timed out after 2 minutes")
    }

    console.log("[API] Transcript:", transcript.substring(0, 100) + "...")

    // Step 3: Analyze with Claude
    console.log("[API] Analyzing with Claude...")
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are an expert Speech Coach. Analyze this transcript from a 60-second baseline speech.

Calculate WPM (Words Per Minute) assuming the text is approximately 60 seconds.

Count filler words (um, uh, like, you know, so, basically, actually, literally, honestly, just).

Set a 'First Win' goal based on the metrics. The goal should be specific, actionable, and personalized.

Transcript:
"""
${transcript}
"""

Output Requirement: Return ONLY valid JSON with no markdown formatting, no code blocks, and no explanatory text.

Schema: { "base_wpm": number, "base_filler_rate": number, "current_goal": string }`,
        },
      ],
    })

    // Extract JSON from Claude's response
    const responseText = message.content[0].type === "text" ? message.content[0].text : ""
    console.log("[API] Claude response:", responseText)

    // Parse JSON (handle potential markdown wrapping)
    let analysisResult
    try {
      // Try direct parse first
      analysisResult = JSON.parse(responseText)
    } catch {
      // If that fails, extract JSON from potential markdown code block
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error("Could not extract JSON from Claude response")
      }
      analysisResult = JSON.parse(jsonMatch[0])
    }

    console.log("[API] Analysis result:", analysisResult)

    // Validate response structure
    if (
      typeof analysisResult.base_wpm !== "number" ||
      typeof analysisResult.base_filler_rate !== "number" ||
      typeof analysisResult.current_goal !== "string"
    ) {
      throw new Error("Invalid analysis result structure from Claude")
    }

    // Step 4: Update Supabase
    console.log("[API] Updating Supabase...")
    const supabase = createClient()

    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        first_name,
        base_wpm: analysisResult.base_wpm,
        base_filler_rate: analysisResult.base_filler_rate,
        current_goal: analysisResult.current_goal,
      })
      .eq("id", user_id)

    if (updateError) {
      console.error("[API] Supabase update error:", updateError)
      throw new Error(`Failed to update profile: ${updateError.message}`)
    }

    console.log("[API] Analysis complete!")

    // Step 5: Return results
    return NextResponse.json({
      base_wpm: analysisResult.base_wpm,
      base_filler_rate: analysisResult.base_filler_rate,
      current_goal: analysisResult.current_goal,
    })
  } catch (error) {
    console.error("[API] Error processing audio:", error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to process audio",
      },
      { status: 500 }
    )
  }
}
