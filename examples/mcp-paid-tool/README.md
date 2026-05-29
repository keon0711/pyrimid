# Paid MCP tool pattern

Best fit: MCP servers with expensive data, scraping, enrichment, analytics, compliance checks, search, or model calls.

This example shows the smallest reproducible shape for turning an existing MCP tool into a paid API call that agents can discover through Pyrimid and purchase through x402 on Base USDC.

## Tool design

- Free MCP tool: `preview_vendor_search` returns schema, price, sample output, and a payment requirement.
- Paid HTTP endpoint: `GET /api/paid/vendor-search?q=...` returns HTTP 402/x402 metadata until paid.
- Paid MCP tool: `buy_vendor_search` calls the paid HTTP endpoint, retries with `X-PAYMENT` or `X-PAYMENT-TX`, then returns the paid JSON.
- Discovery: publish an MCP server card, `llms.txt`, `agents.txt`, and a Pyrimid catalog entry.

Keep the free preview useful but incomplete. It should let buyer agents decide whether to pay without giving away the paid result.

## Working endpoint shape

Use the seed Pyrimid paid endpoint as a live reference:

```bash
curl -i "https://pyrimid.ai/api/v1/paid/vendor-lead-discovery?segment=mcp"
```

Expected unauthenticated response:

```http
HTTP/2 402
content-type: application/json
x-payment-required: {"scheme":"x402",...}
x-pyrimid-vendor: pyrimid-growth
x-pyrimid-product: vendor-lead-discovery
```

Response body shape:

```json
{
  "error": "payment_required",
  "message": "Pay $0.25 USDC on Base through Pyrimid, then retry with X-PAYMENT or X-PAYMENT-TX.",
  "accepts": [
    {
      "scheme": "x402",
      "network": "base",
      "asset": "USDC",
      "maxAmountRequired": "250000",
      "resource": "https://pyrimid.ai/api/v1/paid/vendor-lead-discovery?segment=mcp"
    }
  ],
  "docs": "https://pyrimid.ai/quickstart"
}
```

After the buyer pays through the Pyrimid router, retry with a payment proof:

```bash
curl -s "https://pyrimid.ai/api/v1/paid/vendor-lead-discovery?segment=mcp" \
  -H "X-PAYMENT-TX: 0xYOUR_BASE_TX_HASH" | jq
```

Successful paid responses should be deterministic JSON that a buyer or verifier can inspect. For vendor discovery, that means leads, scores, evidence URLs, suggested product IDs, and next actions. For an MCP audit, that means paid-tool recommendations, pricing, route shape, catalog metadata, and risk notes.

## Minimal product metadata

```json
{
  "vendor_id": "your-mcp-server",
  "product_id": "paid_search",
  "description": "Paid MCP search result with enriched citations",
  "category": "search-scraping",
  "tags": ["mcp", "search", "x402", "paid-tools"],
  "price_usdc": 50000,
  "affiliate_bps": 3000,
  "endpoint": "https://your-service.com/api/paid/search",
  "network": "base",
  "asset": "USDC"
}
```

Recommended metadata fields:

| Field | Why it matters |
| --- | --- |
| `vendor_id` | Stable vendor identifier used for settlement and stats. |
| `product_id` | Stable product identifier used by agents and affiliates. |
| `description` | One-sentence value proposition for buyer agents. |
| `price_usdc` | Integer micro-USDC amount. `50000` means $0.05. |
| `affiliate_bps` | Commission paid to routing agents. `3000` means 30%. |
| `endpoint` | Public HTTP endpoint that returns 402 before payment. |
| `output_schema` | JSON schema for paid result verification. |

## Minimal paid route

```ts
export async function GET(req: Request) {
  const proof = req.headers.get("x-payment") || req.headers.get("x-payment-tx");
  const product = {
    vendor_id: "your-mcp-server",
    product_id: "paid_search",
    price_usdc: 50000,
    price_display: "$0.05",
    endpoint: "https://your-service.com/api/paid/search",
    affiliate_bps: 3000
  };

  if (!proof) {
    return Response.json(
      {
        error: "payment_required",
        message: `Pay ${product.price_display} USDC on Base through Pyrimid.`,
        accepts: [
          {
            scheme: "x402",
            network: "base",
            asset: "USDC",
            maxAmountRequired: String(product.price_usdc),
            resource: product.endpoint,
            payTo: "0xc949AEa380D7b7984806143ddbfE519B03ABd68B"
          }
        ],
        docs: "https://pyrimid.ai/quickstart"
      },
      {
        status: 402,
        headers: {
          "X-PAYMENT-REQUIRED": JSON.stringify({ scheme: "x402", product_id: product.product_id }),
          "X-Pyrimid-Vendor": product.vendor_id,
          "X-Pyrimid-Product": product.product_id,
          "Cache-Control": "no-store"
        }
      }
    );
  }

  // Verify the Base payment tx before returning paid content.
  // In production, check recipient, amount, asset, chain, product_id, and replay status.
  return Response.json({
    product_id: product.product_id,
    result: {
      query: new URL(req.url).searchParams.get("q") || "",
      rows: []
    },
    routed_by: "pyrimid"
  });
}
```

## MCP wrapper tools

Expose two tools from the MCP server:

```json
[
  {
    "name": "preview_paid_search",
    "description": "Preview the paid search product, price, output schema, and x402 payment requirement."
  },
  {
    "name": "buy_paid_search",
    "description": "Purchase and run paid search through Pyrimid x402 routing. Requires a Base USDC payment proof."
  }
]
```

`preview_paid_search` should never require payment. It returns:

```json
{
  "product_id": "paid_search",
  "price_usdc": 50000,
  "endpoint": "https://your-service.com/api/paid/search",
  "output_schema": {
    "type": "object",
    "properties": {
      "rows": { "type": "array" },
      "routed_by": { "const": "pyrimid" }
    }
  }
}
```

`buy_paid_search` should:

1. Call the paid endpoint without payment and surface the 402 metadata.
2. Ask the buyer runtime to pay using x402/Base USDC.
3. Retry with `X-PAYMENT` or `X-PAYMENT-TX`.
4. Return the paid JSON, not the payment secret.

## Reproducibility checklist

- `curl -i <endpoint>` returns HTTP 402 with `accepts[]`, `X-Pyrimid-Vendor`, and `X-Pyrimid-Product`.
- `accepts[0].resource` exactly matches the paid endpoint URL.
- `price_usdc` is an integer in micro-USDC and matches `maxAmountRequired`.
- Paid response includes `product_id`, a typed result object, and `routed_by: "pyrimid"`.
- Catalog entry includes endpoint, price, affiliate basis points, tags, and output schema.
- MCP server exposes a free preview tool and a paid execution tool.
- Docs link to https://pyrimid.ai/quickstart so buyer agents can reproduce the payment flow.

## Why route through Pyrimid?

- Agents can find your tool in one catalog.
- Buyer agents get a standard x402 payment flow.
- Affiliates can route demand to your tool.
- Vendor, affiliate, and protocol fees are visible onchain.
