import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const healthStatus = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "Payment Agent",
    version: "1.0.0",
    environment: process.env.NODE_ENV || "production",
    features: {
      emailNotifications: !!(
        process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN
      ),
      pushNotifications: !!(
        process.env.PAYMENT_NOTIFICATION_URL && process.env.SUPABASE_ANON_KEY
      ),
      groqApi: !!process.env.GROQ_API_KEY,
    },
  };

  res.status(200).json(healthStatus);
}
