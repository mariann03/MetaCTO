import { SubmitForm } from "./submit-form";

export default function SubmitPage() {
  return (
    <section className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="font-semibold text-2xl">Submit a request</h1>
        <p className="text-muted-foreground">
          Tell us what you're trying to do. We'll group it with the problem it
          belongs to.
        </p>
      </div>
      <SubmitForm />
    </section>
  );
}
