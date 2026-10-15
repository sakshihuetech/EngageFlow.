export const META_BILLING_URL = "https://business.facebook.com/billing_hub/";

export function isMetaPaymentEligibilityFailure(failure?: {
  failureCode?: string;
}) {
  return failure?.failureCode === "131042";
}
