import type { LegalDoc } from "@/lib/legalContent";
import { LEGAL_UPDATED } from "@/lib/legalContent";

export default function LegalDocument({ doc, showTitle = true }: { doc: LegalDoc; showTitle?: boolean }) {
  return (
    <article className="text-sm leading-relaxed text-foreground/90">
      {showTitle && <h1 className="mb-2 text-3xl font-bold">{doc.title}</h1>}
      <p className="mb-1 text-xs text-muted-foreground">Last updated {LEGAL_UPDATED}</p>
      <p className="mb-6 mt-3 text-muted-foreground">{doc.intro}</p>
      {doc.sections.map((section) => (
        <section key={section.title} className="mb-6">
          <h2 className="mb-2 text-base font-semibold text-foreground">{section.title}</h2>
          <div className="text-muted-foreground">{section.body}</div>
        </section>
      ))}
    </article>
  );
}
