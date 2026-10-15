import { ExternalLink, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../../../components/ui/Button";
import {
  isMetaPaymentEligibilityFailure,
  META_BILLING_URL,
} from "../meta-payment";

export function PaymentEligibilityNotice({
  failure,
  onRetry,
  retrying = false,
  compact = false,
}: {
  failure?: { failureCode?: string };
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
}) {
  if (!isMetaPaymentEligibilityFailure(failure)) return null;
  if (compact)
    return (
      <div className="mt-2 text-xs leading-5 text-warning">
        <span className="font-semibold">Payment setup required.</span> Complete
        billing eligibility in Meta, then{" "}
        <Link
          className="font-semibold underline underline-offset-2"
          to="/whatsapp/setup"
        >
          open WhatsApp Setup
        </Link>
        .
      </div>
    );
  return (
    <div className="mt-3 rounded-xl border border-warning/25 bg-warning-soft p-4 text-sm">
      <p className="font-semibold text-warning">Payment setup required</p>
      <p className="mt-1 leading-5 text-text-secondary">
        Meta blocked this send because billing or payment eligibility must be
        completed for the connected WhatsApp business account.
      </p>
      <p className="mt-2 text-xs leading-5 text-text-secondary">
        Open Meta Billing, select the relevant WhatsApp business account, and
        add or verify its payment method. Then return here and retry the test.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={META_BILLING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-control bg-primary px-3 text-xs font-semibold text-white shadow-emerald transition-colors hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          Open Meta Billing <ExternalLink className="size-3.5" />
        </a>
        {onRetry ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={retrying}
            onClick={onRetry}
          >
            <RefreshCw
              className={`size-3.5 ${retrying ? "animate-spin" : ""}`}
            />
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
