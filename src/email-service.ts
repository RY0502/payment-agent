import FormData from 'form-data';
import Mailgun from 'mailgun.js';
import { promises as fs } from 'fs';
import path from 'path';

interface PaymentData {
  paymentType?: string;
  amount?: string;
  accountNumber?: string;
  [key: string]: any;
}

interface EmailResult {
  success: boolean;
  message: string;
  error?: any;
}

export class EmailService {
  private mg: any;
  private domain: string;
  private fromEmail: string;
  private toEmail: string;

  constructor() {
    const apiKey = process.env.MAILGUN_API_KEY;
    this.domain = process.env.MAILGUN_DOMAIN || '';
    this.fromEmail = process.env.MAILGUN_FROM_EMAIL || 'Payment Agent <noreply@yourdomain.com>';
    this.toEmail = process.env.MAILGUN_TO_EMAIL || '';

    if (!apiKey || !this.domain || !this.toEmail) {
      console.warn('Mailgun configuration incomplete. Email notifications will be disabled.');
      console.warn(`Missing: ${!apiKey ? 'MAILGUN_API_KEY ' : ''}${!this.domain ? 'MAILGUN_DOMAIN ' : ''}${!this.toEmail ? 'MAILGUN_TO_EMAIL' : ''}`);
    }

    const mailgun = new Mailgun(FormData);
    this.mg = mailgun.client({
      username: 'api',
      key: apiKey || ''
    });
  }

  async sendPaymentSuccessEmail(
    websiteName: string,
    screenshotPath: string,
    paymentData: PaymentData,
    recipientEmail?: string
  ): Promise<EmailResult> {
    try {
      // Use recipient email from parameter or fallback to .env
      const toEmail = recipientEmail || this.toEmail;
      
      // Check if Mailgun is properly configured
      if (!process.env.MAILGUN_API_KEY || !this.domain) {
        return {
          success: false,
          message: 'Mailgun not configured. Skipping email notification.'
        };
      }
      
      if (!toEmail) {
        return {
          success: false,
          message: 'No recipient email provided in payment data or .env file.'
        };
      }

      // Read screenshot file
      const screenshotData = await fs.readFile(screenshotPath);
      const screenshotFilename = path.basename(screenshotPath);

      // Format today's date
      const today = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      // Create email subject
      const subject = `Payment success for ${websiteName} at ${today}`;

      // Create email body with payment data
      const paymentDataFormatted = JSON.stringify(paymentData, null, 2);
      const htmlBody = `
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
              .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
              .payment-data { background-color: #fff; padding: 15px; border-left: 4px solid #4CAF50; margin: 20px 0; }
              .payment-data pre { margin: 0; overflow-x: auto; }
              .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
              h1 { margin: 0; }
              h2 { color: #4CAF50; margin-top: 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>✓ Payment Successful</h1>
              </div>
              <div class="content">
                <h2>Payment Confirmation</h2>
                <p>Your payment on <strong>${websiteName}</strong> has been successfully processed on <strong>${today}</strong>.</p>
                
                <div class="payment-data">
                  <h3>Payment Details:</h3>
                  <pre>${paymentDataFormatted}</pre>
                </div>
                
                <p>Please find the payment success screenshot attached to this email for your records.</p>
                
                <p style="margin-top: 30px; color: #666; font-size: 14px;">
                  <em>This is an automated notification from Payment Agent.</em>
                </p>
              </div>
              <div class="footer">
                <p>Payment Agent - Automated Payment Processing</p>
              </div>
            </div>
          </body>
        </html>
      `;

      const textBody = `
Payment Successful

Your payment on ${websiteName} has been successfully processed on ${today}.

Payment Details:
${paymentDataFormatted}

Please find the payment success screenshot attached to this email for your records.

---
This is an automated notification from Payment Agent.
      `.trim();

      // Prepare message parameters
      const messageParams = {
        from: this.fromEmail,
        to: [toEmail],
        subject: subject,
        text: textBody,
        html: htmlBody,
        attachment: {
          filename: screenshotFilename,
          data: screenshotData
        }
      };

      // Send email
      console.log(`Sending payment success email to ${toEmail}...`);
      const result = await this.mg.messages.create(this.domain, messageParams);
      console.log('Email sent successfully:', result);

      return {
        success: true,
        message: `Payment success email sent to ${toEmail}`
      };
    } catch (error) {
      console.error('Failed to send payment success email:', error);
      return {
        success: false,
        message: 'Failed to send payment success email',
        error: error
      };
    }
  }
}
