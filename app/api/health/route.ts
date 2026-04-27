export const runtime = 'nodejs';

export async function GET() {
  return Response.json({
    ok: true,
    app: '3Ball Academy',
    time: new Date().toISOString(),
    services: {
      supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      infobipSms: !!(process.env.INFOBIP_API_KEY && process.env.INFOBIP_SMS_SENDER),
      infobipEmail: !!(process.env.INFOBIP_API_KEY && process.env.INFOBIP_EMAIL_FROM),
    },
  });
}
