import { useEffect, type ReactNode } from "react";

export function Page({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <main id="main" tabIndex={-1} className="page">
      <div className="card">{children}</div>
    </main>
  );
}
