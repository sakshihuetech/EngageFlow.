import {
  AlertTriangle,
  CheckCircle2,
  MessageSquareText,
  Plug,
  RefreshCw,
  Send,
  Smartphone,
  Webhook,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ErrorState } from "../components/common/ErrorState";
import { LoadingState } from "../components/common/LoadingState";
import { PageHeader } from "../components/common/PageHeader";
import { SectionHeader } from "../components/common/SectionHeader";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { StatusBadge } from "../components/ui/StatusBadge";
import { TemplatePreview } from "../features/whatsapp/components/TemplatePreview";
import { PaymentEligibilityNotice } from "../features/whatsapp/components/PaymentEligibilityNotice";
import { DisplayNameApprovalNotice } from "../features/whatsapp/components/DisplayNameApprovalNotice";
import { displayNameStatusLabel } from "../features/whatsapp/display-name-status";
import { whatsAppApi } from "../features/whatsapp/api";
import { SetupControls } from "../features/whatsapp/components/SetupControls";
import { ApiClientError } from "../services/api/client";
import {
  templateParts,
  variableCount,
} from "../features/whatsapp/template-utils";
import type {
  TestMessageStatus,
  WhatsAppSetup,
  WhatsAppTemplate,
} from "../features/whatsapp/types";

export function WhatsAppSetupPage() {
  const [setup, setSetup] = useState<WhatsAppSetup>();
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [latest, setLatest] = useState<TestMessageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [assetsUnverified, setAssetsUnverified] = useState(false);
  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setError("");
    try {
      const [nextSetup, nextTemplates, nextLatest] = await Promise.all([
        whatsAppApi.setup(),
        whatsAppApi
          .templates({ status: "APPROVED" })
          .catch(() => ({ items: [] })),
        whatsAppApi.latestTestStatus().catch(() => null),
      ]);
      setSetup(nextSetup);
      setTemplates(nextTemplates.items);
      setLatest(nextLatest);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "WhatsApp setup could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!latest?.recordId || ["READ", "FAILED"].includes(latest.status)) return;
    const timer = window.setInterval(
      () =>
        void whatsAppApi
          .testStatus(latest.recordId)
          .then(setLatest)
          .catch(() => undefined),
      5_000,
    );
    return () => window.clearInterval(timer);
  }, [latest?.recordId, latest?.status]);

  if (loading)
    return (
      <Card>
        <LoadingState label="Loading WhatsApp setup" />
      </Card>
    );
  if (error || !setup)
    return (
      <Card>
        <ErrorState
          message={error || "WhatsApp setup is unavailable."}
          onRetry={() => void load()}
        />
      </Card>
    );

  const phone = setup.phones.find(item => ['CONNECTED', 'REGISTERED'].includes(String(item.registrationStatus).toUpperCase()) && String(item.codeVerificationStatus).toUpperCase() === 'VERIFIED');
  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp Setup"
        description="Review the workspace connection, sending assets, webhook state, and controlled test messaging."
        action={
          <Button variant="secondary" onClick={() => void load()}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />
      <SetupControls setup={setup} onChanged={() => { setAssetsUnverified(false); void load(true); }} onRefreshFailed={() => setAssetsUnverified(true)} />
      {assetsUnverified ? <Card className="border-warning/30 bg-warning-soft p-4 text-sm text-warning">Meta asset refresh failed or was incomplete. Stored statuses are unverified; no phones were marked removed by this attempt.</Card> : null}
      {!phone && setup.phones.some(item => String(item.registrationStatus).toUpperCase() === 'PENDING') ? <Card className="border-warning/30 bg-warning-soft p-4 text-sm text-warning">Meta lists a pending Standard phone. Use Register phone above after completing the required verification; sending remains blocked until Meta confirms it is ready.</Card> : null}
      {!setup.configured ? (
        <Card className="border-warning/20 bg-warning-soft p-5">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-5 text-warning" />
            <div>
              <p className="font-semibold text-warning">
                WhatsApp is not configured
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                Use Connect with Meta above to complete onboarding before
                using templates or messaging.
              </p>
            </div>
          </div>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <InfoCard
          icon={Plug}
          title="Connection"
          status={assetsUnverified ? 'UNVERIFIED' : setup.connection.status}
          rows={[
            ["Business", setup.connection.businessName],
            ["Onboarding mode", setup.connection.onboardingMode],
            ["Last synced", formatDate(setup.connection.lastSyncedAt)],
            [
              "Credential",
              setup.credential.configured
                ? setup.credential.expired
                  ? "Expired"
                  : "Configured"
                : "Missing",
            ],
          ]}
        />
        <InfoCard
          icon={CheckCircle2}
          title="Business Account"
          status={assetsUnverified ? 'UNVERIFIED' : setup.account?.status ?? "NOT_CONFIGURED"}
          rows={[
            ["Account", setup.account?.name],
            ["WABA ID", setup.account?.wabaId],
            ["Currency", setup.account?.currency],
            ["Timezone", setup.account?.timezone],
          ]}
        />
        <InfoCard
          icon={Smartphone}
          title="Phone Number"
          status={assetsUnverified ? 'UNVERIFIED' : phone?.registrationStatus ?? "NOT_CONNECTED"}
          rows={[
            ["Phone", phone?.displayPhoneNumber ?? "No connected Cloud API phone number"],
            ["Display name", phone?.verifiedName],
            ["Quality", phone?.qualityRating],
            ["Code verification", phone?.codeVerificationStatus],
            ["Display name status", displayNameStatusLabel(phone?.nameStatus)],
          ]}
        />
        <InfoCard
          icon={Webhook}
          title="Webhook"
          status={
            assetsUnverified ? 'UNVERIFIED' : setup.webhook.configured && setup.webhook.subscribed
              ? "SUBSCRIPTION_RECORDED"
              : "NOT_VERIFIED"
          }
          rows={[
            [
              "Server configuration",
              setup.webhook.configured ? "Configured" : "Not configured",
            ],
            [
              "WABA subscription",
              setup.webhook.subscribed
                ? "Last confirmed subscribed during onboarding"
                : "Unknown / not subscribed",
            ],
            ["Status tracking", "Signed message-status route"],
          ]}
        />
      </div>
      <Card className="p-5 sm:p-6">
        <SectionHeader
          title="Template availability"
          description="Persisted active templates for the connected account."
        />
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Total" value={setup.templateSummary.total} />
          <Metric label="Approved" value={setup.templateSummary.approved} />
          <Metric label="Pending" value={setup.templateSummary.pending} />
          <Metric label="Rejected" value={setup.templateSummary.rejected} />
        </div>
      </Card>
      <TestMessaging
        setup={setup}
        templates={templates}
        latest={latest}
        onResult={setLatest}
      />
    </div>
  );
}

function InfoCard({
  icon: Icon,
  title,
  status,
  rows,
}: {
  icon: typeof Plug;
  title: string;
  status: string;
  rows: Array<[string, string | undefined]>;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary">
            <Icon className="size-4" />
          </span>
          <h2 className="font-semibold">{title}</h2>
        </div>
        <StatusBadge status={status as never} />
      </div>
      <dl className="mt-5 space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[130px_1fr] gap-3 text-sm">
            <dt className="text-text-secondary">{label}</dt>
            <dd className="break-all text-right font-medium text-text-primary">
              {value || "Unknown"}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}
function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : undefined;
}

function TestMessaging({
  setup,
  templates,
  latest,
  onResult,
}: {
  setup: WhatsAppSetup;
  templates: WhatsAppTemplate[];
  latest: TestMessageStatus | null;
  onResult: (value: TestMessageStatus) => void;
}) {
  const [phoneId, setPhoneId] = useState(
    setup.phones.length === 1 ? setup.phones[0]!.phoneNumberId : "",
  );
  const [templateId, setTemplateId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [bodyValues, setBodyValues] = useState<string[]>([]);
  const [headerValues, setHeaderValues] = useState<string[]>([]);
  const [buttonValues, setButtonValues] = useState<Record<string, string>>({});
  const [mediaSource, setMediaSource] = useState<"LINK" | "ID">("LINK");
  const [mediaValue, setMediaValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sendFailure, setSendFailure] = useState<TestMessageStatus | null>(null);
  const selected = templates.find((item) => item.id === templateId);
  const parts = useMemo(
    () => (selected ? templateParts(selected) : null),
    [selected],
  );
  const bodyCount = parts ? variableCount(parts.body) : 0;
  const headerCount =
    parts?.headerType === "TEXT" ? variableCount(parts.headerText) : 0;
  const dynamicButtons =
    parts?.buttons
      .map((button, index) => ({ button, index }))
      .filter(
        ({ button }) =>
          button.type === "URL" && String(button.url ?? "").includes("{{"),
      ) ?? [];
  const mediaRequired =
    parts && ["IMAGE", "VIDEO", "DOCUMENT"].includes(parts.headerType);
  const selectTemplate = (nextTemplateId: string) => {
    const nextTemplate = templates.find((item) => item.id === nextTemplateId);
    const nextParts = nextTemplate ? templateParts(nextTemplate) : null;
    setTemplateId(nextTemplateId);
    setBodyValues(
      Array(nextParts ? variableCount(nextParts.body) : 0).fill(""),
    );
    setHeaderValues(
      Array(
        nextParts?.headerType === "TEXT"
          ? variableCount(nextParts.headerText)
          : 0,
      ).fill(""),
    );
    setButtonValues({});
    setMediaValue("");
  };
  const send = async () => {
    if (!selected) return;
    setSending(true);
    setError("");
    setSendFailure(null);
    try {
      const result = await whatsAppApi.sendTest({
        phoneNumberId: phoneId,
        templateRecordId: selected.id,
        recipient,
        ...(bodyCount ? { bodyVariables: bodyValues } : {}),
        ...(headerCount ? { headerVariables: headerValues } : {}),
        ...(dynamicButtons.length ? { buttonVariables: buttonValues } : {}),
        ...(mediaRequired
          ? {
              media: {
                type: parts!.headerType,
                source: mediaSource,
                value: mediaValue,
              },
            }
          : {}),
      });
      onResult(result);
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "The test message could not be sent.";
      setError(message);
      if (reason instanceof ApiClientError && ["131042", "131037"].includes(reason.code))
        setSendFailure({
          recordId: "",
          messageId: "",
          status: "FAILED",
          failureCode: reason.code,
          failureTitle: reason.code === "131042" ? "Payment setup required" : "Display name approval required",
          failureMessage: message,
        });
    } finally {
      setSending(false);
    }
  };
  const disabledReason = !setup.liveSendEnabled
    ? "Live sending is disabled by the server feature flag."
    : setup.transport !== "META"
      ? "The production Meta transport is not configured."
      : !setup.credential.configured
        ? "The Meta credential is missing."
        : "";
  const canRetry = !disabledReason && Boolean(selected && phoneId && recipient);
  return (
    <Card className="p-5 sm:p-6">
      <SectionHeader
        title="Test Messaging"
        description="Send one approved template through the shared server-side WhatsApp path."
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
        <div className="space-y-4">
          {disabledReason ? (
            <div className="rounded-xl border border-warning/20 bg-warning-soft px-4 py-3 text-sm text-warning">
              {disabledReason}
            </div>
          ) : null}
          <Field label="Sending phone">
            <Select
              value={phoneId}
              onChange={(event) => setPhoneId(event.target.value)}
            >
              <option value="">Select phone</option>
              {setup.phones.map((phone) => (
                <option key={phone.phoneNumberId} value={phone.phoneNumberId}>
                  {phone.displayPhoneNumber ||
                    phone.verifiedName ||
                    phone.phoneNumberId}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Approved template">
            <Select
              value={templateId}
              onChange={(event) => selectTemplate(event.target.value)}
            >
              <option value="">Select template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} · {template.language}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Destination">
            <Input
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="+919876543210"
            />
          </Field>
          {bodyValues.map((value, index) => (
            <Field
              key={`body-${index}`}
              label={`Body variable {{${index + 1}}}`}
            >
              <Input
                value={value}
                onChange={(event) =>
                  setBodyValues((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? event.target.value : item,
                    ),
                  )
                }
              />
            </Field>
          ))}
          {headerValues.map((value, index) => (
            <Field
              key={`header-${index}`}
              label={`Header variable {{${index + 1}}}`}
            >
              <Input
                value={value}
                onChange={(event) =>
                  setHeaderValues((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? event.target.value : item,
                    ),
                  )
                }
              />
            </Field>
          ))}
          {dynamicButtons.map(({ index }) => (
            <Field
              key={`button-${index}`}
              label={`Button ${index + 1} URL value`}
            >
              <Input
                value={buttonValues[String(index)] ?? ""}
                onChange={(event) =>
                  setButtonValues((current) => ({
                    ...current,
                    [String(index)]: event.target.value,
                  }))
                }
              />
            </Field>
          ))}
          {mediaRequired ? (
            <div className="grid gap-3 sm:grid-cols-[130px_1fr]">
              <Select
                value={mediaSource}
                onChange={(event) =>
                  setMediaSource(event.target.value as "LINK" | "ID")
                }
              >
                <option value="LINK">HTTPS link</option>
                <option value="ID">Meta media ID</option>
              </Select>
              <Input
                value={mediaValue}
                onChange={(event) => setMediaValue(event.target.value)}
                placeholder={mediaSource === "LINK" ? "https://…" : "Media ID"}
              />
            </div>
          ) : null}
          {error && !sendFailure ? (
            <p className="rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <PaymentEligibilityNotice
            failure={!disabledReason ? sendFailure ?? undefined : undefined}
            retrying={sending}
            onRetry={canRetry ? () => void send() : undefined}
          />
          <DisplayNameApprovalNotice failure={!disabledReason ? sendFailure ?? undefined : undefined} phone={setup.phones.find((item) => item.phoneNumberId === phoneId)} />
          <Button
            disabled={
              Boolean(disabledReason) ||
              sending ||
              !phoneId ||
              !templateId ||
              !recipient
            }
            onClick={() => void send()}
          >
            <Send className="size-4" />
            {sending ? "Sending…" : "Send Test"}
          </Button>
        </div>
        <div className="space-y-4">
          {selected ? (
            <TemplatePreview template={selected} />
          ) : (
            <div className="grid min-h-48 place-items-center rounded-card border border-dashed border-border bg-background text-sm text-text-muted">
              Select a template to preview it.
            </div>
          )}
          {latest ? (
            <div className="rounded-card border border-border bg-background p-4">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <MessageSquareText className="size-4 text-primary" />
                  Latest test
                </p>
                <StatusBadge status={latest.status as never} />
              </div>
              {latest.failureTitle || latest.failureMessage ? (
                <div className="mt-3 text-sm">
                  <p className="font-semibold text-danger">
                    {latest.failureTitle || "Message failed"}
                  </p>
                  <p className="mt-1 text-text-secondary">
                    {latest.failureMessage}
                  </p>
                  {latest.failureCode ? (
                    <p className="mt-1 text-xs text-text-muted">
                      Code {latest.failureCode}
                    </p>
                  ) : null}
                  {latest.nextAction && latest.failureCode !== "131042" ? (
                    <p className="mt-2 text-xs font-medium text-warning">
                      {latest.nextAction}
                    </p>
                  ) : null}
                  <PaymentEligibilityNotice
                    failure={!disabledReason && latest.status === "FAILED" ? latest : undefined}
                    retrying={sending}
                    onRetry={canRetry ? () => void send() : undefined}
                  />
                  <DisplayNameApprovalNotice failure={!disabledReason && latest.status === "FAILED" ? latest : undefined} phone={setup.phones.find((item) => item.phoneNumberId === phoneId)} />
                </div>
              ) : (
                <p className="mt-2 text-xs text-text-secondary">
                  Accepted by Meta; webhook updates will appear here.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-semibold">
      <span className="mb-2 block">{label}</span>
      {children}
    </label>
  );
}
