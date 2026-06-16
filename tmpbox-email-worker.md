# tmpbox-email-worker

Cloudflare Worker for handling temporary email service for tmpbox project.

## Deployment Info

- **Worker Name:** `tmpbox-email-worker`
- **Worker URL:** `https://tmpbox-email-worker.helele.workers.dev`
- **Deployed:** April 30, 2026
- **Version ID:** `a6435429-3f9f-4d86-859b-e0ea099a236e`
- **Author:** mansurozdemir41@gmail.com
- **Compatibility Date:** 2024-01-01
- **Domain:** `tmpbox.space` (Catch-All routing enabled)

## Handlers

### 1. Email Handler
Catches incoming emails via Cloudflare Email Routing and stores them in KV with unique message IDs.

### 2. Fetch Handler
HTTP API for accessing stored emails with CORS support.

## Bindings

### KV Namespace: EMAILS
- **ID:** `e381e7c0911f4e6fb0b5f314c1a41846`
- **Purpose:** Store incoming emails with metadata
- **TTL:** 24 hours (86400 seconds)

## Architecture

```
Incoming Email → Cloudflare Email Routing (tmpbox.space) → email() handler
                                                              ↓
                                                    Generate UUID for message
                                                              ↓
                                                         Store in KV
                                                              ↓
                                    Key: email:user@tmpbox.space:UUID
                                    Value: { id, to, from, subject, raw, timestamp }
                                                              ↓
                                    Key: list:user@tmpbox.space
                                    Value: [UUID1, UUID2, ...]

HTTP Request → fetch() handler → Read from KV → Return JSON (with CORS)
```

## Worker Code Structure

The worker uses a UUID-based key system to support multiple emails per address:

```javascript
export default {
  async email(message, env, ctx) {
    const messageId = crypto.randomUUID();
    const to = message.to;
    const from = message.from;
    const subject = message.headers.get("subject") || "";
    
    // Read raw email stream
    const reader = message.raw.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const rawEmail = new TextDecoder().decode(
      new Uint8Array(chunks.reduce((acc, chunk) => [...acc, ...chunk], []))
    );
    
    // Store email with UUID key
    const emailData = {
      id: messageId,
      to,
      from,
      subject,
      raw: rawEmail,
      timestamp: Date.now()
    };
    
    const key = `email:${to}:${messageId}`;
    await env.EMAILS.put(key, JSON.stringify(emailData), {
      expirationTtl: 86400 // 24 hours
    });
    
    // Update message list for this address
    const listKey = `list:${to}`;
    const existingList = await env.EMAILS.get(listKey, "json") || [];
    existingList.push(messageId);
    await env.EMAILS.put(listKey, JSON.stringify(existingList), {
      expirationTtl: 86400
    });
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };
    
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    
    // GET /api/emails/{address} - List all emails
    if (path.startsWith("/api/emails/") && request.method === "GET") {
      const address = path.split("/")[3];
      if (!address) {
        return new Response(JSON.stringify({ error: "Address required" }), {
          status: 400,
          headers: corsHeaders
        });
      }
      
      const listKey = `list:${address}`;
      const messageIds = await env.EMAILS.get(listKey, "json") || [];
      const emails = [];
      
      for (const msgId of messageIds) {
        const key = `email:${address}:${msgId}`;
        const emailData = await env.EMAILS.get(key, "json");
        if (emailData) {
          emails.push(emailData);
        }
      }
      
      return new Response(JSON.stringify({ emails }), {
        headers: corsHeaders
      });
    }
    
    // GET /api/email/{address}/latest - Get latest email
    if (path.startsWith("/api/email/") && path.endsWith("/latest") && request.method === "GET") {
      const address = path.split("/")[3];
      if (!address) {
        return new Response(JSON.stringify({ error: "Address required" }), {
          status: 400,
          headers: corsHeaders
        });
      }
      
      const listKey = `list:${address}`;
      const messageIds = await env.EMAILS.get(listKey, "json") || [];
      
      if (messageIds.length === 0) {
        return new Response(JSON.stringify({ email: null }), {
          headers: corsHeaders
        });
      }
      
      const latestId = messageIds[messageIds.length - 1];
      const key = `email:${address}:${latestId}`;
      const emailData = await env.EMAILS.get(key, "json");
      
      return new Response(JSON.stringify({ email: emailData }), {
        headers: corsHeaders
      });
    }
    
    // DELETE /api/emails/{address} - Delete all emails for address
    if (path.startsWith("/api/emails/") && request.method === "DELETE") {
      const address = path.split("/")[3];
      if (!address) {
        return new Response(JSON.stringify({ error: "Address required" }), {
          status: 400,
          headers: corsHeaders
        });
      }
      
      const listKey = `list:${address}`;
      const messageIds = await env.EMAILS.get(listKey, "json") || [];
      
      for (const msgId of messageIds) {
        const key = `email:${address}:${msgId}`;
        await env.EMAILS.delete(key);
      }
      await env.EMAILS.delete(listKey);
      
      return new Response(JSON.stringify({ success: true }), {
        headers: corsHeaders
      });
    }
    
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: corsHeaders
    });
  }
};
```

