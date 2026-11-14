import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-sm text-primary-strong">404</p>
      <h1 className="mt-2 text-2xl font-bold">Not found</h1>
      <p className="mt-1 text-sm text-muted">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/campaigns" className="btn-primary mt-6">Back to campaigns</Link>
    </div>
  );
}
