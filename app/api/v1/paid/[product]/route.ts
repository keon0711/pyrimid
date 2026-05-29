import { NextRequest, NextResponse } from 'next/server';
import { getSeedProduct, paymentRequirement } from '@/lib/seed-products';
import { verifyPyrimidPaymentTx } from '@/lib/payment-verification';

function paymentRequired(req: NextRequest, product: NonNullable<ReturnType<typeof getSeedProduct>>) {
  const requirement = paymentRequirement(product, req.url);
  return NextResponse.json(
    {
      error: 'payment_required',
      message: `Pay ${product.price_display} USDC on Base through Pyrimid, then retry with X-PAYMENT or X-PAYMENT-TX.`,
      accepts: [requirement],
      docs: 'https://pyrimid.ai/quickstart',
      catalog: 'https://pyrimid.ai/api/v1/catalog?source=pyrimid-seed',
    },
    {
      status: 402,
      headers: {
        'X-PAYMENT-REQUIRED': JSON.stringify(requirement),
        'X-Pyrimid-Vendor': product.vendor_id,
        'X-Pyrimid-Product': product.product_id,
        'Cache-Control': 'no-store',
      },
    }
  );
}

type GithubRepo = {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  updated_at: string;
  homepage?: string | null;
  topics?: string[];
};

