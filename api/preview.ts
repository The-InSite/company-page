type VercelRequest = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => void;
  json: (body: unknown) => void;
  end: () => void;
};

type PreviewRequestPayload = {
  type: 'preview_request';
  requestId: string;
  url: string;
  hostname: string;
  email: string | null;
  name: string | null;
  source: 'company-page';
  submittedAt: string;
};

const previews = [
  'a-renovations',
  'adept-plumbing',
  'advanced-refinish',
  'aleksanders-same-day-framing',
  'alexandra-makeup-artistry',
  'amarios-art-academy-for-the-gifted-and-talented',
  'atx-construction-and-remodeling',
  'austin-bathroom-remodels',
  'austin-concrete-development-llc',
  'back-bay-life-coaching-and-counseling',
  'baker-masonry-llc',
  'ben-and-colleen-wedding-photographers',
  'best-coast-barber-co',
  'blue-sky-carpentry-llc',
  'bouquets-balloons',
  'cardinal-heating-air',
  'ell-bern-automotive',
  'enviro-air-water',
  'ep-electrical-services',
  'express-legal-services-llc',
  'fine-line-remodeling',
  'forever-roofing-and-remodeling',
  'go-solar-power',
  'heritage-handyman',
  'instant-auto-glass',
  'massachusetts-debt-relief-foundation-inc',
  'mhm-remodeling',
  'midtown-tire-inc',
  'one-reliable-insurance-agency',
  'oregon-aerial-photography',
  'portland-balloon-delivery',
  'renovatepros',
  'rs-contractor-services',
  'simon-kucher',
  'solar-energy-solutions-inc',
  'south-florida-caulking-and-waterproofing',
  'stellar-mortgage-corporation',
  'studio-790-interior-design',
  'sunshine-towing-inc',
  'suvalle-jodrey-process-servers',
  'taxes-by-ana',
  'unitech-laptop-repair-of-portland',
] as const;

const aliases: Record<string, string> = {
  austinbathroomremodels: 'austin-bathroom-remodels',
  bestcoastbarberco: 'best-coast-barber-co',
  oregonaerialphotography: 'oregon-aerial-photography',
  solarenergysolutionsinc: 'solar-energy-solutions-inc',
  stellarmortgagecorporation: 'stellar-mortgage-corporation',
  southfloridacaulkingandwaterproofing: 'south-florida-caulking-and-waterproofing',
};

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

