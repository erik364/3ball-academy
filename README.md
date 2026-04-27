# 3Ball Academy

Basketball academy management app — practices, tournaments, RSVPs, check-ins, and notifications.

## Stack

- **Frontend**: Next.js 14 (App Router) + Tailwind, prototype HTML embedded as live UI
- **Database & Auth**: Supabase
- **Notifications**: Infobip (SMS + Email)
- **Hosting**: Vercel
- **Domain**: app.3ballacademy.com

## Local Development

```bash
npm install
cp .env.example .env.local
# fill in values in .env.local
npm run dev
```

App will be at http://localhost:3000.

## Architecture

- `app/page.tsx` — root route, renders `<AppShell />`
- `components/AppShell.tsx` — client component, mounts prototype HTML in an iframe
- `public/app.html` — the full prototype (login, dashboard, calendar, schedule, RSVPs)
- `lib/supabase-client.ts` — browser Supabase client
- `lib/supabase-server.ts` — server-side admin Supabase client
- `lib/infobip.ts` — SMS / email helpers
- `app/api/health/route.ts` — health check at `/api/health`

## Why an iframe?

The prototype is one self-contained HTML file we iterated heavily on — UI, mobile, terminology, styling all done. Rather than rewriting it as 30+ React components and risking lost behavior, we serve it from `/public/app.html` and wrap it in a Next.js shell. We get Vercel hosting, env vars, API routes, custom domain, and a clear path to incrementally rebuild components later.

## Environment Variables

See `.env.example`. Set these in Vercel → Settings → Environment Variables for all 3 environments.

## Deploy

Push to GitHub `main` → Vercel auto-deploys. First-time setup:

1. Vercel → New Project → import this repo
2. Framework Preset: Next.js (auto-detected)
3. Root Directory: leave blank
4. Add env vars from `.env.example`
5. Deploy
6. Add custom domain `app.3ballacademy.com` in Settings → Domains
