// ─────────────────────────────────────────────────────────────────────────────
// Transactional email templates — each builder is pure ({subject, text, html})
// and mirrors its copy into plain text, the pattern the founder set in the
// Movies mail lib. The lender's brand does the talking; BirgenAI stays in the
// footer.
// ─────────────────────────────────────────────────────────────────────────────
import {
  type EmailBrand, buildEmailDocumentHtml, headingRow, valueBarRow, buttonRow, noteRow,
  escapeHtml, publicBaseUrl, EMAIL_SUPPORT,
} from "./layout";

export type EmailParts = { subject: string; text: string; html: string };

const greet = (name?: string | null) => (name?.trim() ? `Hi ${name.trim()},` : "Hello,");

/**
 * The lender's own front door: lms.birgenai.com/<slug>, where the sign-in card
 * wears their logo and accent and pins the org (one email can hold seats at
 * several lenders). "lms" is emailBrandFor's no-org fallback — generic /login.
 */
const staffLoginUrl = (brand: EmailBrand) =>
  brand.slug && brand.slug !== "lms" ? `${publicBaseUrl()}/${brand.slug}` : `${publicBaseUrl()}/login`;

/**
 * New team member credentials — sent when an admin creates a staff account (or
 * an org is onboarded). Explains the full first sign-in: the generated
 * password, then the daily code that lands in this same inbox.
 */
export function staffInviteEmail(brand: EmailBrand, p: {
  name: string; email: string; tempPassword: string; roleTitle?: string | null;
}): EmailParts {
  const loginUrl = staffLoginUrl(brand);
  const subject = `Your ${brand.name} staff account is ready`;

  const text = [
    greet(p.name),
    "",
    `You now have staff access to ${brand.name}${p.roleTitle ? ` as ${p.roleTitle}` : ""}.`,
    "",
    `Sign in at: ${loginUrl}`,
    `Email: ${p.email}`,
    `Temporary password: ${p.tempPassword}`,
    "",
    "How your first sign-in works:",
    "  1. Enter your email and the temporary password above.",
    "  2. We'll email you a 6-digit code — it works for the whole day.",
    "  3. Change your password from the profile menu (top right).",
    "",
    `Didn't expect this? Tell your administrator or ${EMAIL_SUPPORT}.`,
  ].join("\n");

  const rows = [
    headingRow(brand, "Welcome to the team", `${escapeHtml(greet(p.name))}<br /><br />You now have staff access to <strong>${escapeHtml(brand.name)}</strong>${p.roleTitle ? ` as <strong>${escapeHtml(p.roleTitle)}</strong>` : ""}. Here are your sign-in credentials — the password is temporary, change it after your first sign-in.`),
    valueBarRow(brand, "Sign-in email", p.email, true),
    valueBarRow(brand, "Temporary password", p.tempPassword, true),
    buttonRow(brand, loginUrl, `Sign in to ${brand.name}`),
    noteRow(`<strong>How your first sign-in works:</strong><br />1&nbsp;&nbsp;Enter your email and the temporary password above.<br />2&nbsp;&nbsp;We'll email you a 6-digit code — it works for the <strong>whole day</strong>, so you only need it once each morning.<br />3&nbsp;&nbsp;Change your password from the profile menu (top right).<br /><br />Didn't expect this? Tell your administrator or <a href="mailto:${EMAIL_SUPPORT}" style="color:${brand.accent};text-decoration:none;font-weight:600;">contact support</a>.`),
  ].join("");

  return {
    subject,
    text,
    html: buildEmailDocumentHtml({
      brand, pageTitle: subject, mainCardRowsHtml: rows,
      legalFooterInnerHtml: `This email was sent to ${escapeHtml(p.email)} because an administrator at ${escapeHtml(brand.name)} created a staff account for you.`,
    }),
  };
}

/** The daily sign-in code — reusable until midnight, one email per day. */
export function loginOtpEmail(brand: EmailBrand, p: {
  name?: string | null; email?: string | null; code: string;
}): EmailParts {
  const digits = p.code.replace(/\D/g, "").slice(0, 6);
  const subject = `${digits} is your ${brand.name} sign-in code for today`;

  const text = [
    greet(p.name),
    "",
    `Use this code to finish signing in to ${brand.name}:`,
    "",
    `Code: ${digits}`,
    "",
    "It works for the WHOLE DAY — sign in as many times as you need until midnight, no new code required.",
    "If you didn't try to sign in, change your password now and tell your administrator.",
  ].join("\n");

  const rows = [
    headingRow(brand, "Your sign-in code for today", `${escapeHtml(greet(p.name))}<br /><br />Use this code to finish signing in to <strong>${escapeHtml(brand.name)}</strong>. It confirms you control this inbox.`),
    valueBarRow(brand, "Today's code", digits),
    noteRow(`This code works for the <strong>whole day</strong> — sign in as many times as you need until midnight, no new code required.<br /><br />If you didn't try to sign in, change your password now and tell your administrator.`),
  ].join("");

  return {
    subject,
    text,
    html: buildEmailDocumentHtml({
      brand, pageTitle: subject, mainCardRowsHtml: rows,
      legalFooterInnerHtml: `Sent for ${escapeHtml(brand.name)} staff sign-in security${p.email ? ` to ${escapeHtml(p.email)}` : ""}. The code expires at midnight.`,
    }),
  };
}