function slugFromUrl(url: URL) {
  const host = url.hostname.replace(/^www\./, '');
  const withoutTld = host.split('.').slice(0, -1).join('-') || host;

  return withoutTld
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function compact(value: string) {
  return value.replace(/[^a-z0-9]/g, '');
}

function scorePreview(sourceSlug: string, previewSlug: string) {
  const sourceParts = new Set(sourceSlug.split('-').filter(Boolean));
  const previewParts = previewSlug.split('-').filter(Boolean);
  let score = 0;

  previewParts.forEach((part) => {
    if (sourceParts.has(part)) score += 2;
    if (sourceSlug.includes(part)) score += 1;
  });

  if (previewSlug.includes(sourceSlug) || sourceSlug.includes(previewSlug)) score += 8;
  return score;
}

function titleFromSlug(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function businessNameFromHostname(hostname: string) {
  return hostname
    .replace(/^www\./, '')
    .split('.')[0]
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function requestIdFor(url: URL) {
  let hash = 0;
  const seed = `${url.hostname}${url.pathname}${url.search}`;

  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }

  return `insite-${Math.abs(hash).toString(36)}`;
}

function findPreview(url: URL) {
  const sourceSlug = slugFromUrl(url);
  const sourceCompact = compact(sourceSlug);
  const exactAlias = aliases[sourceCompact];

  if (exactAlias) return exactAlias;
  if ((previews as readonly string[]).includes(sourceSlug)) return sourceSlug;

  const compactMatch = previews.find((preview) => compact(preview) === sourceCompact);
  if (compactMatch) return compactMatch;

  const best = previews
    .map((preview) => ({ preview, score: scorePreview(sourceSlug, preview) }))
    .sort((a, b) => b.score - a.score)[0];

  return best && best.score > 2 ? best.preview : null;
}

function mailtoFor(url: URL, requestId: string, email?: string, name?: string) {
  const subject = encodeURIComponent(`Preview request for ${url.hostname.replace(/^www\./, '')}`);
  const lines = [
    'Please generate a renovated InSite preview for this website:',
    '',
    url.href,
    '',
    `Request ID: ${requestId}`,
    email ? `Requester email: ${email}` : '',
    name ? `Requester name: ${name}` : '',
  ].filter(Boolean);

  return `mailto:sales@theinsite.dev?subject=${subject}&body=${encodeURIComponent(lines.join('\n'))}`;
}

function parseBody(req: VercelRequest) {
  return req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
}

function stringBodyValue(body: Record<string, unknown>, key: string) {
  return typeof body[key] === 'string' ? String(body[key]).trim() : '';
}

async function notifyWebhook(payload: PreviewRequestPayload) {
  const webhookUrl = process.env.PREVIEW_REQUEST_WEBHOOK_URL;
  if (!webhookUrl) return { configured: false, ok: false };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (process.env.PREVIEW_REQUEST_WEBHOOK_SECRET) {
    headers.Authorization = `Bearer ${process.env.PREVIEW_REQUEST_WEBHOOK_SECRET}`;
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  return { configured: true, ok: response.ok, status: response.status };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendPreviewRequestEmail(
  payload: PreviewRequestPayload,
  details: {
    leadId?: string | null;
    leadCreated?: boolean;
    crawlQueued?: boolean;
    generationQueued?: boolean;
  },
) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { configured: false, ok: false };

  let Resend: typeof import('resend').Resend;
  try {
    ({ Resend } = await import('resend'));
  } catch (error) {
    return {
      configured: true,
      ok: false,
      error: error instanceof Error ? error.message : 'Resend dependency is unavailable',
    };
  }

  const resend = new Resend(apiKey);
  const to = process.env.PREVIEW_REQUEST_NOTIFY_TO || 'zagalsky@gmail.com';
  const from = process.env.EMAIL_FROM || 'The InSite <hello@theinsite.dev>';
  const adminLeadUrl = details.leadId && process.env.ADMIN_BASE_URL
    ? `${process.env.ADMIN_BASE_URL.replace(/\/$/, '')}/leads/${details.leadId}`
    : null;

  const rows = [
    ['Website', payload.url],
    ['Hostname', payload.hostname],
    ['Requester email', payload.email || 'not provided'],
    ['Requester name', payload.name || 'not provided'],
    ['Request ID', payload.requestId],
    ['Lead ID', details.leadId || 'not created'],
    ['Lead created', details.leadCreated ? 'yes' : 'no'],
    ['Crawl queued', details.crawlQueued ? 'yes' : 'no'],
    ['Generation queued', details.generationQueued ? 'yes' : 'no'],
    ['Submitted at', payload.submittedAt],
  ];

  const htmlRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 12px;color:#64748b;border-bottom:1px solid #e2e8f0;width:160px;">${escapeHtml(label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(value)}</td>
    </tr>
  `).join('');

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: `New renovation preview request: ${payload.hostname}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:28px 20px;color:#0f172a;">
        <h1 style="font-size:22px;margin:0 0 16px;">New renovation preview request</h1>
        <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
          A visitor requested a website renovation preview from the company page.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e2e8f0;">
          ${htmlRows}
        </table>
        ${adminLeadUrl ? `<p style="margin-top:22px;"><a href="${escapeHtml(adminLeadUrl)}" style="color:#0f766e;">Open lead in admin</a></p>` : ''}
      </div>
    `,
  });

  if (error) {
    return { configured: true, ok: false, error: JSON.stringify(error) };
  }

  return { configured: true, ok: true, id: data?.id ?? null };
}

async function createLead(payload: PreviewRequestPayload) {
  if (!process.env.DATABASE_URL) {
    return { configured: false, ok: false };
  }

  let neon: typeof import('@neondatabase/serverless').neon;
  try {
    ({ neon } = await import('@neondatabase/serverless'));
  } catch (error) {
    return {
      configured: true,
      ok: false,
      error: error instanceof Error ? error.message : 'Database client dependency is unavailable',
    };
  }

  const sql = neon(process.env.DATABASE_URL);
  const businessName = payload.name || businessNameFromHostname(payload.hostname);
  const notes = [
    'Public preview request from company-page.',
    `Request ID: ${payload.requestId}`,
    `Requester email: ${payload.email || 'not provided'}`,
    `Submitted at: ${payload.submittedAt}`,
  ].join('\n');

  const rows = await sql`
    INSERT INTO leads (
      business_name,
      email,
      website_url,
      category,
      priority,
      status,
      notes
    )
    VALUES (
      ${businessName},
      ${payload.email || null},
      ${payload.url},
      ${'Preview Request'},
      ${10},
      ${'scraped'},
      ${notes}
    )
    RETURNING id, business_name, website_url
  `;

  const lead = rows[0] as { id: string; business_name: string; website_url: string };

  return {
    configured: true,
    ok: true,
    leadId: String(lead.id),
    businessName: lead.business_name,
    websiteUrl: lead.website_url,
  };
}

async function dispatchWorkflow(repo: string, workflow: string, ref: string, inputs: Record<string, string>) {
  const pat = process.env.GH_PAT;
  if (!pat) {
    return {
      configured: false,
      ok: false,
      status: null,
      workflowUrl: `https://github.com/${repo}/actions/workflows/${workflow}`,
      error: 'GH_PAT is not configured',
    };
  }

  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref, inputs }),
    },
  );

  return {
    configured: true,
    ok: response.ok || response.status === 204,
    status: response.status,
    workflowUrl: `https://github.com/${repo}/actions/workflows/${workflow}`,
    error: response.ok || response.status === 204 ? null : await response.text(),
  };
}

