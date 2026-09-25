interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    // Fleet #2382. Everything that isn't a timeout/abort here is a genuine
    // NETWORK-LEVEL failure — DNS resolution, connection refused, TLS handshake,
    // Cloudflare's own "Network connection lost." — meaning `fetch()` itself
    // threw and no HTTP response of any kind was ever received. Until this fix
    // that raw exception was rethrown VERBATIM: a bare `TypeError: fetch failed`
    // (or the Workers-runtime equivalent) names no upstream, carries no class
    // token, and reads exactly like a defect in OUR code — because it says
    // nothing about the call at all. It landed in `error`, the tier that means
    // "Pipeworx has a defect", for every one of the (at the time of writing)
    // ~470 packs that call this helper directly with no wrapper of their own.
    //
    // `dexscreener` hit this independently (fleet #1579) and fixed it with a
    // bespoke per-pack try/catch around `fetchWithTimeout`. That fix is correct
    // but only covers one pack; every other caller of this shared helper still
    // leaked the raw exception. Moving the same fix HERE — the one place that
    // already carries the timeout case — covers every pack that uses
    // `fetchWithTimeout` without a wrapper, for free, and without widening
    // `classifyToolError`'s regex list: the fix is giving the message a proper
    // `upstream_down:` token at the point the two facts (no response was ever
    // received, and which host we were trying to reach) are actually in hand,
    // not teaching the classifier to guess from prose after the fact.
    //
    // Safe on the same grounds as the timeout branch above: no argument a
    // caller passes can make `fetch()` itself throw a connection-level error,
    // so this is always an availability failure, never a caller mistake. Same
    // `markInternalOrigin` treatment — an origin we run that never answered is
    // still ours, not a third party's outage.
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(
      markInternalOrigin(
        `upstream_down: could not reach ${name} at all (${raw.slice(0, 160)}). ` +
          `No request reached ${name}, so this says NOTHING about whether the arguments you passed ` +
          'are valid — do not re-check them on the strength of this error. Retry shortly.',
        url,
      ),
    );
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * ChEMBL MCP — drug discovery database (EBI).
 *
 * Auth: none. Docs: https://chembl.gitbook.io/chembl-interface-documentation/web-services
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'ChEMBL');
}

