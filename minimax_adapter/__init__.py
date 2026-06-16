"""MiniMax Global Web Agent API Adapter.

Translates OpenAI-compatible requests into MiniMax's global web agent API
(agent.minimax.io) and back.

This package is organized into modules:
- utils: Basic utility functions (MD5, UUID, timestamps)
- signing: HTTP signature and URL building
- pool: Session pool management
- session: Session creation and message streaming
- streaming: SSE formatting utilities
- client: Main chat client (web_agent_chat, web_agent_chat_stream)

Public API:
- web_agent_chat: Non-streaming chat
- web_agent_chat_stream: Streaming chat
- test_adapter: Test function
- pool_size: Get pool session count
- parse_token: Parse token string
"""

# Public API exports
from .client import (
    web_agent_chat,
    web_agent_chat_stream,
    test_adapter,
)

from .pool import (
    pool_size,
    parse_token,
)

__all__ = [
    "web_agent_chat",
    "web_agent_chat_stream",
    "test_adapter",
    "pool_size",
    "parse_token",
]