## API Endpoints

### GET /api/emails/{address}
Returns all stored emails for the given address.

**Example:**
```bash
curl "https://tmpbox-email-worker.helele.workers.dev/api/emails/a@tmpbox.space"
```

**Response:**
```json
{
  "emails": [
    {
      "id": "cdd10407-db75-4233-82e3-68d6b089a01a",
      "to": "a@tmpbox.space",
      "from": "sender@example.com",
      "subject": "Test Email",
      "raw": "Full raw email content...",
      "timestamp": 1778516147121
    }
  ]
}
```

### GET /api/email/{address}/latest
Returns the most recent email for the given address.

**Example:**
```bash
curl "https://tmpbox-email-worker.helele.workers.dev/api/email/a@tmpbox.space/latest"
```

**Response:**
```json
{
  "email": {
    "id": "cdd10407-db75-4233-82e3-68d6b089a01a",
    "to": "a@tmpbox.space",
    "from": "sender@example.com",
    "subject": "Test Email",
    "raw": "Full raw email content...",
    "timestamp": 1778516147121
  }
}
```

### DELETE /api/emails/{address}
Deletes all emails for the given address.

**Example:**
```bash
curl -X DELETE "https://tmpbox-email-worker.helele.workers.dev/api/emails/a@tmpbox.space"
```

**Response:**
```json
{
  "success": true
}
```

### OPTIONS (All endpoints)
CORS preflight support enabled for all endpoints.

## Related Services

- **Frontend:** `~/Desktop/tmpbox/frontend` (Next.js)
- **API:** `~/Desktop/tmpbox/api` (Python FastAPI)
- **Claude Proxy:** `~/Desktop/tmpbox/claude-proxy` (Go)

## Cloudflare Dashboard

View/Edit: https://dash.cloudflare.com/ → Workers & Pages → tmpbox-email-worker

## Wrangler Commands

```bash
# View deployments
wrangler deployments list --name tmpbox-email-worker

# View version details
wrangler versions view a6435429-3f9f-4d86-859b-e0ea099a236e --name tmpbox-email-worker

# Deploy new version (requires wrangler.toml in project dir)
wrangler deploy

# Tail logs
wrangler tail tmpbox-email-worker

# KV operations
wrangler kv key list --namespace-id e381e7c0911f4e6fb0b5f314c1a41846
wrangler kv key get "list:a@tmpbox.space" --namespace-id e381e7c0911f4e6fb0b5f314c1a41846
wrangler kv key get "email:a@tmpbox.space:UUID" --namespace-id e381e7c0911f4e6fb0b5f314c1a41846
```

## Email Routing Configuration

**Domain:** tmpbox.space  
**MX Records:** Pointing to Cloudflare
```
99 route1.mx.cloudflare.net.
70 route3.mx.cloudflare.net.
80 route2.mx.cloudflare.net.
```

**Routing Rule:** Catch-All → Send to Worker (`tmpbox-email-worker`)  
**Status:** ✅ Active

All emails sent to `*@tmpbox.space` are automatically captured and processed by the worker.

## Key Features

- ✅ **Multiple emails per address** - UUID-based storage system
- ✅ **24-hour TTL** - Emails auto-expire after 1 day
- ✅ **CORS enabled** - Can be accessed from frontend apps
- ✅ **Raw email storage** - Full email content including headers
- ✅ **Catch-all routing** - Any address at tmpbox.space works
- ✅ **List tracking** - Maintains ordered list of message IDs per address

## Notes

- Source code deployed directly to Cloudflare (not in local filesystem)
- Worker handles both email ingestion and HTTP API
- Each email gets a unique UUID to support multiple messages per address
- KV keys use format: `email:{address}:{uuid}` and `list:{address}`
- To modify: Use Cloudflare Dashboard Quick Edit or recreate locally
