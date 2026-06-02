# mcp-chembl

ChEMBL MCP — drug discovery database (EBI).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 673+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `search` | Search molecules / targets / assays / documents. |
| `molecule` | Full molecule record by ChEMBL ID (e.g. "CHEMBL25" = aspirin). |
| `target` | Target record by ChEMBL target ID. |
| `mechanism` | Mechanism of action records (filtered by molecule_chembl_id). |
| `activities` | Activity records — filter by molecule or target. |
| `drug_indications` | Drug indication records. |

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

Or connect to the full Pipeworx gateway for access to all 673+ data sources:

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
