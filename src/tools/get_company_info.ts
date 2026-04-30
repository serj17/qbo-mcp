import type { QboClient, QboError, Result } from "../qbo-client/index.js";
import { type ToolDefinition } from "../tool-registry/index.js";

interface CompanyInfoResponse {
  CompanyInfo?: Record<string, unknown>;
}

interface CompanyInfoResult {
  company_name: string;
  legal_name: string | null;
  country: string | null;
  fiscal_year_start_month: string | null;
  default_currency: string | null;
  supported_languages: string | null;
  raw: Record<string, unknown>;
}

let cached: CompanyInfoResult | null = null;

export function clearCompanyInfoCache(): void {
  cached = null;
}

export async function handleGetCompanyInfo(
  _input: Record<string, never>,
  qbo: QboClient,
): Promise<Result<CompanyInfoResult, QboError>> {
  if (cached) {
    return { ok: true, value: cached };
  }

  const result = await qbo.getCompanyInfo<CompanyInfoResponse>();
  if (!result.ok) return result;

  const info = result.value.CompanyInfo;
  if (!info) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "CompanyInfo not found in QBO response.",
        retryable: false,
      },
    };
  }

  const currencyRef = info.HomeCurrencyRef as { value?: string; name?: string } | undefined;

  cached = {
    company_name: (info.CompanyName as string) ?? "Unknown",
    legal_name: (info.LegalName as string) ?? null,
    country: (info.Country as string) ?? null,
    fiscal_year_start_month: (info.FiscalYearStartMonth as string) ?? null,
    default_currency: currencyRef?.value ?? (info.HomeCurrency as string) ?? null,
    supported_languages: (info.SupportedLanguages as string) ?? null,
    raw: info,
  };

  return { ok: true, value: cached };
}

export const getCompanyInfoTool: ToolDefinition<Record<string, never>> = {
  name: "get_company_info",
  description:
    "Fetch basic information about the connected QuickBooks company: legal name, fiscal year start " +
    "month, country, and default currency. The result is cached for the lifetime of the server " +
    "process — subsequent calls return instantly. Call this at the start of a conversation to " +
    "orient yourself before running queries.",
  schema: {},
  handler: async (input, deps) => handleGetCompanyInfo(input, deps.qbo),
};