const BASE = 'https://www.ebi.ac.uk/chembl/api/data';
const UA = 'pipeworx-mcp-chembl/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'search',
    description: 'Full-text search the ChEMBL drug-discovery database for molecules, targets, assays, or documents; returns ChEMBL IDs and summary fields you can pass to `molecule`, `target`, or `activities`. Pair with `chembl_mechanism`, which takes a drug name directly and returns its mechanism of action and target.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text query.' },
        type: { type: 'string', description: 'molecule (default) | target | assay | document' },
        limit: { type: 'number', description: '1-1000 (default 25).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'molecule',
    description: 'Full molecule record by ChEMBL ID (e.g. "CHEMBL25" = aspirin).',
    inputSchema: {
      type: 'object',
      properties: { chembl_id: { type: 'string' } },
      required: ['chembl_id'],
    },
  },
  {
    name: 'target',
    description: 'Target record by ChEMBL target ID.',
    inputSchema: {
      type: 'object',
      properties: { chembl_id: { type: 'string' } },
      required: ['chembl_id'],
    },
  },
  {
    name: 'mechanism',
    description: 'Raw ChEMBL mechanism records for one exact molecule ChEMBL ID (e.g. "CHEMBL1703"), returned verbatim from the API. Use when you already hold the precise molecule ID and want the unshaped rows; to start from a drug name, call `chembl_mechanism`.',
    inputSchema: {
      type: 'object',
      properties: { chembl_id: { type: 'string', description: 'molecule_chembl_id' } },
      required: ['chembl_id'],
    },
  },
  {
    name: 'chembl_mechanism',
    description:
      'Mechanism of action of a drug, from its NAME (or a ChEMBL molecule ID). Answers "how does metformin work", "what is the mechanism of action of X", "what does X inhibit", "what target does X act on", "X mode of action", "is X an agonist or an antagonist", "X molecular target". Resolves the drug name to every matching ChEMBL molecule form — the base compound together with its salts, hydrochlorides, mesylates and branded formulations — and searches all of them at once, so a drug whose pharmacology is curated on the salt form still resolves. Returns, per mechanism: action_type (INHIBITOR, AGONIST, ANTAGONIST, BLOCKER, MODULATOR, ...), the mechanism_of_action sentence (e.g. "Mitochondrial complex I (NADH dehydrogenase) inhibitor"), the molecular target with its ChEMBL target ID, target name and organism, the exact molecule form the mechanism is recorded on with its preferred name, max clinical phase, curator mechanism/selectivity comments, and PubMed references. Also lists every molecule ID searched, so an empty result is interpretable. Curated pharmacology from ChEMBL (EMBL-EBI). Reach for this for pharmacology, mode of action, drug-target identification, and any "how does this drug work" question.',
    inputSchema: {
      type: 'object',
      properties: {
        drug: { type: 'string', description: 'Drug name, e.g. "metformin", "imatinib", "aspirin". Brand, generic, or salt names all work.' },
        query: { type: 'string', description: 'Alias for drug.' },
        q: { type: 'string', description: 'Alias for drug.' },
        name: { type: 'string', description: 'Alias for drug.' },
        molecule_chembl_id: { type: 'string', description: 'Exact ChEMBL molecule ID instead of a name, e.g. "CHEMBL1431". Salt forms of this molecule are included automatically.' },
        chembl_id: { type: 'string', description: 'Alias for molecule_chembl_id.' },
        candidates: { type: 'number', description: 'How many name-matched molecule forms to search across, 1-25 (default 10). Higher catches obscure salt forms.' },
        limit: { type: 'number', description: 'Max mechanisms returned, 1-200 (default 50).' },
      },
    },
  },
  {
    name: 'activities',
    description: 'Retrieve bioactivity records from ChEMBL filtered by molecule_chembl_id and/or target_chembl_id; returns IC50/Ki/EC50 values, assay descriptions, and units. This is SMALL-MOLECULE assay data: a biologic such as an antibody has none by construction, and the response says so rather than returning a bare empty list.',
    inputSchema: {
      type: 'object',
      properties: {
        molecule_chembl_id: { type: 'string' },
        target_chembl_id: { type: 'string' },
        limit: { type: 'number', description: '1-1000 (default 25).' },
      },
    },
  },
  {
    name: 'drug_indications',
    description: 'Retrieve approved drug indication records from ChEMBL filtered by molecule_chembl_id and/or MeSH disease ID; returns disease names, efo_id cross-references, and max clinical trial phase.',
    inputSchema: {
      type: 'object',
      properties: {
        molecule_chembl_id: { type: 'string' },
        mesh_id: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
];

/** Modality decides whether an empty activity table is a gap or the right answer. */
async function moleculeType(chemblId: string): Promise<string | null> {
  try {
    const data = await chemblGet(`/molecule/${encodeURIComponent(chemblId)}?format=json`) as Record<string, unknown> | null;
    const type = data?.molecule_type;
    return typeof type === 'string' ? type : null;
  } catch {
    return null;
  }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search': {
      const type = String(args.type ?? 'molecule');
      if (!['molecule', 'target', 'assay', 'document'].includes(type)) {
        throw new Error('type must be molecule | target | assay | document.');
      }
      const params = new URLSearchParams({
        q: reqStr(args, 'query', '"aspirin"'),
        format: 'json',
        limit: String(Math.min(1000, Math.max(1, (args.limit as number) ?? 25))),
      });
      return chemblGet(`/${type}/search?${params}`);
    }
    case 'molecule':
      return chemblGet(`/molecule/${encodeURIComponent(reqStr(args, 'chembl_id', '"CHEMBL25"'))}.json`);
    case 'target':
      return chemblGet(`/target/${encodeURIComponent(reqStr(args, 'chembl_id', '"CHEMBL204"'))}.json`);
    case 'mechanism': {
      const params = new URLSearchParams({
        molecule_chembl_id: reqStr(args, 'chembl_id', '"CHEMBL25"'),
        format: 'json',
      });
      return chemblGet(`/mechanism?${params}`);
    }
    case 'chembl_mechanism':
      return mechanismByName(args);
    case 'activities': {
      const params = new URLSearchParams({
        format: 'json',
        limit: String(Math.min(1000, Math.max(1, (args.limit as number) ?? 25))),
      });
      const molecule = args.molecule_chembl_id ? String(args.molecule_chembl_id) : '';
      if (molecule) params.set('molecule_chembl_id', molecule);
      if (args.target_chembl_id) params.set('target_chembl_id', String(args.target_chembl_id));
      const payload = await chemblGet(`/activity?${params}`) as Record<string, unknown>;

      // An empty bioactivity table for a BIOLOGIC is the correct answer, not a
      // failure: ChEMBL's activity data is small-molecule assay data, so
      // pembrolizumab has 0 while aspirin has 4,087. Returning a bare empty list
      // makes a right answer look like a broken tool, and invites a retry that
      // cannot succeed.
      const empty = !((payload.activities as unknown[] | undefined)?.length);
      if (empty && molecule) {
        const modality = await moleculeType(molecule);
        if (modality && !/small molecule/i.test(modality)) {
          return {
            ...payload,
            found: false,
            reason: 'no_bioactivity_for_modality',
            molecule_type: modality,
            hint: `${molecule} is ${/^[aeiou]/i.test(modality) ? 'an' : 'a'} ${modality.toLowerCase()}, and ChEMBL's activity table holds small-molecule assay results (IC50/Ki/EC50), so it has none by construction rather than by omission. For a biologic, the mechanism and its target are the useful record — try mechanism or drug_indications, and Guide to PHARMACOLOGY for curated target interactions.`,
          };
        }
        return {
          ...payload,
          found: false,
          reason: 'no_activities_recorded',
          ...(modality ? { molecule_type: modality } : {}),
          hint: `ChEMBL records no bioactivity for ${molecule}. Confirm the ChEMBL id with search — an id for the wrong salt or parent form is the usual cause of an unexpected empty table.`,
        };
      }
      return payload;
    }
    case 'drug_indications': {
      const params = new URLSearchParams({
        format: 'json',
        limit: String(Math.min(1000, Math.max(1, (args.limit as number) ?? 25))),
      });
      if (args.molecule_chembl_id) params.set('molecule_chembl_id', String(args.molecule_chembl_id));
      if (args.mesh_id) params.set('mesh_id', String(args.mesh_id));
      return chemblGet(`/drug_indication?${params}`);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Mechanism of action starting from a drug NAME.
 *
 * The trap this exists to defuse: ChEMBL curates pharmacology on whichever
 * molecule record the source paper described, which is very often the SALT,
 * not the base. "metformin" best-matches CHEMBL1431 (METFORMIN), which has
 * ZERO mechanisms — both of its mechanisms hang off CHEMBL1703 (METFORMIN
 * HYDROCHLORIDE). Imatinib is the same story. So a name -> top-hit ->
 * /mechanism lookup would confidently report "no known mechanism" for some of
 * the most-prescribed drugs on earth. We therefore search the mechanism
 * resource across EVERY molecule the name matched (molecule_chembl_id__in)
 * AND across anything whose parent is one of them
 * (parent_molecule_chembl_id__in), then de-duplicate on mec_id.
 */
async function mechanismByName(args: Record<string, unknown>): Promise<unknown> {
  const directId = firstStr(args, ['molecule_chembl_id', 'chembl_id']);
  const nameIn = firstStr(args, ['drug', 'query', 'q', 'name', 'drug_name']);
  if (!directId && !nameIn) {
    throw new Error('Pass a drug name like {"drug":"metformin"} or a molecule ID like {"molecule_chembl_id":"CHEMBL1431"}.');
  }
  const maxCandidates = clampInt(args.candidates, 10, 1, 25);
  const maxMechanisms = clampInt(args.limit, 50, 1, 200);

  // 1. Resolve the query to candidate molecule forms, best match first.
  const prefNames = new Map<string, string | null>();
  let candidateIds: string[];
  if (directId) {
    candidateIds = [directId.trim().toUpperCase()];
    for (const m of await lookupNames('/molecule', 'molecule_chembl_id', candidateIds)) prefNames.set(m.id, m.pref_name);
  } else {
    const params = new URLSearchParams({ q: nameIn!, format: 'json', limit: String(maxCandidates) });
    const search = (await chemblGet(`/molecule/search?${params}`)) as { molecules?: MoleculeHit[] };
    const hits = search.molecules ?? [];
    for (const m of hits) if (m.molecule_chembl_id) prefNames.set(m.molecule_chembl_id, m.pref_name ?? null);
    candidateIds = hits.map((m) => m.molecule_chembl_id).filter(Boolean);
    if (candidateIds.length === 0) {
      return {
        found: false,
        reason: 'drug_not_found',
        query: nameIn,
        hint: `ChEMBL's molecule search returned no compound matching "${nameIn}". Check the spelling, or try the generic (INN) name rather than a brand name — e.g. "metformin" rather than "Glucophage".`,
        source: 'https://www.ebi.ac.uk/chembl/',
      };
    }
  }

  // 2. One mechanism query per filter axis, across all candidates at once.
  const idList = candidateIds.join(',');
  const [byMolecule, byParent] = await Promise.all([
    chemblGet(`/mechanism?${new URLSearchParams({ molecule_chembl_id__in: idList, format: 'json', limit: '200' })}`) as Promise<MechanismPage>,
    chemblGet(`/mechanism?${new URLSearchParams({ parent_molecule_chembl_id__in: idList, format: 'json', limit: '200' })}`) as Promise<MechanismPage>,
  ]);

  const byMecId = new Map<string, MechanismRow>();
  for (const row of [...(byMolecule.mechanisms ?? []), ...(byParent.mechanisms ?? [])]) {
    byMecId.set(String(row.mec_id ?? `${row.molecule_chembl_id}|${row.mechanism_of_action}|${row.target_chembl_id}`), row);
  }
  const rows = [...byMecId.values()];

  // Order by how well the molecule the mechanism sits on matched the query.
  const rank = new Map(candidateIds.map((id, i) => [id, i]));
  rows.sort((a, b) => (rank.get(a.molecule_chembl_id ?? '') ?? 99) - (rank.get(b.molecule_chembl_id ?? '') ?? 99));
  const kept = rows.slice(0, maxMechanisms);

  const searchedMolecules = () => candidateIds.map((id) => ({ molecule_chembl_id: id, pref_name: prefNames.get(id) ?? null }));

  if (kept.length === 0) {
    return {
      found: false,
      reason: 'no_mechanism_recorded',
      query: nameIn ?? directId,
      molecules_searched: searchedMolecules(),
      hint: `ChEMBL has no curated mechanism-of-action record on any of the ${candidateIds.length} molecule form(s) searched (${candidateIds.join(', ')}). The compound exists in ChEMBL but its pharmacology is uncurated — this is common for research compounds, unapproved candidates, and biologics. Try \`activities\` for measured target binding (IC50/Ki/EC50), or \`drug_indications\` for approved uses.`,
      source: `${BASE}/mechanism.json?molecule_chembl_id__in=${idList}`,
    };
  }

  // 3. Fill in names for molecules and targets referenced by the results.
  const needMolecule = unique(
    kept.flatMap((r) => [r.molecule_chembl_id, r.parent_molecule_chembl_id]).filter((id): id is string => !!id && !prefNames.has(id)),
  );
  const targetIds = unique(kept.map((r) => r.target_chembl_id).filter((id): id is string => !!id));
  const [extraMolecules, targets] = await Promise.all([
    needMolecule.length ? lookupNames('/molecule', 'molecule_chembl_id', needMolecule) : Promise.resolve([]),
    targetIds.length ? lookupNames('/target', 'target_chembl_id', targetIds) : Promise.resolve([]),
  ]);
  for (const m of extraMolecules) prefNames.set(m.id, m.pref_name);
  const targetInfo = new Map(targets.map((t) => [t.id, t]));

  const mechanisms = kept.map((r) => {
    const target = r.target_chembl_id ? targetInfo.get(r.target_chembl_id) : undefined;
    return {
      action_type: r.action_type ?? null,
      mechanism_of_action: r.mechanism_of_action ?? null,
      target_chembl_id: r.target_chembl_id ?? null,
      target_name: target?.pref_name ?? null,
      target_organism: target?.organism ?? null,
      // The form the mechanism is actually curated on — often the salt, not
      // the base. Surfacing it explains any ID mismatch to the caller.
      recorded_on_molecule_chembl_id: r.molecule_chembl_id ?? null,
      recorded_on_pref_name: r.molecule_chembl_id ? prefNames.get(r.molecule_chembl_id) ?? null : null,
      parent_molecule_chembl_id: r.parent_molecule_chembl_id ?? null,
      parent_pref_name: r.parent_molecule_chembl_id ? prefNames.get(r.parent_molecule_chembl_id) ?? null : null,
      max_phase: r.max_phase ?? null,
      direct_interaction: r.direct_interaction === 1 ? true : r.direct_interaction === 0 ? false : null,
      mechanism_comment: r.mechanism_comment ?? null,
      selectivity_comment: r.selectivity_comment ?? null,
      binding_site_comment: r.binding_site_comment ?? null,
      references: (r.mechanism_refs ?? []).slice(0, 5).map((ref) => ({ type: ref.ref_type, id: ref.ref_id, url: ref.ref_url })),
    };
  });

  // Did the mechanisms come from a different molecule form than the one the
  // query pointed at? Saying so explains the ID mismatch instead of hiding it.
  const best = candidateIds[0];
  const carriers = unique(kept.map((r) => r.molecule_chembl_id).filter((id): id is string => !!id));
  const asked = directId ? 'the molecule you asked for' : 'the closest name match';
  const saltFormNote = carriers.includes(best)
    ? undefined
    : `Mechanisms are curated on ${carriers
        .map((id) => `${prefNames.get(id) ?? id} (${id})`)
        .join(', ')}, a different molecule form than ${asked}, ${prefNames.get(best) ?? best} (${best}). ChEMBL records pharmacology on whichever form the source literature described, commonly the salt; these mechanisms apply to the drug.`;

  return {
    found: true,
    query: nameIn ?? directId,
    mechanism_count: mechanisms.length,
    molecules_searched: searchedMolecules(),
    mechanisms,
    ...(saltFormNote ? { salt_form_note: saltFormNote } : {}),
    source: `${BASE}/mechanism.json?molecule_chembl_id__in=${idList}`,
  };
}

/** Batched id -> name lookup using ChEMBL's `only=` field projection. */
async function lookupNames(
  resource: '/molecule' | '/target',
  idField: 'molecule_chembl_id' | 'target_chembl_id',
  ids: string[],
): Promise<Array<{ id: string; pref_name: string | null; organism?: string | null }>> {
  const only = resource === '/target' ? `${idField},pref_name,organism` : `${idField},pref_name`;
  const params = new URLSearchParams({ [`${idField}__in`]: ids.join(','), format: 'json', limit: String(Math.max(ids.length, 1)), only });
  try {
    const page = (await chemblGet(`${resource}?${params}`)) as { molecules?: NamedRecord[]; targets?: NamedRecord[] };
    const records = page.molecules ?? page.targets ?? [];
    return records.map((r) => ({ id: String(r[idField] ?? ''), pref_name: r.pref_name ?? null, organism: r.organism ?? null }));
  } catch {
    return []; // Names are a nicety; a failed lookup must not sink the mechanisms.
  }
}

interface MoleculeHit {
  molecule_chembl_id: string;
  pref_name?: string | null;
}

interface NamedRecord {
  molecule_chembl_id?: string;
  target_chembl_id?: string;
  pref_name?: string | null;
  organism?: string | null;
}

interface MechanismRow {
  mec_id?: number;
  action_type?: string | null;
  mechanism_of_action?: string | null;
  molecule_chembl_id?: string | null;
  parent_molecule_chembl_id?: string | null;
  target_chembl_id?: string | null;
  max_phase?: number | null;
  direct_interaction?: number | null;
  mechanism_comment?: string | null;
  selectivity_comment?: string | null;
  binding_site_comment?: string | null;
  mechanism_refs?: Array<{ ref_type?: string; ref_id?: string; ref_url?: string }>;
}

interface MechanismPage {
  mechanisms?: MechanismRow[];
  page_meta?: { total_count?: number };
}

function firstStr(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

async function chemblGet(path: string): Promise<unknown> {
  const res = await pwFetch(`${BASE}${path}`, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (res.status === 404) throw new Error('ChEMBL: not found');
  // ChEMBL's 500 is an EBI HTML error page; the raw slice used to reach the
  // caller as `<!doctype html><html lang="en" class="vf-no-js"…` (fleet #712).
  if (!res.ok) throw await httpError(res, 'ChEMBL');
  return parseJson(res, 'ChEMBL');
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  }
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