function slug(input: string) {
  return input
    .toLowerCase()
    .replace(/https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function leadSearchQueries(segment: string) {
  if (/agent|framework/i.test(segment)) {
    return [
      'agent framework marketplace api language:TypeScript',
      'ai agent tools mcp server language:TypeScript',
      'autonomous agent marketplace api language:Python',
    ];
  }
  if (/api|data/i.test(segment)) {
    return [
      'paid api x402 language:TypeScript',
      'l402 api service language:TypeScript',
      'ai api metered billing language:Python',
    ];
  }
  return [
    'mcp server api tools language:TypeScript',
    'model context protocol server data language:Python',
    'mcp server search export analyze language:TypeScript',
  ];
}

async function fetchGithubRepos(query: string): Promise<GithubRepo[]> {
  const params = new URLSearchParams({ q: query, sort: 'updated', order: 'desc', per_page: '5' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(`https://api.github.com/search/repositories?${params}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'pyrimid-vendor-lead-discovery',
      },
      signal: controller.signal,
      next: { revalidate: 1800 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function vendorLeadDiscovery(segment: string) {
  const queries = leadSearchQueries(segment);
  const repos = (await Promise.all(queries.map(fetchGithubRepos))).flat();
  const seen = new Set<string>();
  const leads = repos
    .filter((repo) => {
      if (seen.has(repo.full_name)) return false;
      seen.add(repo.full_name);
      return true;
    })
    .map((repo) => {
      const text = `${repo.full_name} ${repo.description || ''} ${(repo.topics || []).join(' ')}`;
      const signals = [
        /mcp|model context protocol/i.test(text) ? 'mcp-surface' : null,
        /api|sdk|server/i.test(text) ? 'api-or-tool-server' : null,
        /search|data|crawl|scrape|export|analy/i.test(text) ? 'data-or-analysis-value' : null,
        /payment|billing|x402|l402|paid|stripe/i.test(text) ? 'payment-aware' : null,
        repo.homepage ? 'has-live-homepage' : null,
      ].filter((signal): signal is string => Boolean(signal));
      const score =
        35 +
        Math.min(25, Math.floor(repo.stargazers_count / 20)) +
        signals.length * 8 +
        (Date.now() - Date.parse(repo.updated_at) < 90 * 24 * 60 * 60 * 1000 ? 12 : 0);
      const productId = slug(repo.name || repo.full_name);
      return {
        name: repo.full_name,
        repo: repo.html_url,
        homepage: repo.homepage || null,
        description: repo.description || 'No repository description provided.',
        stars: repo.stargazers_count,
        last_updated: repo.updated_at,
        score: Math.min(100, score),
        fit: score >= 75 ? 'high' : score >= 58 ? 'medium' : 'watchlist',
        signals,
        suggested_paid_product: {
          product_id: productId,
          route_shape: `/api/paid/${productId}`,
          starting_price_usdc: '0.05-0.25',
          affiliate_bps: 2000,
        },
        pyrimid_angle:
          signals.includes('mcp-surface')
            ? 'Package one existing MCP tool as a paid x402 endpoint and list it in the Pyrimid catalog.'
            : 'Wrap the highest-value API call behind x402 and let agents resell it through Pyrimid affiliate routing.',
        next_action: `Open an issue or PR proposing a paid ${productId} endpoint with x402 accepts[] metadata and Pyrimid catalog fields.`,
        evidence: [
          { type: 'github_repo', url: repo.html_url },
          repo.homepage ? { type: 'homepage', url: repo.homepage } : null,
        ].filter((item): item is { type: string; url: string } => Boolean(item)),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return {
    segment,
    generated_at: new Date().toISOString(),
    source: {
      github_search: true,
      queries,
      fallback_used: leads.length === 0,
    },
    scoring_model: {
      max_score: 100,
      signals: ['mcp-surface', 'api-or-tool-server', 'data-or-analysis-value', 'payment-aware', 'has-live-homepage', 'recently-updated', 'stars'],
    },
    leads:
      leads.length > 0
        ? leads
        : [
            {
              name: 'Sats4AI',
              homepage: 'https://sats4ai.com',
              description: 'L402-native AI API with many paid endpoints; useful as a reference vendor for Pyrimid catalog shaping.',
              score: 72,
              fit: 'medium',
              signals: ['payment-aware', 'api-or-tool-server', 'has-live-homepage'],
              suggested_paid_product: { product_id: 'sats4ai-agent-tools', route_shape: '/api/paid/sats4ai-agent-tools', starting_price_usdc: '0.05-0.25', affiliate_bps: 1500 },
              pyrimid_angle: 'Mirror one agent-facing endpoint as a Pyrimid-listed product and route purchases through Base USDC.',
              next_action: 'Contact the vendor with a concrete catalog entry draft and x402 route example.',
              evidence: [{ type: 'homepage', url: 'https://sats4ai.com' }],
            },
          ],
    next_actions: [
      'Prioritize high-fit leads with MCP or data/API surfaces.',
      'Draft a one-route x402 integration issue or PR for the top lead.',
      'List product_id, price_usdc, affiliate_bps, endpoint, and output_schema before outreach.',
    ],
  };
}

function safeTargetUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (/^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.|0\.0\.0\.0)/i.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

async function inspectMcpTarget(rawUrl: string) {
  const target = safeTargetUrl(rawUrl);
  if (!target) {
    return {
      fetch_status: 'skipped',
      reason: 'URL must be public http(s); localhost and private-network targets are not fetched.',
      sample: '',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(target.toString(), {
      signal: controller.signal,
      headers: { accept: 'application/json,text/plain,text/html;q=0.8,*/*;q=0.5' },
      next: { revalidate: 1800 },
    });
    const text = (await res.text()).slice(0, 12_000);
    return {
      fetch_status: res.ok ? 'ok' : 'http_error',
      http_status: res.status,
      content_type: res.headers.get('content-type'),
      sample: text,
    };
  } catch {
    return { fetch_status: 'failed', sample: '' };
  } finally {
    clearTimeout(timeout);
  }
}

function auditFromSample(url: string, sample: string) {
  const lower = sample.toLowerCase();
  const toolHints = [
    lower.includes('search') ? 'search' : null,
    lower.includes('export') || lower.includes('csv') ? 'export' : null,
    lower.includes('enrich') ? 'enrich' : null,
    lower.includes('analy') || lower.includes('audit') ? 'analyze' : null,
    lower.includes('summar') ? 'summarize' : null,
    lower.includes('scrap') || lower.includes('crawl') ? 'crawl' : null,
  ].filter((tool): tool is string => Boolean(tool));
  const parsed = safeTargetUrl(url);
  const endpointSlug = slug(parsed?.hostname || 'mcp-server');
  const recommended = toolHints.length > 0 ? toolHints : ['search', 'enrich', 'export', 'analyze'];

  return {
    recommended_paid_tools: recommended.map((tool) => ({
      tool,
      product_id: `${endpointSlug}-${tool}`,
      route_shape: `/api/paid/${tool}`,
      suggested_price_usdc: tool === 'search' ? '0.01-0.05' : '0.05-0.25',
      buyer_value: `${tool} is a repeatable agent action with clear per-call utility.`,
    })),
    monetization_readiness: {
      has_mcp_or_tool_terms: /mcp|tool|json-rpc|capabilities|resources|prompts/i.test(sample),
      has_payment_terms: /x402|l402|payment|invoice|usdc|price|billing/i.test(sample),
      has_machine_readable_schema: /json|schema|openapi|tools|inputSchema|outputSchema/i.test(sample),
    },
    x402_route_shape: 'Return HTTP 402 with accepts[] metadata until X-PAYMENT or X-PAYMENT-TX is supplied; on valid payment, execute the paid tool and return JSON.',
    catalog_metadata: {
      vendor_id: endpointSlug,
      product_id: `${endpointSlug}-${recommended[0]}`,
      endpoint: url,
      method: 'GET or POST',
      price_usdc: 50_000,
      affiliate_bps: 2000,
      output_schema: { type: 'object', properties: { result: { type: 'object' }, routed_by: { const: 'pyrimid' } } },
    },
    risk_notes: [
      'Do not put secrets in MCP tool descriptions or paid endpoint responses.',
      'Block localhost/private-network URLs if this audit endpoint ever fetches arbitrary targets server-side.',
      'Keep paid outputs deterministic enough for buyer verification and refunds.',
    ],
    implementation_steps: [
      'Pick one high-value tool and publish a paid route beside the free MCP server.',
      'Add x402 accepts[] metadata with Base USDC price, product_id, and max timeout.',
      'Register the product in the Pyrimid catalog with affiliate_bps.',
      'Add a smoke test that unauthenticated requests return 402 and paid requests return the expected JSON schema.',
    ],
  };
}

async function payload(productId: string, req: NextRequest, proof: string) {
  const query = Object.fromEntries(req.nextUrl.searchParams.entries());

  switch (productId) {
    case 'mya-agent-enrichment': {
      const agent = query.agent || 'demo-agent';
      return {
        enrichment: {
          agent,
          category: 'developer-tools',
          agent_readable_summary: `${agent} can monetize API calls by exposing paid tools through x402 and listing them in the Pyrimid catalog.`,
          monetization_angle: 'Package one high-value tool as a paid MCP/API endpoint priced $0.05-$0.25 per call.',
          suggested_cta: 'Claim listing → add paid tool → route purchases through Pyrimid.',
        },
      };
    }
    case 'mya-category-scout': {
      const category = query.category || 'developer-tools';
      return {
        category,
        agents: [
          { name: 'MCP server vendors', fit: 'high', reason: 'Already expose tool interfaces; easiest path to paid tools.' },
          { name: 'AI API wrappers', fit: 'high', reason: 'Usage-based value maps cleanly to x402 per-call pricing.' },
          { name: 'agent directories', fit: 'medium', reason: 'Can route discovery traffic into paid vendor listings.' },
        ],
      };
    }
    case 'vendor-lead-discovery': {
      const segment = query.segment || 'mcp';
      return vendorLeadDiscovery(segment);
    }
    case 'mcp-server-audit': {
      const url = query.url || 'https://example.com/mcp';
      const inspection = await inspectMcpTarget(url);
      return {
        audit: {
          url,
          inspection: {
            fetch_status: inspection.fetch_status,
            http_status: 'http_status' in inspection ? inspection.http_status : null,
            content_type: 'content_type' in inspection ? inspection.content_type : null,
          },
          ...auditFromSample(url, inspection.sample),
        },
      };
    }
    case 'x402-integration-plan': {
      const service = query.service || 'agent-api';
      return {
        plan: {
          service,
          route_shape: 'GET /api/paid/{tool} returns 402 until X-PAYMENT or X-PAYMENT-TX is supplied',
          payment_network: 'Base USDC',
          pyrimid_metadata: ['vendorId', 'productId', 'affiliateBps', 'endpoint', 'output_schema'],
          launch_checklist: ['publish llms.txt', 'publish agents.txt', 'submit MCP server card', 'list product in Pyrimid catalog'],
        },
      };
    }
    default:
      return { result: 'unknown_seed_product' };
  }
}

export async function GET(req: NextRequest, context: { params: Promise<{ product: string }> }) {
  const { product: productId } = await context.params;
  const product = getSeedProduct(productId);

  if (!product) {
    return NextResponse.json(
      { error: 'not_found', message: 'Unknown Pyrimid seed product', catalog: 'https://pyrimid.ai/api/v1/catalog' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const proof = req.headers.get('x-payment-tx') || req.headers.get('x-payment');
  if (!proof) return paymentRequired(req, product);

  const verification = await verifyPyrimidPaymentTx(proof, product.price_usdc);
  if (!verification.valid) {
    return NextResponse.json(
      {
        error: 'payment_invalid',
        message: verification.reason || 'Payment could not be verified on Base',
        docs: 'https://pyrimid.ai/quickstart',
        proof: 'https://pyrimid.ai/proof',
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json({
    product_id: product.product_id,
    vendor_id: product.vendor_id,
    payment_tx: verification.txHash,
    payment_amount: verification.amount?.toString(),
    buyer: verification.buyer,
    ...(await payload(product.product_id, req, proof)),
    routed_by: 'pyrimid',
    links: {
      docs: 'https://pyrimid.ai/quickstart',
      proof: 'https://pyrimid.ai/proof',
      stats: 'https://pyrimid.ai/stats',
      catalog: 'https://pyrimid.ai/api/v1/catalog',
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
