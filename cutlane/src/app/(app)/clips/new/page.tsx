import { requirePageAccess } from "@/lib/billing/server";
import { listCampaigns } from "@/lib/whop/campaigns";
import { UploadClipForm } from "@/components/UploadClipForm";
import { BackLink, CopyrightNotice, PageHeader } from "@/components/ui";

export const metadata = { title: "Import clip" };

export default async function NewClipPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user } = await requirePageAccess("write");
  const sp = await searchParams;
  const page = await listCampaigns(user.id, { status: "open" }).catch(() => null);
  const campaigns = (page?.campaigns ?? []).map((c) => ({ id: c.id, title: c.title }));

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href="/clips">Clip library</BackLink>
      <PageHeader title="Import a finished clip" subtitle="MP4, up to 1 GB. Vertical 9:16 works best for Reels, TikTok and Shorts." />
      <div className="mb-5">
        <CopyrightNotice />
      </div>
      <UploadClipForm campaigns={campaigns} defaultCampaignId={sp.campaign ?? ""} />
    </div>
  );
}
