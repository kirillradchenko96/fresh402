"""CrewAI 1.15.41 / Python3.13: MCP connectivity, no inference or payment authority."""
import asyncio
import os
import json
os.environ.setdefault("OTEL_SDK_DISABLED", "true")
os.environ.setdefault("CREWAI_TELEMETRY_ENABLED", "false")
os.environ.setdefault("CREWAI_SDK_OTEL_ENABLED", "false")
from crewai.mcp.client import MCPClient
from crewai.mcp.transports.http import HTTPTransport

async def main():
    async with MCPClient(
        HTTPTransport(url="https://api.fresh402.com/mcp", streamable=True),
        connect_timeout=20, discovery_timeout=20, execution_timeout=20,
        max_retries=1,  # This release counts total attempts, so1 means no retry.
    ) as client:
        tools = await client.list_tools()
        print([tool["name"] for tool in tools])
        # Ordinary unpaid call: no API key, signer, model or payment interceptor.
        result = await client.call_tool_result("fresh402_extract", {"url": "https://example.com/"})
        if result.is_error:
            print("Unpaid challenge or tool error; inspect content before any separately authorized execution.")
        print(result)
        if os.environ.get("FRESH402_ADVANCED_EXAMPLE") == "1":
            # Same fixed, unsigned scenarios. No inference or automatic payment.
            old = {"openapi": "3.1.0", "info": {"title": "CI fixture", "version": "1"}, "paths": {"/items": {"get": {"responses": {"200": {"description": "OK"}}}}}}
            scenarios = [("fresh402_extract", {"url": "https://example.com/catalog.json", "records": {"source": "json", "pointer": "/items", "fields": [{"name": "id", "pointer": "/id", "type": "string"}], "limit": 10}}), ("fresh402_api_compatibility_review", {"contracts": {"before": json.dumps(old), "after": json.dumps(dict(old, paths={}))}})]
            for name, args in scenarios:
                print(name, await client.call_tool_result(name, args))
        if os.environ.get("FRESH402_REGISTER_EXAMPLE") == "1":
            print(await client.call_tool_result("fresh402_register", {"url": "https://example.com/"}))

if __name__ == "__main__":
    asyncio.run(main())
