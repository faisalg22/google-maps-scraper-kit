import { env } from "@/lib/env";
import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  const company = env.legal.entity ?? "CutLane";
  const contact = env.legal.contactEmail;
  return (
    <LegalPage title="Privacy Policy">
      <p>This policy explains what {company} (&quot;CutLane&quot;, &quot;we&quot;) collects when you use cutlane.io, why, and the choices you have.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account data from Whop</strong> when you sign in: your Whop user ID, username, display name, profile picture and email (as permitted by the scopes you approve).</li>
        <li><strong>Whop access tokens</strong>, stored encrypted (AES-256-GCM), used only to load campaigns and submit work on your behalf.</li>
        <li><strong>Content you add</strong>: uploaded clips, clip titles, post links, hook notes, saved channels and the social media handles you enter.</li>
        <li><strong>Billing data</strong>: your plan, subscription status and Stripe customer ID. Card details are collected and stored by Stripe, not by us.</li>
        <li><strong>Contact-sales and waitlist submissions</strong>: name, email, team size and any message you send.</li>
        <li><strong>Technical data</strong>: a session cookie to keep you signed in, your theme choice (in your browser and, when signed in, on your account), and server logs (IP address, browser, errors), kept for security and debugging.</li>
      </ul>

      <h2>YouTube API Services</h2>
      <p>
        CutLane&apos;s research features use the YouTube API Services to show public channel and video information (titles, thumbnails, view and like counts).
        We do not ask you to connect a YouTube or Google account, and we do not access private YouTube data. We temporarily cache public YouTube data
        (for up to 24 hours) to stay within API limits. Any YouTube data stored with your saved channels or notes is refreshed or deleted within 30 days.
        Google&apos;s handling of data is described in the{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>, and use of YouTube features is subject to the{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>.
      </p>

      <h2>How we use it</h2>
      <ul>
        <li>To run the service: sign you in, show campaigns, store your clips, submit links and files to Whop at your request, and track submission status.</li>
        <li>To bill you and enforce plan limits.</li>
        <li>To respond to sales inquiries and support requests, and to send essential service emails.</li>
        <li>To keep the service secure and fix problems.</li>
      </ul>
      <p>We don&apos;t sell your personal data and we don&apos;t use it for advertising.</p>

      <h2>Who we share it with</h2>
      <ul>
        <li><strong>Whop</strong>: when you submit, we send your post links, caption and (if you choose) the clip file to Whop.</li>
        <li><strong>Service providers</strong> that process data for us: Supabase (database and file storage), Stripe (payments), our hosting provider, Resend (email) and Google (YouTube API).</li>
        <li>Authorities, if the law requires it.</li>
      </ul>

      <h2>Retention and deletion</h2>
      <p>
        We keep your data while your account exists. Plan limits never cause your data to be deleted. You can delete clips, notes, saved channels and
        handles at any time, and you can ask us to delete your account and associated data by contacting {contact ? <a href={`mailto:${contact}`}>{contact}</a> : "us"}. We delete
        it within 30 days, except records we must keep for legal or tax reasons (such as invoices).
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live (for example under the GDPR or CCPA), you may have the right to access, correct, export or delete your personal data, and
        to object to or restrict certain processing. Contact us to exercise these rights. You can also complain to your local data protection authority.
      </p>

      <h2>Cookies</h2>
      <p>We use only essential cookies: one session cookie to keep you signed in, and a short-lived cookie during Whop sign-in. Your theme choice is stored in your browser&apos;s local storage. We don&apos;t use advertising or tracking cookies.</p>

      <h2>Security</h2>
      <p>Data is encrypted in transit (HTTPS). Access tokens are encrypted at rest, sessions are stored as hashes, and uploaded clips are kept in private storage.</p>

      <h2>Changes and contact</h2>
      <p>We&apos;ll post updates here and tell you about material changes. Questions or requests: {contact ? <a href={`mailto:${contact}`}>{contact}</a> : "contact us through the site"}.</p>
    </LegalPage>
  );
}
