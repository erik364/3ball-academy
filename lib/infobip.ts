// Infobip helper — used by API routes to send SMS and email.
// Reads INFOBIP_API_KEY, INFOBIP_BASE_URL, INFOBIP_SMS_SENDER, INFOBIP_EMAIL_FROM env vars.

export async function sendSms(to: string, text: string) {
  const baseUrl = process.env.INFOBIP_BASE_URL;
  const apiKey = process.env.INFOBIP_API_KEY;
  const sender = process.env.INFOBIP_SMS_SENDER;
  if (!baseUrl || !apiKey || !sender) {
    console.warn('[infobip] SMS not configured — skipping send');
    return { skipped: true };
  }
  const res = await fetch(`${baseUrl}/sms/2/text/advanced`, {
    method: 'POST',
    headers: {
      Authorization: `App ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      messages: [{ from: sender, destinations: [{ to }], text }],
    }),
  });
  return res.json();
}

export async function sendEmail(to: string, subject: string, html: string) {
  const baseUrl = process.env.INFOBIP_BASE_URL;
  const apiKey = process.env.INFOBIP_API_KEY;
  const from = process.env.INFOBIP_EMAIL_FROM;
  if (!baseUrl || !apiKey || !from) {
    console.warn('[infobip] Email not configured — skipping send');
    return { skipped: true };
  }
  const form = new FormData();
  form.append('from', from);
  form.append('to', to);
  form.append('subject', subject);
  form.append('html', html);
  const res = await fetch(`${baseUrl}/email/3/send`, {
    method: 'POST',
    headers: { Authorization: `App ${apiKey}`, Accept: 'application/json' },
    body: form,
  });
  return res.json();
}
