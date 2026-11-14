import { Shell } from "@/components/shell";
import { ReviewOverview } from "@/components/review-overview";
import { StartSession } from "@/components/start-session";
import { requireLearner } from "@/lib/supabase/server";

export default async function ReviewPage() {
  await requireLearner();
  return <Shell active="review"><div className="page-heading"><div><span className="eyebrow">SPACED RETRIEVAL</span><h1>Review your words</h1><p>Recall in Arabic or English. Record the first attempt honestly, then check the answer.</p></div></div><ReviewOverview full /><section className="card section stack"><h2>Make time for retrieval</h2><StartSession mode="review" /><StartSession mode="MVD" /></section></Shell>;
}
