const sgMail = require('../config/sendgrid');

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@jobportal.com';
const FROM_NAME = process.env.SENDGRID_FROM_NAME || 'JobPortal';
// FRONTEND_URL may be a comma-separated list (CORS). Prefer public URL for email links.
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((u) => u.trim().replace(/\/$/, ''))
  .find((u) => u.startsWith('https://'))
  || (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');

const baseLayout = (title, bodyContent) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f0f4f3;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f0f4f3;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,61,46,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#0f3d2e 0%,#1a6b4a 100%);padding:28px 32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">JobPortal</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px;">
              ${bodyContent}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#f8faf9;border-top:1px solid #e5ebe8;text-align:center;">
              <p style="margin:0;color:#6b7c75;font-size:12px;line-height:1.5;">
                © ${new Date().getFullYear()} JobPortal. All rights reserved.<br/>
                This is an automated message — please do not reply.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

const button = (url, label) => `
  <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px auto;">
    <tr>
      <td style="border-radius:8px;background:#1a6b4a;">
        <a href="${url}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>
`;

const sendEmail = async ({ to, subject, html }) => {
  const msg = {
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject,
    html,
  };

  if (!process.env.SENDGRID_API_KEY) {
    console.log('[Email:DEV]', { to, subject });
    return { success: true, mocked: true };
  }

  try {
    await sgMail.send(msg);
    return { success: true };
  } catch (err) {
    const details = err.response?.body || err.message;
    console.error('[Email:SendGrid Error]', details);
    // Do not crash the API if email provider rejects the request
    return { success: false, error: details };
  }
};

const sendVerificationEmail = async (user, token) => {
  const url = `${FRONTEND_URL}/verify-email?token=${token}`;
  const html = baseLayout(
    'Verify Your Email',
    `
    <h2 style="margin:0 0 12px;color:#0f3d2e;font-size:22px;">Welcome, ${user.full_name}!</h2>
    <p style="margin:0 0 8px;color:#3d5248;font-size:15px;line-height:1.6;">
      Thanks for joining JobPortal. Please verify your email address to activate your account.
    </p>
    <p style="margin:0;color:#3d5248;font-size:15px;line-height:1.6;">
      This link expires in 24 hours.
    </p>
    ${button(url, 'Verify Email Address')}
    <p style="margin:0;color:#6b7c75;font-size:13px;line-height:1.5;">
      If the button doesn't work, copy and paste this link:<br/>
      <a href="${url}" style="color:#1a6b4a;word-break:break-all;">${url}</a>
    </p>
    `
  );
  return sendEmail({ to: user.email, subject: 'Verify your JobPortal email', html });
};

const sendResendVerificationEmail = async (user, token) => {
  const url = `${FRONTEND_URL}/verify-email?token=${token}`;
  const html = baseLayout(
    'Verify Your Email',
    `
    <h2 style="margin:0 0 12px;color:#0f3d2e;font-size:22px;">Verify your email</h2>
    <p style="margin:0 0 8px;color:#3d5248;font-size:15px;line-height:1.6;">
      Hi ${user.full_name}, you requested a new verification link. Click below to verify your email.
    </p>
    <p style="margin:0;color:#3d5248;font-size:15px;line-height:1.6;">
      This link expires in 24 hours.
    </p>
    ${button(url, 'Verify Email Address')}
    `
  );
  return sendEmail({ to: user.email, subject: 'Your new JobPortal verification link', html });
};

const sendPasswordResetEmail = async (user, token) => {
  const url = `${FRONTEND_URL}/reset-password?token=${token}`;
  const html = baseLayout(
    'Reset Your Password',
    `
    <h2 style="margin:0 0 12px;color:#0f3d2e;font-size:22px;">Reset your password</h2>
    <p style="margin:0 0 8px;color:#3d5248;font-size:15px;line-height:1.6;">
      Hi ${user.full_name}, we received a request to reset your password.
    </p>
    <p style="margin:0;color:#3d5248;font-size:15px;line-height:1.6;">
      This link expires in 1 hour. If you didn't request this, you can ignore this email.
    </p>
    ${button(url, 'Reset Password')}
    `
  );
  return sendEmail({ to: user.email, subject: 'Reset your JobPortal password', html });
};

const sendApplicationSubmittedEmail = async (applicant, job, company) => {
  const url = `${FRONTEND_URL}/dashboard/applications`;
  const html = baseLayout(
    'Application Submitted',
    `
    <h2 style="margin:0 0 12px;color:#0f3d2e;font-size:22px;">Application received</h2>
    <p style="margin:0 0 8px;color:#3d5248;font-size:15px;line-height:1.6;">
      Hi ${applicant.full_name}, your application for <strong>${job.title}</strong> at
      <strong>${company.name}</strong> has been submitted successfully.
    </p>
    <p style="margin:0;color:#3d5248;font-size:15px;line-height:1.6;">
      Current status: <strong style="color:#1a6b4a;">Pending</strong>
    </p>
    ${button(url, 'Track Application')}
    `
  );
  return sendEmail({
    to: applicant.email,
    subject: `Application submitted: ${job.title}`,
    html,
  });
};

const sendNewApplicantNotificationEmail = async (employer, applicant, job, company) => {
  const url = `${FRONTEND_URL}/employer/applications`;
  const html = baseLayout(
    'New Applicant',
    `
    <h2 style="margin:0 0 12px;color:#0f3d2e;font-size:22px;">New application received</h2>
    <p style="margin:0 0 8px;color:#3d5248;font-size:15px;line-height:1.6;">
      Hi ${employer.full_name}, <strong>${applicant.full_name}</strong> applied for
      <strong>${job.title}</strong> at ${company.name}.
    </p>
    <p style="margin:0;color:#3d5248;font-size:15px;line-height:1.6;">
      Review the candidate profile and resume in your employer dashboard.
    </p>
    ${button(url, 'View Applicants')}
    `
  );
  return sendEmail({
    to: employer.email,
    subject: `New applicant for ${job.title}`,
    html,
  });
};

const sendStatusUpdateEmail = async (applicant, job, company, status) => {
  const statusConfig = {
    reviewing: {
      subject: `Your application is under review: ${job.title}`,
      title: 'Application under review',
      message: `Good news! Your application for <strong>${job.title}</strong> at <strong>${company.name}</strong> is now being reviewed by the hiring team.`,
      label: 'Reviewing',
      color: '#2563eb',
    },
    shortlisted: {
      subject: `You've been shortlisted: ${job.title}`,
      title: "You've been shortlisted!",
      message: `Congratulations ${applicant.full_name}! You have been shortlisted for <strong>${job.title}</strong> at <strong>${company.name}</strong>. The employer may contact you soon.`,
      label: 'Shortlisted',
      color: '#1a6b4a',
    },
    rejected: {
      subject: `Update on your application: ${job.title}`,
      title: 'Application update',
      message: `Thank you for applying to <strong>${job.title}</strong> at <strong>${company.name}</strong>. Unfortunately, the employer has decided to move forward with other candidates at this time.`,
      label: 'Not selected',
      color: '#b45309',
    },
    hired: {
      subject: `Congratulations — you're hired! ${job.title}`,
      title: "You're hired!",
      message: `Congratulations ${applicant.full_name}! You have been hired for <strong>${job.title}</strong> at <strong>${company.name}</strong>. The employer will reach out with next steps.`,
      label: 'Hired',
      color: '#0f3d2e',
    },
  };

  const config = statusConfig[status];
  if (!config) return { success: false, skipped: true };

  const url = `${FRONTEND_URL}/dashboard/applications`;
  const html = baseLayout(
    config.title,
    `
    <h2 style="margin:0 0 12px;color:#0f3d2e;font-size:22px;">${config.title}</h2>
    <p style="margin:0 0 8px;color:#3d5248;font-size:15px;line-height:1.6;">
      ${config.message}
    </p>
    <p style="margin:16px 0 0;color:#3d5248;font-size:15px;">
      Status: <strong style="color:${config.color};">${config.label}</strong>
    </p>
    ${button(url, 'View Application')}
    `
  );
  return sendEmail({ to: applicant.email, subject: config.subject, html });
};

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendResendVerificationEmail,
  sendPasswordResetEmail,
  sendApplicationSubmittedEmail,
  sendNewApplicantNotificationEmail,
  sendStatusUpdateEmail,
};
