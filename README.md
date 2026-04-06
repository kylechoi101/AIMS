# AIMS: App Idea Makers Space

A real-time collaborative ideation platform allowing developers to brainstorm alongside distinct AI Agents, architect their codebase, and export production-ready technical deployment blueprints all in one place. 

Built exclusively for iOS, Android, and Web using the Expo Managed Workflow.

## Features

- **Multiplayer Collaboration Room**: Real-time Supabase WebSockets chatting with Peer/Host distinct cursors.
- **BYOK (Bring Your Own Key)**: Zero-friction AI integration. Users use their personal OpenAI, Anthropic, or Google Gemini keys directly via `MMKV`.
- **Dynamic AI Personas**: Call on Designers, Developers, or Advisors instantly in chat to unblock your creative progress.
- **Frictionless Model Selection**: Embedded native Dropdown UI selectors to hot-swap between bleeding-edge April 2026 models (`GPT-5.4`, `Claude 4.6`, `Gemini 3.1`) instantly without manual typing.
- **RAG Multi-Agent Deployments**: Swipe right on your finalized brainstorm. A multi-agent AI pipeline (`Product Owner` -> `Senior Dev` -> `Staff Engineer`) reads your chronological transcript and builds a complete React Native Markdown Blueprint.
- **Catch Me Up**: Missed a session? Generates instant AI summaries when returning from 24h absence.

## Tech Stack

- **Framework**: React Native with Expo Router v3 (Managed & Bare Workflows for iOS native)
- **Database**: Supabase PostgreSQL + Drizzle ORM
- **Authentication**: Native Apple Sign-In (`expo-apple-authentication`) & Google OAuth via Deep Linking (`expo-web-browser`)
- **State Management**: Zustand + React Native MMKV (v4)
- **AI Core**: Native `fetch` with Server-Sent Events (Zero heavyweight AI SDKs) 
- **Security**: Postgres Row Level Security (RLS) + Edge Authenticated API Keys

## Getting Started

1. Clone and install dependencies:
```bash
npm install
```

2. Start the Metro bundler:
```bash
npx expo start
```

3. Configure Supabase Secrets:
Fill out environment configuration matching the schema setup found internally to deploy edge functions natively.

## Deployment & Roadmap
The app is entirely pre-configured for EAS (Expo Application Services) native cloud builds.

**Immediate Deployment Pathway:**
1. Secure the $99/yr Apple Developer Account.
2. Run `eas build --profile production --platform ios` to push the verified binary to Apple TestFlight.
3. Push to App Store Connect.

**Scaling Strategy:**
AIMS is built to run on the Supabase MVP Free Tier (50k MAU, 500 simultaneous realtime peer connections). To prepare for large-scale public rollout or custom OAuth branding (`auth.ideamakers.com`), the architecture is strictly zero-rewrite-compatible with the Supabase Pro Tier upgrade.

## Open Source Ready
AIMS utilizes a **BYOK (Bring Your Own Key)** architecture. Because API weights are strictly stored in the user's local hardware (`mmkv`) and Edge function pipelines dynamically ingest those keys at runtime, this entire mono-repo can be open-sourced immediately without risk of centralized API key leakage. 
*(Just ensure `.env` containing your specific Supabase URL is ignored).*
