import Link from "next/link";
import { env } from "@/lib/env";
import { PLANS } from "@/config/plans";
import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  const company = env.legal.entity ?? "CutLane";
  const contact = env.legal.contactEmail;
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms are an agreement between you and {company} (&quot;CutLane&quot;, &quot;we&quot;) for your use of cutlane.io and its services. By
        creating an account or starting a trial you agree to them.
      </p>

      <h2>1. The service</h2>
      <p>
        CutLane helps video editors find Whop Content Rewards campaigns, research public YouTube content for reference, organise clips they made,
        record where they posted them, and submit those links to Whop. CutLane is not affiliated with or endorsed by Whop, YouTube/Google,
        Instagram/Meta or TikTok. Their services are governed by their own terms.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You sign in with your Whop account. You are responsible for activity on your account.</li>
        <li>You must be at least 18, or the age of majority where you live, and able to form a binding contract.</li>
        <li>Each person may use the free trial once.</li>
      </ul>

      <h2>3. Plans, trial and billing</h2>
      <ul>
        <li>
          CutLane has no free plan. The {PLANS.beginner.name} plan costs ${PLANS.beginner.monthlyPrice}/month and includes a {PLANS.beginner.trialDays}-day free trial. A
          card is required to start the trial, and the subscription <strong>converts to a paid subscription automatically</strong> at the end of the trial unless
          you cancel before then.
        </li>
        <li>Subscriptions renew automatically each billing period until cancelled. You can cancel at any time from Billing. Access continues until the end of the paid period.</li>
        <li>Payments are processed by Stripe. Except where the law requires otherwise, fees are non-refundable for partial periods.</li>
        <li>If a payment fails, you keep access for a 3-day grace period. After that your account becomes read-only until payment succeeds. We do not delete your data because of a failed payment.</li>
        <li>Plan limits (for example uploads and submissions per month) are described on the <Link href="/pricing">pricing page</Link>. We may change prices or limits with at least 30 days&apos; notice before your next renewal.</li>
      </ul>

      <h2>4. Your content and copyright</h2>
      <ul>
        <li>You keep ownership of the clips, notes and other content you upload. You give us a limited licence to store and process it only to run the service (for example, to upload a clip to Whop when you ask us to).</li>
        <li>
          <strong>You may only upload and submit footage you have the right to use</strong>, such as content a campaign provides or footage you have the creator&apos;s
          permission to use. Editing someone else&apos;s video does not remove their copyright.
        </li>
        <li>YouTube features in CutLane are for research only. CutLane does not download YouTube videos, and you must not use CutLane to do so.</li>
        <li>We may remove content or suspend accounts that infringe others&apos; rights or break these terms. Copyright complaints can be sent to {contact ?? "our contact address"}.</li>
      </ul>

      <h2>5. Third-party services</h2>
      <p>
        CutLane uses the YouTube API Services. By using CutLane&apos;s YouTube research features you agree to be bound by the{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>. CutLane also connects to Whop (sign-in, campaigns
        and submissions) and Stripe (payments). Campaign approval, rewards and payouts are decided by Whop and the campaign owner, not by CutLane.
      </p>

      <h2>6. Acceptable use</h2>
      <p>Don&apos;t misuse the service. This includes trying to get around plan limits or security, scraping or overloading it, reselling access, or using it for spam or to break the law or other platforms&apos; rules.</p>

      <h2>7. Disclaimers and liability</h2>
      <p>
        The service is provided &quot;as is&quot;. We don&apos;t guarantee that campaigns will accept your submissions or that third-party services will be available. To
        the extent the law allows, our total liability for any claim is limited to the amount you paid us in the 12 months before the claim, and we are not
        liable for indirect or consequential losses.
      </p>

      <h2>8. Ending your account</h2>
      <p>You can stop using CutLane and ask us to delete your account at any time. We may suspend or end accounts that break these terms. Sections 4, 7 and 9 survive termination.</p>

      <h2>9. Changes and contact</h2>
      <p>
        We may update these terms. We&apos;ll tell you about material changes before they take effect. Questions: {contact ? <a href={`mailto:${contact}`}>{contact}</a> : "contact us through the site"}.
      </p>
    </LegalPage>
  );
}
