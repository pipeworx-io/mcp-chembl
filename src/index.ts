interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * ChEMBL MCP — drug discovery database (EBI).
 *
 * Auth: none. Docs: https://chembl.gitbook.io/chembl-interface-documentation/web-services
 */


const BASE = 'https://www.ebi.ac.uk/chembl/api/data';
const UA = 'pipeworx-mcp-chembl/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'search',
    description: 'Full-text search the ChEMBL drug-discovery database for molecules, targets, assays, or documents; returns ChEMBL IDs and summary fields you can pass to `molecule`, `target`, or `activities`.',
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
    description: 'Mechanism of action records (filtered by molecule_chembl_id).',
    inputSchema: {
      type: 'object',
      properties: { chembl_id: { type: 'string', description: 'molecule_chembl_id' } },
      required: ['chembl_id'],
    },
  },
  {
    name: 'activities',
    description: 'Retrieve bioactivity records from ChEMBL filtered by molecule_chembl_id and/or target_chembl_id; returns IC50/Ki/EC50 values, assay descriptions, and units.',
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
    case 'activities': {
      const params = new URLSearchParams({
        format: 'json',
        limit: String(Math.min(1000, Math.max(1, (args.limit as number) ?? 25))),
      });
      if (args.molecule_chembl_id) params.set('molecule_chembl_id', String(args.molecule_chembl_id));
      if (args.target_chembl_id) params.set('target_chembl_id', String(args.target_chembl_id));
      return chemblGet(`/activity?${params}`);
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

async function chemblGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (res.status === 404) throw new Error('ChEMBL: not found');
  if (!res.ok) throw new Error(`ChEMBL: ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
  return res.json();
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  }
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
