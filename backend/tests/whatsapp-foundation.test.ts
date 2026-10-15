import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env.js";
import { assertTestMessagingEnabled } from "../src/controllers/whatsapp.controller.js";
import { MetaConnection } from "../src/models/meta-connection.model.js";
import { MetaCredential } from "../src/models/meta-credential.model.js";
import { WhatsAppAccount } from "../src/models/whatsapp-account.model.js";
import { WhatsAppMessage } from "../src/models/whatsapp-message.model.js";
import { WhatsAppPhoneNumber } from "../src/models/whatsapp-phone-number.model.js";
import { WhatsAppTemplate } from "../src/models/whatsapp-template.model.js";
import { Workspace } from "../src/models/workspace.model.js";
import { resolveConnectedWhatsApp } from "../src/services/whatsapp/connection-context.service.js";
import { normalizeWhatsAppPhone } from "../src/services/broadcast/phone.js";
import { decryptMetaCredential } from "../src/services/whatsapp/credential-encryption.js";
import { metaFailureResolution } from "../src/services/whatsapp/meta-graph.service.js";
import {
  buildTemplatePayload,
  sendApprovedTemplateMessage,
} from "../src/services/whatsapp/send-approved-template.service.js";
import {
  approvedTemplateOptions,
  listWorkspaceTemplates,
  syncWorkspaceTemplates,
  toClientTemplate,
  validateTemplateStatus,
} from "../src/services/whatsapp/template.service.js";
import type { WhatsAppTransport } from "../src/services/whatsapp/transport.js";

const W1 = "64b000000000000000000001";
const W2 = "64b000000000000000000002";
const C1 = "64b000000000000000000003";
const A1 = "64b000000000000000000004";
const T1 = "64b000000000000000000005";
const P1 = "1000000000000001";
const originalKey = env.ENCRYPTION_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  env.ENCRYPTION_KEY = originalKey;
});

