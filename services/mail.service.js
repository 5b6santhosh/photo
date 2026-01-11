const transporter = require("../config/mail.config");

class MailService {
  async sendMail({ to, subject, text, html }) {
    try {
      const info = await transporter.sendMail({
        from: `"Support" <${process.env.SMTP_USER}>`,
        to,
        subject,
        text,
        html,
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      console.error("Mail Service Error:", error);
      throw error;
    }
  }
}

module.exports = new MailService();
