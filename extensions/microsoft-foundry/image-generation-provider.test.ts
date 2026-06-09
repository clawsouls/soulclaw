// Microsoft Foundry image provider tests cover MAI request construction.
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMicrosoftFoundryImageGenerationProvider } from "./image-generation-provider.js";
import { PROVIDER_ID } from "./shared.js";

const {
  assertOkOrThrowHttpErrorMock,
  isProviderApiKeyConfiguredMock,
  postJsonRequestMock,
  postMultipartRequestMock,
  prepareFoundryRuntimeAuthMock,
  resolveApiKeyForProviderMock,
  resolveProviderHttpRequestConfigMock,
  resolveProviderOperationTimeoutMsMock,
  sanitizeConfiguredModelProviderRequestMock,
} = vi.hoisted(() => ({
  assertOkOrThrowHttpErrorMock: vi.fn(async () => {}),
  isProviderApiKeyConfiguredMock: vi.fn(() => true),
  postJsonRequestMock: vi.fn(),
  postMultipartRequestMock: vi.fn(),
  prepareFoundryRuntimeAuthMock: vi.fn(),
  resolveApiKeyForProviderMock: vi.fn(async () => ({
    apiKey: "foundry-key",
    mode: "api-key" as const,
    source: "test",
  })),
  resolveProviderHttpRequestConfigMock: vi.fn((params: Record<string, unknown>) => ({
    baseUrl: params.baseUrl ?? params.defaultBaseUrl,
    allowPrivateNetwork: false,
    headers: new Headers(params.defaultHeaders as HeadersInit | undefined),
    dispatcherPolicy: undefined,
  })),
  resolveProviderOperationTimeoutMsMock: vi.fn(
    (params: Record<string, unknown>) => params.timeoutMs ?? params.defaultTimeoutMs,
  ),
  sanitizeConfiguredModelProviderRequestMock: vi.fn((request) => request),
}));

vi.mock("openclaw/plugin-sdk/provider-auth", () => ({
  isProviderApiKeyConfigured: isProviderApiKeyConfiguredMock,
}));

vi.mock("openclaw/plugin-sdk/provider-auth-runtime", () => ({
  resolveApiKeyForProvider: resolveApiKeyForProviderMock,
}));

vi.mock("openclaw/plugin-sdk/provider-http", () => ({
  assertOkOrThrowHttpError: assertOkOrThrowHttpErrorMock,
  postJsonRequest: postJsonRequestMock,
  postMultipartRequest: postMultipartRequestMock,
  resolveProviderHttpRequestConfig: resolveProviderHttpRequestConfigMock,
  resolveProviderOperationTimeoutMs: resolveProviderOperationTimeoutMsMock,
  sanitizeConfiguredModelProviderRequest: sanitizeConfiguredModelProviderRequestMock,
}));

vi.mock("./runtime.js", () => ({
  prepareFoundryRuntimeAuth: prepareFoundryRuntimeAuthMock,
}));

function buildConfig(
  params: {
    modelId?: string;
    modelName?: string;
    baseUrl?: string;
    includeModel?: boolean;
  } = {},
): OpenClawConfig {
  const baseUrl = params.baseUrl ?? "https://example.services.ai.azure.com/openai/v1";
  const modelId = params.modelId ?? "image-deployment";
  const modelName = params.modelName ?? "MAI-Image-2.5";
  return {
    models: {
      providers: {
        [PROVIDER_ID]: {
          baseUrl,
          api: "openai-completions",
          models:
            params.includeModel === false
              ? []
              : [
                  {
                    provider: PROVIDER_ID,
                    id: modelId,
                    name: modelName,
                    api: "openai-completions",
                    baseUrl,
                    reasoning: false,
                    input: ["text"],
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    contextWindow: 32_000,
                    maxTokens: 0,
                  },
                ],
        },
      },
    },
  };
}

function releasedJson(payload: unknown) {
  return {
    response: Response.json(payload),
    release: vi.fn(async () => {}),
  };
}

function requirePostJsonRequest(): Record<string, unknown> {
  const request = postJsonRequestMock.mock.calls[0]?.[0];
  if (!request || typeof request !== "object") {
    throw new Error("expected Microsoft Foundry JSON image request");
  }
  return request as Record<string, unknown>;
}

function requirePostMultipartRequest(): Record<string, unknown> {
  const request = postMultipartRequestMock.mock.calls[0]?.[0];
  if (!request || typeof request !== "object") {
    throw new Error("expected Microsoft Foundry multipart image request");
  }
  return request as Record<string, unknown>;
}

function requireHeaders(value: unknown): Headers {
  expect(value).toBeInstanceOf(Headers);
  if (!(value instanceof Headers)) {
    throw new Error("expected request headers");
  }
  return value;
}