function encrypted(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    createHash("sha256").update(secret, "utf8").digest(),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function mockConnectedContext(workspaceId = W1) {
  vi.spyOn(Workspace, "findOne").mockReturnValue({
    lean: async () => ({ _id: workspaceId, status: "ACTIVE" }),
  } as never);
  vi.spyOn(MetaConnection, "findOne").mockReturnValue({
    lean: async () => ({
      _id: C1,
      workspaceId,
      provider: "meta",
      status: "CONNECTED",
    }),
  } as never);
  vi.spyOn(WhatsAppAccount, "find").mockReturnValue({
    limit: () => ({
      lean: async () => [
        {
          _id: A1,
          workspaceId,
          connectionId: C1,
          wabaId: "waba-1",
          status: "CONNECTED",
        },
      ],
    }),
  } as never);
  vi.spyOn(WhatsAppPhoneNumber, "find").mockReturnValue({
    sort: () => ({
      lean: async () => [
        {
          _id: P1,
          workspaceId,
          whatsappAccountId: A1,
          phoneNumberId: "phone-1",
        },
      ],
    }),
  } as never);
}

describe("WhatsApp foundation migration", () => {
  it("decrypts the exact V2 AES-256-GCM credential format server-side", () => {
    env.ENCRYPTION_KEY = "controlled-test-key";
    expect(
      decryptMetaCredential(encrypted("controlled-token", env.ENCRYPTION_KEY)),
    ).toBe("controlled-token");
  });

  it("fails safely when credential encryption is unavailable", () => {
    env.ENCRYPTION_KEY = "";
    expect(() =>
      decryptMetaCredential(encrypted("controlled-token", "another-key")),
    ).toThrow(/not configured/i);
  });

  it("uses the supplied workspace in every connection ownership predicate", async () => {
    mockConnectedContext(W2);
    await resolveConnectedWhatsApp(W2);
    expect(Workspace.findOne).toHaveBeenCalledWith({
      _id: W2,
      status: "ACTIVE",
    });
    expect(MetaConnection.findOne).toHaveBeenCalledWith({
      workspaceId: W2,
      provider: "meta",
      status: "CONNECTED",
    });
    expect(WhatsAppAccount.find).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: W2, connectionId: C1 }),
    );
  });

  it("does not resolve assets from another workspace", async () => {
    vi.spyOn(Workspace, "findOne").mockReturnValue({
      lean: async () => null,
    } as never);
    await expect(resolveConnectedWhatsApp(W2)).rejects.toMatchObject({
      code: "WORKSPACE_FORBIDDEN",
    });
  });

  it("returns a safe missing credential error before any provider call", async () => {
    mockConnectedContext();
    vi.spyOn(MetaCredential, "findOne").mockReturnValue({
      select: () => ({ lean: async () => null }),
    } as never);
    await expect(resolveConnectedWhatsApp(W1, true)).rejects.toMatchObject({
      code: "META_CREDENTIAL_UNAVAILABLE",
    });
  });

  it("maps persisted template components without changing status meanings", () => {
    const mapped = toClientTemplate({
      _id: T1,
      metaTemplateId: "meta-1",
      name: "hello",
      language: "en_US",
      category: "UTILITY",
      status: "PENDING",
      components: [{ type: "BODY", text: "Hello" }],
      source: "CUSTOM",
      lastSyncedAt: new Date(),
    });
    expect(mapped).toMatchObject({
      id: T1,
      status: "PENDING",
      category: "UTILITY",
      components: [{ type: "BODY", text: "Hello" }],
    });
  });

  it("keeps approved templates as the Broadcast selection contract", () => {
    const base = {
      id: T1,
      metaTemplateId: "meta-1",
      name: "one",
      language: "en_US",
      category: "UTILITY",
      components: [],
      source: "CUSTOM",
      lastSyncedAt: new Date(),
    };
    expect(
      approvedTemplateOptions([
        { ...base, status: "APPROVED" },
        { ...base, id: W2, status: "REJECTED" },
      ]),
    ).toHaveLength(1);
  });

  it("accepts supported template states and rejects invented states", () => {
    expect(validateTemplateStatus("approved")).toBe("APPROVED");
    expect(validateTemplateStatus("pending")).toBe("PENDING");
    expect(validateTemplateStatus("rejected")).toBe("REJECTED");
    expect(() => validateTemplateStatus("invented")).toThrow(
      /invalid template status/i,
    );
  });

  it("validates E.164 destinations and exact body parameters", () => {
    const template = {
      name: "hello",
      language: "en_US",
      components: [{ type: "BODY", text: "Hello {{1}}" }],
    };
    expect(() =>
      buildTemplatePayload({
        template,
        recipient: "919876543210",
        bodyVariables: [],
      }),
    ).toThrow(/exactly 1/i);
    expect(() => normalizeWhatsAppPhone("123")).toThrow(
      /country code and 8-15 digits/i,
    );
    expect(normalizeWhatsAppPhone("+919876543210")).toBe("+919876543210");
  });

  it("fails closed when live test messaging is disabled", () => {
    const live = env.CAMPAIGN_LIVE_SEND_ENABLED;
    const transport = env.CAMPAIGN_TRANSPORT;
    try {
      env.CAMPAIGN_LIVE_SEND_ENABLED = "false";
      env.CAMPAIGN_TRANSPORT = "meta";
      expect(() => assertTestMessagingEnabled()).toThrowError(
        expect.objectContaining({ code: "LIVE_SEND_DISABLED" }),
      );
      env.CAMPAIGN_LIVE_SEND_ENABLED = "true";
      env.CAMPAIGN_TRANSPORT = "disabled";
      expect(() => assertTestMessagingEnabled()).toThrowError(
        expect.objectContaining({ code: "TRANSPORT_NOT_CONFIGURED" }),
      );
    } finally {
      env.CAMPAIGN_LIVE_SEND_ENABLED = live;
      env.CAMPAIGN_TRANSPORT = transport;
    }
  });

  it("lists templates through workspace and account ownership predicates", async () => {
    mockConnectedContext(W2);
    const find = vi
      .spyOn(WhatsAppTemplate, "find")
      .mockReturnValue({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      } as never);
    await listWorkspaceTemplates(W2, { status: "APPROVED", search: "hello.*" });
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: W2,
        whatsappAccountId: A1,
        status: "APPROVED",
        isActive: true,
      }),
    );
    expect(find.mock.calls[0]?.[0]).toMatchObject({
      name: { $regex: "hello\\.\\*", $options: "i" },
    });
  });

  it("syncs by workspace/account/Meta ID with idempotent upserts", async () => {
    env.ENCRYPTION_KEY = "controlled-test-key";
    mockConnectedContext();
    vi.spyOn(MetaCredential, "findOne").mockReturnValue({
      select: () => ({
        lean: async () => ({
          encryptedAccessToken: encrypted(
            "controlled-token",
            env.ENCRYPTION_KEY,
          ),
        }),
      }),
    } as never);
    const bulkWrite = vi
      .spyOn(WhatsAppTemplate, "bulkWrite")
      .mockResolvedValue({} as never);
    const updateMany = vi
      .spyOn(WhatsAppTemplate, "updateMany")
      .mockResolvedValue({ modifiedCount: 0 } as never);
    vi.spyOn(WhatsAppTemplate, "find").mockReturnValue({
      select: () => ({ lean: async () => [] }),
      sort: () => ({ limit: () => ({ lean: async () => [] }) }),
    } as never);
    const metaTemplate = {
      id: "meta-template-1",
      name: "hello",
      language: "en_US",
      category: "UTILITY",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Hello" }],
    };
    await syncWorkspaceTemplates(W1, async () => [metaTemplate, metaTemplate]);
    const operations = bulkWrite.mock.calls[0]?.[0] as Array<{
      updateOne: { filter: Record<string, unknown>; upsert: boolean };
    }>;
    expect(operations).toHaveLength(1);
    expect(operations[0]?.updateOne).toMatchObject({
      filter: {
        workspaceId: W1,
        whatsappAccountId: A1,
        metaTemplateId: "meta-template-1",
      },
      upsert: true,
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: W1, whatsappAccountId: A1 }),
      expect.anything(),
    );
  });

  it("maps body, text-header, media, and dynamic-button parameters safely", () => {
    const result = buildTemplatePayload({
      template: {
        name: "document",
        language: "en_US",
        components: [
          { type: "HEADER", format: "DOCUMENT" },
          { type: "BODY", text: "Invoice {{1}}" },
          {
            type: "BUTTONS",
            buttons: [{ type: "URL", url: "https://example.com/{{1}}" }],
          },
        ],
      },
      recipient: "919876543210",
      bodyVariables: ["INV-1"],
      buttonVariables: { 0: "INV-1" },
      media: {
        type: "DOCUMENT",
        source: "LINK",
        value: "https://example.com/invoice.pdf",
      },
    });
    expect(result.payload.template).toMatchObject({
      name: "document",
      language: { code: "en_US" },
    });
    expect(JSON.stringify(result.payload)).toContain("INV-1");
    expect(JSON.stringify(result.payload)).toContain("invoice.pdf");
  });

  it("requires an approved workspace-owned template before sending", async () => {
    vi.spyOn(WhatsAppAccount, "findOne").mockReturnValue({
      lean: async () => ({ _id: A1, connectionId: C1, status: "CONNECTED" }),
    } as never);
    vi.spyOn(MetaConnection, "findOne").mockReturnValue({
      lean: async () => ({ _id: C1, status: "CONNECTED" }),
    } as never);
    vi.spyOn(WhatsAppPhoneNumber, "findOne").mockReturnValue({
      lean: async () => ({ phoneNumberId: "phone-1", registrationStatus: "REGISTERED", codeVerificationStatus: "VERIFIED" }),
    } as never);
    vi.spyOn(WhatsAppTemplate, "findOne").mockReturnValue({
      lean: async () => null,
    } as never);
    const transport = {
      requiresCredential: false,
      sendTemplate: vi.fn(),
    } satisfies WhatsAppTransport;
    await expect(
      sendApprovedTemplateMessage(
        {
          workspaceId: W1,
          whatsappAccountId: A1,
          phoneNumberId: "phone-1",
          templateRecordId: T1,
          recipient: "+919876543210",
          sendSource: "TEST",
        },
        transport,
      ),
    ).rejects.toMatchObject({ code: "TEMPLATE_UNAVAILABLE" });
    expect(transport.sendTemplate).not.toHaveBeenCalled();
  });

  it("persists one TEST wamid from a mocked accepted Meta response", async () => {
    vi.spyOn(WhatsAppAccount, "findOne").mockReturnValue({
      lean: async () => ({ _id: A1, connectionId: C1, status: "CONNECTED" }),
    } as never);
    vi.spyOn(MetaConnection, "findOne").mockReturnValue({
      lean: async () => ({ _id: C1, status: "CONNECTED" }),
    } as never);
    vi.spyOn(WhatsAppPhoneNumber, "findOne").mockReturnValue({
      lean: async () => ({ phoneNumberId: "phone-1", registrationStatus: "REGISTERED", codeVerificationStatus: "VERIFIED" }),
    } as never);
    vi.spyOn(WhatsAppTemplate, "findOne").mockReturnValue({
      lean: async () => ({
        _id: T1,
        metaTemplateId: "meta-1",
        name: "hello",
        language: "en_US",
        status: "APPROVED",
        isActive: true,
        components: [{ type: "BODY", text: "Hello {{1}}" }],
      }),
    } as never);
    const persisted = vi
      .spyOn(WhatsAppMessage, "findOneAndUpdate")
      .mockResolvedValue({
        _id: P1,
        metaMessageId: "wamid.mock.accepted",
        acceptedAt: new Date(),
      } as never);
    const transport = {
      requiresCredential: false,
      sendTemplate: vi
        .fn()
        .mockResolvedValue({
          messageId: "wamid.mock.accepted",
          responseStatus: "accepted",
        }),
    } satisfies WhatsAppTransport;
    const result = await sendApprovedTemplateMessage(
      {
        workspaceId: W1,
        whatsappAccountId: A1,
        phoneNumberId: "phone-1",
        templateRecordId: T1,
        recipient: "+919876543210",
        bodyVariables: ["Aarav"],
        sendSource: "TEST",
      },
      transport,
    );
    expect(result.messageId).toBe("wamid.mock.accepted");
    expect(persisted.mock.calls[0]?.[1]).toMatchObject({
      $setOnInsert: { sendSource: "TEST", status: "ACCEPTED" },
    });
  });

  it("maps Meta 131042 to a safe payment action", () => {
    expect(metaFailureResolution(131042)).toMatchObject({
      title: "Payment setup required",
      code: "131042",
      actionUrl: "https://business.facebook.com/billing_hub/",
    });
    expect(metaFailureResolution("TRANSPORT_NOT_CONFIGURED")).toBeUndefined();
  });
});
