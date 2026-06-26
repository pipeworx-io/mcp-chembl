# mcp-chembl

ChEMBL MCP — drug discovery database (EBI).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 965+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `search` | Full-text search the ChEMBL drug-discovery database for molecules, targets, assays, or documents; returns ChEMBL IDs and summary fields you can pass to `molecule`, `target`, or `activities`. |
| `molecule` | Full molecule record by ChEMBL ID (e.g. "CHEMBL25" = aspirin). |
| `target` | Target record by ChEMBL target ID. |
| `mechanism` | Mechanism of action records (filtered by molecule_chembl_id). |
| `activities` | Retrieve bioactivity records from ChEMBL filtered by molecule_chembl_id and/or target_chembl_id; returns IC50/Ki/EC50 values, assay descriptions, and units. |
| `drug_indications` | Retrieve approved drug indication records from ChEMBL filtered by molecule_chembl_id and/or MeSH disease ID; returns disease names, efo_id cross-references, and max clinical trial phase. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "chembl": {
      "url": "https://gateway.pipeworx.io/chembl/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 965+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Chembl data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [All tools and guides](https://github.com/pipeworx-io/examples)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