/** Final-approval OTP — authorises money, so the wording names the act. */
export function approvalOtpEmail(brand: EmailBrand, p: { name?: string | null; code: string }): EmailParts {
  const digits = p.code.replace(/\D/g, "").slice(0, 6);
  const subject = `${digits} is your ${brand.name} approval code`;

  const text = [
    greet(p.name),
    "",
    `Your one-time code to FINALIZE a loan approval at ${brand.name}:`,
    "",
    `Code: ${digits}`,
    "",
    "It expires in 10 minutes and works once. If you didn't request this, ignore it and tell your admin.",
  ].join("\n");

  const rows = [
    headingRow(brand, "Approval code", `${escapeHtml(greet(p.name))}<br /><br />You (or someone with your account) asked to <strong>finalize a loan approval</strong> at ${escapeHtml(brand.name)}. Enter this code only if that was you.`),
    valueBarRow(brand, "One-time approval code", digits),
    noteRow(`Expires in <strong>10 minutes</strong>, works once. If you didn't request this, ignore it and tell your administrator — your account stays protected.`),
  ].join("");

  return {
    subject,
    text,
    html: buildEmailDocumentHtml({
      brand, pageTitle: subject, mainCardRowsHtml: rows,
      legalFooterInnerHtml: `Sent because a loan approval at ${escapeHtml(brand.name)} required a second factor.`,
    }),
  };
}

/** Password reset code. */
export function resetCodeEmail(brand: EmailBrand, p: { name?: string | null; email?: string | null; code: string }): EmailParts {
  const digits = p.code.replace(/\D/g, "").slice(0, 6);
  const subject = `${digits} is your ${brand.name} password reset code`;

  const text = [
    greet(p.name),
    "",
    `Use this code to set a new ${brand.name} password:`,
    "",
    `Code: ${digits}`,
    "",
    "It expires in 10 minutes. If you didn't ask to reset your password, you can ignore this email.",
  ].join("\n");

  const rows = [
    headingRow(brand, "Reset your password", `${escapeHtml(greet(p.name))}<br /><br />Enter this code on the sign-in page to set a new password for <strong>${escapeHtml(brand.name)}</strong>.`),
    valueBarRow(brand, "Reset code", digits),
    noteRow(`Expires in <strong>10 minutes</strong>. If you didn't ask for this, ignore it — your password is unchanged.`),
  ].join("");

  return {
    subject,
    text,
    html: buildEmailDocumentHtml({
      brand, pageTitle: subject, mainCardRowsHtml: rows,
      legalFooterInnerHtml: `Sent for ${escapeHtml(brand.name)} account security${p.email ? ` to ${escapeHtml(p.email)}` : ""}.`,
    }),
  };
}

/** Welcome to the org's founding admin right after self-onboarding. */
export function welcomeOrgEmail(brand: EmailBrand, p: { name: string; email: string }): EmailParts {
  const loginUrl = staffLoginUrl(brand);
  const subject = `${brand.name} is live on BirgenAI LMS`;

  const text = [
    greet(p.name),
    "",
    `${brand.name} has been created and you are its administrator.`,
    "",
    `Sign in: ${loginUrl} (with the password you chose)`,
    `Your borrower portal: https://${brand.slug}.birgenai.com`,
    "",
    "Next steps live on your console home: create a loan product, design your approval workflow,",
    "review your roles, invite your team, connect your M-Pesa and SMS credentials — then request activation.",
  ].join("\n");

  const rows = [
    headingRow(brand, "Your lending platform is ready", `${escapeHtml(greet(p.name))}<br /><br /><strong>${escapeHtml(brand.name)}</strong> has been created with your branding applied, and you are its administrator. Your borrower portal is reserved at <strong>${escapeHtml(brand.slug)}.birgenai.com</strong>.`),
    buttonRow(brand, loginUrl, "Open your console"),
    noteRow(`Your console home walks you through setup: create a loan product, design your approval workflow, review your roles, invite your team, and connect your M-Pesa &amp; SMS credentials — then <strong>request activation</strong> and BirgenAI switches on live lending.`),
  ].join("");

  return {
    subject,
    text,
    html: buildEmailDocumentHtml({
      brand, pageTitle: subject, mainCardRowsHtml: rows,
      legalFooterInnerHtml: `Sent to ${escapeHtml(p.email)} because this address created ${escapeHtml(brand.name)} on BirgenAI LMS.`,
    }),
  };
}
