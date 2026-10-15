import { describe, expect, it } from "vitest";
import {
  isMetaPaymentEligibilityFailure,
  META_BILLING_URL,
} from "../meta-payment";

describe("Meta payment eligibility notice", () => {
  it("is enabled only by provider code 131042", () => {
    expect(isMetaPaymentEligibilityFailure({ failureCode: "131042" })).toBe(
      true,
    );
    expect(
      isMetaPaymentEligibilityFailure({
        failureCode: "TRANSPORT_NOT_CONFIGURED",
      }),
    ).toBe(false);
    expect(isMetaPaymentEligibilityFailure({ failureCode: "131000" })).toBe(
      false,
    );
    expect(isMetaPaymentEligibilityFailure(undefined)).toBe(false);
  });

  it("uses the generic Meta Billing landing page without account identifiers", () => {
    expect(META_BILLING_URL).toBe("https://business.facebook.com/billing_hub/");
    expect(META_BILLING_URL).not.toMatch(
      /[?&](?:business_id|waba_id|account_id)=/,
    );
  });
});