async function triggerPreviewPipeline(leadId: string) {
  const crawl = await dispatchWorkflow(
    'The-InSite/leads-scraping-service',
    'crawl-lead.yml',
    'master',
    { lead_id: leadId },
  );

  const shouldGenerateImmediately = process.env.PREVIEW_AUTO_GENERATE === 'true';
  const generation = shouldGenerateImmediately
    ? await Promise.all([
      dispatchWorkflow(
        'The-InSite/HTML-templates-production',
        'generate-lead-site.yml',
        'main',
        { lead_id: leadId, mode: process.env.PREVIEW_GENERATION_MODE || 'template' },
      ),
      dispatchWorkflow(
        'The-InSite/ssp-website-generator',
        'generate-ssp-concepts.yml',
        'main',
        { lead_id: leadId },
      ),
    ])
    : null;

  return { crawl, generation };
}

function previewResponse(url: URL) {
  const slug = findPreview(url);
  const hostname = url.hostname.replace(/^www\./, '');

  if (slug) {
    const path = `/new/${slug}`;

    return {
      status: 'ready',
      inputUrl: url.href,
      hostname,
      slug,
      title: titleFromSlug(slug),
      path,
    };
  }

  const requestId = requestIdFor(url);

  return {
    status: 'new_site',
    inputUrl: url.href,
    hostname,
    requestId,
    title: hostname,
    message: 'This site is not in the published preview library yet.',
    requestUrl: mailtoFor(url, requestId),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');

  if (req.method === 'POST') {
    const body = parseBody(req);
    const rawUrl = stringBodyValue(body, 'url');
    const email = stringBodyValue(body, 'email');
    const name = stringBodyValue(body, 'name');
    const url = normalizeUrl(rawUrl);

    if (!url) {
      res.status(400).json({ error: 'Enter a valid website URL' });
      return;
    }

    const preview = previewResponse(url);
    if (preview.status === 'ready') {
      res.status(200).json(preview);
      return;
    }

    const payload: PreviewRequestPayload = {
      type: 'preview_request',
      requestId: preview.requestId,
      url: url.href,
      hostname: preview.hostname,
      email: email || null,
      name: name || null,
      source: 'company-page',
      submittedAt: new Date().toISOString(),
    };

    try {
      const lead = await createLead(payload);
      const pipeline = lead.ok && lead.leadId
        ? await triggerPreviewPipeline(lead.leadId)
        : null;
      const webhook = await notifyWebhook(payload);
      const queued = Boolean(lead.ok || webhook.ok);
      const generationQueued = Array.isArray(pipeline?.generation)
        ? pipeline.generation.some((item) => item.ok)
        : false;
      const email = await sendPreviewRequestEmail(payload, {
        leadId: lead.leadId ?? null,
        leadCreated: lead.ok,
        crawlQueued: pipeline?.crawl.ok ?? false,
        generationQueued,
      });

      res.status(202).json({
        ...preview,
        status: queued ? 'submitted' : 'new_site',
        queued,
        leadId: lead.leadId ?? null,
        leadCreated: lead.ok,
        leadError: lead.error ?? null,
        databaseConfigured: lead.configured,
        crawlConfigured: pipeline?.crawl.configured ?? false,
        crawlQueued: pipeline?.crawl.ok ?? false,
        crawlStatus: pipeline?.crawl.status ?? null,
        crawlError: pipeline?.crawl.error ?? null,
        crawlWorkflowUrl: pipeline?.crawl.workflowUrl ?? null,
        generationQueued,
        generationDeferred: process.env.PREVIEW_AUTO_GENERATE !== 'true',
        notificationConfigured: email.configured,
        notificationSent: email.ok,
        notificationError: email.error ?? null,
        webhookConfigured: webhook.configured,
        webhookStatus: webhook.status ?? null,
        requestUrl: mailtoFor(url, preview.requestId, email, name),
      });
    } catch (error) {
      res.status(202).json({
        ...preview,
        status: 'new_site',
        queued: false,
        leadCreated: false,
        leadError: error instanceof Error ? error.message : 'Preview pipeline failed',
        webhookConfigured: false,
        webhookError: null,
        requestUrl: mailtoFor(url, preview.requestId, email, name),
      });
    }
    return;
  }

  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rawUrl = firstQueryValue(req.query.url);

  if (!rawUrl) {
    res.status(400).json({ error: 'Missing url query parameter' });
    return;
  }

  const url = normalizeUrl(rawUrl);

  if (!url) {
    res.status(400).json({ error: 'Enter a valid website URL' });
    return;
  }

  res.status(200).json(previewResponse(url));
}