describe("microsoft foundry image generation provider", () => {
  afterEach(() => {
    assertOkOrThrowHttpErrorMock.mockClear();
    isProviderApiKeyConfiguredMock.mockClear();
    postJsonRequestMock.mockReset();
    postMultipartRequestMock.mockReset();
    prepareFoundryRuntimeAuthMock.mockReset();
    resolveApiKeyForProviderMock.mockClear();
    resolveProviderHttpRequestConfigMock.mockClear();
    resolveProviderOperationTimeoutMsMock.mockClear();
    sanitizeConfiguredModelProviderRequestMock.mockClear();
  });

  it("exposes MAI image provider metadata and capabilities", () => {
    const provider = buildMicrosoftFoundryImageGenerationProvider();
    expect(provider.id).toBe(PROVIDER_ID);
    expect(provider.defaultModel).toBe("MAI-Image-2.5");
    expect(provider.models).toEqual([
      "MAI-Image-2.5-Flash",
      "MAI-Image-2.5",
      "MAI-Image-2e",
      "MAI-Image-2",
    ]);
    expect(provider.capabilities.generate.maxCount).toBe(1);
    expect(provider.capabilities.edit.enabled).toBe(true);
    expect(provider.capabilities.edit.maxInputImages).toBe(1);
    expect(provider.capabilities.output?.formats).toEqual(["png"]);
    expect(provider.isConfigured?.({ agentDir: "/agent" })).toBe(true);
    expect(isProviderApiKeyConfiguredMock).toHaveBeenCalledWith({
      provider: PROVIDER_ID,
      agentDir: "/agent",
    });
  });

  it("sends MAI image generation requests to the Foundry MAI endpoint with API-key auth", async () => {
    postJsonRequestMock.mockResolvedValue(
      releasedJson({
        data: [{ b64_json: Buffer.from("png").toString("base64") }],
      }),
    );
    const provider = buildMicrosoftFoundryImageGenerationProvider();

    const result = await provider.generateImage({
      provider: PROVIDER_ID,
      model: "image-deployment",
      prompt: "draw a clean product render",
      cfg: buildConfig(),
      size: "768x1365",
      timeoutMs: 12_345,
      ssrfPolicy: { allowDocumentationRanges: true },
    });

    expect(resolveApiKeyForProviderMock).toHaveBeenCalledWith({
      provider: PROVIDER_ID,
      cfg: buildConfig(),
      agentDir: undefined,
      store: undefined,
    });
    expect(resolveProviderHttpRequestConfigMock).toHaveBeenCalledWith({
      baseUrl: "https://example.services.ai.azure.com/mai/v1",
      defaultBaseUrl: "https://example.services.ai.azure.com/mai/v1",
      allowPrivateNetwork: false,
      defaultHeaders: { "api-key": "foundry-key" },
      request: undefined,
      provider: PROVIDER_ID,
      capability: "image",
      transport: "http",
    });
    expect(postJsonRequestMock).toHaveBeenCalledOnce();
    const request = requirePostJsonRequest();
    expect(request.url).toBe("https://example.services.ai.azure.com/mai/v1/images/generations");
    expect(request.body).toEqual({
      model: "image-deployment",
      prompt: "draw a clean product render",
      width: 768,
      height: 1365,
    });
    expect(Object.fromEntries(requireHeaders(request.headers).entries())).toEqual({
      "api-key": "foundry-key",
      "content-type": "application/json",
    });
    expect(request.timeoutMs).toBe(12_345);
    expect(request.ssrfPolicy).toEqual({ allowDocumentationRanges: true });
    expect(result.model).toBe("image-deployment");
    expect(result.images[0]?.buffer.toString()).toBe("png");
    expect(result.images[0]?.mimeType).toBe("image/png");
  });

  it("refreshes Entra ID auth and sends MAI image edits as multipart form data", async () => {
    resolveApiKeyForProviderMock.mockResolvedValueOnce({
      apiKey: "__entra_id_dynamic__",
      mode: "api-key",
      profileId: "microsoft-foundry:entra",
      source: "profile:microsoft-foundry:entra",
    });
    prepareFoundryRuntimeAuthMock.mockResolvedValueOnce({
      apiKey: "entra-token",
      baseUrl: "https://example.services.ai.azure.com/openai/v1",
      expiresAt: Date.now() + 60_000,
    });
    postMultipartRequestMock.mockResolvedValue(
      releasedJson({
        data: [{ b64_json: Buffer.from("edited").toString("base64") }],
      }),
    );
    const provider = buildMicrosoftFoundryImageGenerationProvider();

    const result = await provider.generateImage({
      provider: PROVIDER_ID,
      model: "image-deployment",
      prompt: "make it brighter",
      cfg: buildConfig(),
      agentDir: "/agent",
      inputImages: [
        {
          buffer: Buffer.from("input"),
          mimeType: "image/png",
          fileName: "input.png",
        },
      ],
    });

    expect(prepareFoundryRuntimeAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDir: "/agent",
        provider: PROVIDER_ID,
        modelId: "image-deployment",
        apiKey: "__entra_id_dynamic__",
        authMode: "api-key",
        profileId: "microsoft-foundry:entra",
      }),
    );
    expect(postMultipartRequestMock).toHaveBeenCalledOnce();
    const request = requirePostMultipartRequest();
    expect(request.url).toBe("https://example.services.ai.azure.com/mai/v1/images/edits");
    expect(Object.fromEntries(requireHeaders(request.headers).entries())).toEqual({
      authorization: "Bearer entra-token",
    });
    const form = request.body as FormData;
    expect(form.get("model")).toBe("image-deployment");
    expect(form.get("prompt")).toBe("make it brighter");
    const image = form.get("image");
    expect(image).toBeInstanceOf(Blob);
    expect((image as File).name).toBe("input.png");
    expect((image as File).type).toBe("image/png");
    expect(result.images[0]?.buffer.toString()).toBe("edited");
  });

  it("rejects image edits for MAI text-to-image-only deployments", async () => {
    const provider = buildMicrosoftFoundryImageGenerationProvider();

    await expect(
      provider.generateImage({
        provider: PROVIDER_ID,
        model: "image-deployment",
        prompt: "edit it",
        cfg: buildConfig({ modelName: "MAI-Image-2e" }),
        inputImages: [{ buffer: Buffer.from("input"), mimeType: "image/png" }],
      }),
    ).rejects.toThrow("MAI-Image-2e does not support Microsoft Foundry MAI image edits.");
    expect(resolveApiKeyForProviderMock).not.toHaveBeenCalled();
    expect(postMultipartRequestMock).not.toHaveBeenCalled();
  });

  it("allows custom MAI deployment names for generation when model metadata is absent", async () => {
    postJsonRequestMock.mockResolvedValue(
      releasedJson({
        data: [{ b64_json: Buffer.from("png").toString("base64") }],
      }),
    );
    const provider = buildMicrosoftFoundryImageGenerationProvider();

    await provider.generateImage({
      provider: PROVIDER_ID,
      model: "prod-image",
      prompt: "draw it",
      cfg: buildConfig({ includeModel: false }),
    });

    expect(postJsonRequestMock).toHaveBeenCalledOnce();
    expect(requirePostJsonRequest().body).toEqual({
      model: "prod-image",
      prompt: "draw it",
      width: 1024,
      height: 1024,
    });
  });

  it("requires MAI-Image-2.5 metadata before editing custom deployment names", async () => {
    const provider = buildMicrosoftFoundryImageGenerationProvider();

    await expect(
      provider.generateImage({
        provider: PROVIDER_ID,
        model: "prod-image",
        prompt: "edit it",
        cfg: buildConfig({ includeModel: false }),
        inputImages: [{ buffer: Buffer.from("input"), mimeType: "image/png" }],
      }),
    ).rejects.toThrow("edits require MAI-Image-2.5 model metadata");
    expect(resolveApiKeyForProviderMock).not.toHaveBeenCalled();
    expect(postMultipartRequestMock).not.toHaveBeenCalled();
  });

  it("rejects non-MAI image deployments before making requests", async () => {
    const provider = buildMicrosoftFoundryImageGenerationProvider();

    await expect(
      provider.generateImage({
        provider: PROVIDER_ID,
        model: "gpt-deployment",
        prompt: "draw it",
        cfg: buildConfig({ modelId: "gpt-deployment", modelName: "gpt-5.4" }),
      }),
    ).rejects.toThrow('supports MAI image deployments only, got "gpt-5.4"');
    expect(resolveApiKeyForProviderMock).not.toHaveBeenCalled();
    expect(postJsonRequestMock).not.toHaveBeenCalled();
  });

  it("rejects literal non-image MAI model names before making requests", async () => {
    const provider = buildMicrosoftFoundryImageGenerationProvider();

    await expect(
      provider.generateImage({
        provider: PROVIDER_ID,
        model: "MAI-DS-R1",
        prompt: "draw it",
        cfg: buildConfig({ includeModel: false }),
      }),
    ).rejects.toThrow('supports MAI image deployments only, got "MAI-DS-R1"');
    expect(resolveApiKeyForProviderMock).not.toHaveBeenCalled();
    expect(postJsonRequestMock).not.toHaveBeenCalled();
  });

  it("rejects MAI image sizes outside Microsoft Foundry limits", async () => {
    const provider = buildMicrosoftFoundryImageGenerationProvider();

    await expect(
      provider.generateImage({
        provider: PROVIDER_ID,
        model: "image-deployment",
        prompt: "draw it",
        cfg: buildConfig(),
        size: "512x512",
      }),
    ).rejects.toThrow("at least 768x768");
    expect(postJsonRequestMock).not.toHaveBeenCalled();
  });
});
