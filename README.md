# AI Speech Coach

An AI-powered speech coaching application that analyzes speaking patterns and provides personalized improvement recommendations. Powered by Claude (Anthropic API), AssemblyAI, and Supabase.

## Features

- Record or upload audio (up to 60 seconds)
- Real-time audio transcription with AssemblyAI
- AI-powered speech analysis with Claude
- Calculates Words Per Minute (WPM)
- Detects filler word usage
- Generates personalized coaching goals
- Stores baseline metrics in Supabase

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS, Shadcn/ui
- **Backend**: Next.js API Routes
- **AI**: Anthropic Claude (Sonnet 4.5) for analysis
- **Transcription**: AssemblyAI API
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage

## Architecture

This application uses Claude API directly instead of n8n workflows:

```
User → Frontend → Supabase Storage
                     ↓
               Next.js API Route
                     ↓
            AssemblyAI (transcription)
                     ↓
            Claude API (analysis)
                     ↓
            Supabase Database
                     ↓
            Results → Frontend
```

## Prerequisites

Before you begin, you'll need:

1. **Node.js** (v18 or higher)
2. **Supabase Account** - [Sign up here](https://supabase.com)
3. **Anthropic API Key** - [Get it here](https://console.anthropic.com)
4. **AssemblyAI API Key** - [Get it here](https://www.assemblyai.com)

## Setup Instructions

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd ai-speech-coach-component
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Supabase

#### Create a Supabase Project

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Click "New Project"
3. Fill in project details

#### Create the Database Table

Run this SQL in the Supabase SQL Editor:

```sql
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  base_wpm INTEGER,
  base_filler_rate INTEGER,
  current_goal TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Create Storage Bucket

1. Go to Storage in Supabase Dashboard
2. Create a new bucket called `audio_files`
3. Set it to Public (for prototype - configure proper security later)

#### Get API Credentials

1. Go to Project Settings > API
2. Copy your `Project URL` and `anon public` key

### 4. Get API Keys

#### Anthropic API Key

1. Visit [Anthropic Console](https://console.anthropic.com/settings/keys)
2. Create a new API key
3. Copy the key (starts with `sk-ant-`)

#### AssemblyAI API Key

1. Visit [AssemblyAI Dashboard](https://www.assemblyai.com/app/account)
2. Copy your API key
3. Free tier includes 100 hours/month

### 5. Configure Environment Variables

Create a `.env.local` file in the project root:

```bash
cp .env.example .env.local
```

Edit `.env.local` and add your credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
ANTHROPIC_API_KEY=sk-ant-your_key
ASSEMBLYAI_API_KEY=your_assemblyai_key
```

### 6. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Enter your first name
2. Choose to either:
   - **Record Audio**: Click "Record Audio" and speak for up to 60 seconds
   - **Upload Audio**: Click "Upload Audio" and select an audio file (MP3, WAV, WEBM, OGG, M4A)
3. Wait for the AI analysis (takes 10-30 seconds)
4. View your baseline metrics and personalized goal

## Project Structure

```
ai-speech-coach-component/
├── app/
│   ├── api/
│   │   └── analyze-speech/
│   │       └── route.ts          # Main API endpoint
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Home page
│   └── globals.css               # Global styles
├── components/
│   ├── speech-coach-onboarding.tsx  # Main component
│   └── ui/                       # Shadcn UI components
├── lib/
│   ├── supabase.ts               # Supabase client
│   └── utils.ts                  # Utilities
├── .env.example                  # Environment template
├── .gitignore                    # Git ignore rules
└── package.json                  # Dependencies
```

## API Route Details

The `/api/analyze-speech` endpoint:

1. Receives audio URL from frontend
2. Downloads audio from Supabase Storage
3. Uploads to AssemblyAI for transcription
4. Polls AssemblyAI until transcription completes
5. Sends transcript to Claude for analysis
6. Updates Supabase with results
7. Returns analysis to frontend

## Migration from n8n

This project was migrated from using n8n workflows to direct Claude API integration:

**Before**: Frontend → n8n → OpenAI Whisper → OpenAI GPT-4 → Supabase
**After**: Frontend → Next.js API Route → AssemblyAI → Claude → Supabase

Benefits:
- No external workflow dependencies
- Faster development iteration
- Better error handling
- Easier to deploy and scale
- More cost-effective

## Deployment

### Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Make sure to add all environment variables in the Vercel dashboard.

## Troubleshooting

### Transcription Timing Out

- AssemblyAI can take 30-60 seconds for longer files
- The timeout is set to 2 minutes by default
- Check AssemblyAI dashboard for quota limits

### Claude API Errors

- Verify your API key is correct
- Check you have sufficient API credits
- Review rate limits in Anthropic Console

### Audio Upload Issues

- Ensure Supabase storage bucket is public
- Check file size (max 50MB)
- Verify supported formats: MP3, WAV, WEBM, OGG, M4A

## Cost Estimates

- **AssemblyAI**: Free tier - 100 hours/month
- **Claude API**: ~$0.003 per analysis (Sonnet 4.5)
- **Supabase**: Free tier includes 500MB storage

## License

MIT

## Contributing

Pull requests are welcome. For major changes, please open an issue first.
