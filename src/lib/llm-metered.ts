import {
  callLlm as baseCall,
  callLlmJson as baseJson,
  type LlmRequest,
  type FetchLike,
} from "@/lib/llm";
import { meteredFetch } from "@/lib/ai-metering";
export { extractJsonObject, type LlmTarget } from "@/lib/llm";
export const callLlm = (req: LlmRequest, transport: FetchLike = fetch) =>
  baseCall(
    req,
    meteredFetch(
      { provider: req.provider, model: req.model, kind: "llm" },
      transport,
    ),
  );
export const callLlmJson = (req: LlmRequest, transport: FetchLike = fetch) =>
  baseJson(
    req,
    meteredFetch(
      { provider: req.provider, model: req.model, kind: "llm" },
      transport,
    ),
  );
