"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="mt-1 max-w-md text-sm text-muted">{error.digest ? `Reference: ${error.digest}` : "Please try again."}</p>
      <button onClick={reset} className="btn-primary mt-6">Try again</button>
    </div>
  );
}
