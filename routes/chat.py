"""OpenAI and Anthropic compatible chat routes."""
import json
import re
import time
import uuid
from typing import Optional, Union

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from auth import extract_api_key
from models import ChatCompletionRequest
from proxy import proxy_chat, proxy_chat_stream, fetch_models

router = APIRouter()


# ── OpenAI-compatible ────────────────────────────────────────────

@router.post("/v1/chat/completions")
async def chat_completions(
    request: ChatCompletionRequest,
    authorization: str = Header(None),
    x_api_key: str = Header(None, alias="x-api-key"),
    user_agent: str = Header(None, alias="user-agent"),
):
    proxy_key = extract_api_key(authorization, x_api_key)
    params = request.model_dump()
    params["_user_agent"] = user_agent or ""
    messages = [m.model_dump(exclude_none=True) for m in request.messages]

    if request.stream:
        return StreamingResponse(
            proxy_chat_stream(request.model, messages, params, proxy_key),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    result = await proxy_chat(request.model, messages, params, proxy_key)
    return JSONResponse(result)


@router.get("/v1/models")
async def list_models(
    authorization: str = Header(None),
    x_api_key: str = Header(None, alias="x-api-key"),
    anthropic_version: str = Header(None, alias="anthropic-version"),
):
    extract_api_key(authorization, x_api_key)
    models = await fetch_models()
    if anthropic_version:
        # Anthropic SDK format
        data = [
            {"type": "model", "id": m["id"], "display_name": m["id"], "created_at": "2024-01-01T00:00:00Z"}
            for m in models["data"]
        ]
        return JSONResponse({"data": data, "has_more": False, "first_id": data[0]["id"] if data else None, "last_id": data[-1]["id"] if data else None})
    return JSONResponse(models)


# ── Image Generation ─────────────────────────────────────────────

class ImageGenerationRequest(BaseModel):
    prompt: str
    model: str = "MiniMax-Hailuo-2.3"
    n: int = 1
    size: str = "1:1"
    quality: str = "1K"
    response_format: str = "url"


@router.post("/v1/images/generations")
async def image_generations(
    request: Request,
    authorization: str = Header(None),
    x_api_key: str = Header(None, alias="x-api-key"),
):
    proxy_key = extract_api_key(authorization, x_api_key)
    body = await request.json()
    req = ImageGenerationRequest(**body)

    prompt = req.prompt
    size_hint = f"aspect_ratio:{req.size}" if req.size != "1:1" else ""
    quality_hint = f"resolution:{req.quality}" if req.quality != "1K" else ""
    hints = ", ".join(filter(None, [size_hint, quality_hint]))
    if hints:
        prompt = f"{prompt} [{hints}]"

    messages = [{"role": "user", "content": prompt}]
    params = {"_user_agent": "", "stream": False}

    try:
        result = await proxy_chat(req.model, messages, params, proxy_key)
        content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
        urls = re.findall(r'https?://[^\s<>"]+(?:\.png|\.jpg|\.jpeg|\.webp)[^\s<>"]*', content)
        if not urls:
            media_srcs = re.findall(r'<media\s+src="([^"]+)"', content)
            urls = [s for s in media_srcs if s.startswith("http")]
        if urls:
            data = [{"url": url, "revised_prompt": req.prompt} for url in urls[:req.n]]
        else:
            data = [{"url": "", "b64_json": None, "revised_prompt": content[:200]}]
        return JSONResponse({"created": int(time.time()), "data": data})
    except Exception as e:
        return JSONResponse({"error": {"message": str(e), "type": "upstream_error"}}, status_code=503)


# ── Anthropic-compatible ─────────────────────────────────────────

class AnthropicMessage(BaseModel):
    role: str
    content: Union[str, list]


class AnthropicRequest(BaseModel):
    model: str = "MiniMax-M3"
    messages: list[AnthropicMessage]
    system: Optional[Union[str, list]] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    stream: Optional[bool] = False
    tools: Optional[list] = None


def _anthropic_to_openai_messages(messages: list, system) -> list:
    result = []
    if system:
        if isinstance(system, list):
            system_text = "\n".join(
                b.get("text", "") for b in system if isinstance(b, dict) and b.get("type") == "text"
            )
        else:
            system_text = system
        if system_text:
            result.append({"role": "system", "content": system_text})
    for m in messages:
        content = m.content
        if isinstance(content, list):
            text_parts = []
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text":
                        text_parts.append(block.get("text", ""))
                    elif block.get("type") == "tool_result":
                        text_parts.append(str(block.get("content", "")))
                else:
                    text_parts.append(str(block))
            content = "\n".join(text_parts)
        result.append({"role": m.role, "content": content})
    return result


def _openai_to_anthropic_response(data: dict, model: str) -> dict:
    choice = data.get("choices", [{}])[0]
    message = choice.get("message", {})
    content = message.get("content") or ""
    tool_calls = message.get("tool_calls")
    finish = choice.get("finish_reason", "end_turn")
    if finish == "stop":
        finish = "end_turn"
    elif finish == "tool_calls":
        finish = "tool_use"

    content_blocks = []
    if content:
        content_blocks.append({"type": "text", "text": content})
    if tool_calls:
        for tc in tool_calls:
            args = tc.get("function", {}).get("arguments", "{}")
            try:
                args = json.loads(args)
            except Exception:
                args = {}
            content_blocks.append({
                "type": "tool_use",
                "id": tc.get("id", ""),
                "name": tc.get("function", {}).get("name", ""),
                "input": args,
            })

    usage = data.get("usage", {})
    return {
        "id": data.get("id", f"msg_{int(time.time())}"),
        "type": "message",
        "role": "assistant",
        "content": content_blocks,
        "model": model,
        "stop_reason": finish,
        "stop_sequence": None,
        "usage": {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
        },
    }


async def _anthropic_stream_generator(model: str, messages: list, params: dict, proxy_key: str):
    msg_id = f"msg_{uuid.uuid4().hex[:16]}"
    yield f"event: message_start\ndata: {json.dumps({'type':'message_start','message':{'id':msg_id,'type':'message','role':'assistant','content':[],'model':model,'stop_reason':None,'stop_sequence':None,'usage':{'input_tokens':0,'output_tokens':0}}})}\n\n"
    yield f"event: content_block_start\ndata: {json.dumps({'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}})}\n\n"
    yield f"event: ping\ndata: {json.dumps({'type':'ping'})}\n\n"

    full_text = ""
    finish_reason = "end_turn"
    from typing import Set
    open_tool_blocks: Set[int] = set()

    async for chunk in proxy_chat_stream(model, messages, params, proxy_key):
        if not chunk.startswith("data: "):
            continue
        raw = chunk[6:].strip()
        if raw == "[DONE]":
            break
        try:
            data = json.loads(raw)
        except Exception:
            continue
        if "error" in data:
            # Close open content block before emitting error
            yield f"event: content_block_stop\ndata: {json.dumps({'type':'content_block_stop','index':0})}\n\n"
            yield f"event: message_delta\ndata: {json.dumps({'type':'message_delta','delta':{'stop_reason':'end_turn','stop_sequence':None},'usage':{'output_tokens':len(full_text)//4}})}\n\n"
            yield f"event: message_stop\ndata: {json.dumps({'type':'message_stop'})}\n\n"
            yield f"event: error\ndata: {json.dumps({'type':'error','error':{'type':'api_error','message':data['error'].get('message','')}})}\n\n"
            return
        choice = (data.get("choices") or [{}])[0] or {}
        delta = choice.get("delta", {})
        text = delta.get("content", "")
        tool_calls_delta = delta.get("tool_calls")
        fr = choice.get("finish_reason")
        if fr:
            if fr == "tool_calls":
                finish_reason = "tool_use"
            elif fr == "length":
                finish_reason = "max_tokens"
            elif fr == "stop":
                finish_reason = "end_turn"
            else:
                finish_reason = fr
        if text:
            full_text += text
            yield f"event: content_block_delta\ndata: {json.dumps({'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':text}})}\n\n"
        if tool_calls_delta:
            for tc in tool_calls_delta:
                idx = tc.get("index", 0) + 1  # offset by 1 since index 0 is text block
                fn = tc.get("function", {})
                if tc.get("id"):
                    yield f"event: content_block_start\ndata: {json.dumps({'type':'content_block_start','index':idx,'content_block':{'type':'tool_use','id':tc['id'],'name':fn.get('name',''),'input':{}}})}\n\n"
                    open_tool_blocks.add(idx)
                if fn.get("arguments"):
                    yield f"event: content_block_delta\ndata: {json.dumps({'type':'content_block_delta','index':idx,'delta':{'type':'input_json_delta','partial_json':fn['arguments']}})}\n\n"

    # Close text block and any open tool blocks
    yield f"event: content_block_stop\ndata: {json.dumps({'type':'content_block_stop','index':0})}\n\n"
    for tidx in sorted(open_tool_blocks):
        yield f"event: content_block_stop\ndata: {json.dumps({'type':'content_block_stop','index':tidx})}\n\n"
    yield f"event: message_delta\ndata: {json.dumps({'type':'message_delta','delta':{'stop_reason':finish_reason,'stop_sequence':None},'usage':{'output_tokens':len(full_text)//4}})}\n\n"
    yield f"event: message_stop\ndata: {json.dumps({'type':'message_stop'})}\n\n"


@router.post("/v1/messages")
async def anthropic_messages(
    request: Request,
    authorization: str = Header(None),
    x_api_key: str = Header(None, alias="x-api-key"),
    user_agent: str = Header(None, alias="user-agent"),
):
    proxy_key = extract_api_key(authorization, x_api_key)
    body = await request.json()
    req = AnthropicRequest(**body)

    messages = _anthropic_to_openai_messages(req.messages, req.system)
    params = {
        "stream": req.stream,
        "max_tokens": req.max_tokens,
        "temperature": req.temperature,
        "top_p": req.top_p,
        "tools": [{"type": "function", "function": {"name": t.get("name",""), "description": t.get("description",""), "parameters": t.get("input_schema", {})}} for t in (req.tools or [])],
        "_user_agent": user_agent or "",
    }
    if not params["tools"]:
        params["tools"] = None

    if req.stream:
        return StreamingResponse(
            _anthropic_stream_generator(req.model, messages, params, proxy_key),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    result = await proxy_chat(req.model, messages, params, proxy_key)
    return JSONResponse(_openai_to_anthropic_response(result, req.model))
