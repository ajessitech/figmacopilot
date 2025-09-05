import time
import logging
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Tuple


logger = logging.getLogger(__name__)


@dataclass
class ConversationItem:
    """A minimal item we intentionally persist for our conversation store.

    Note: We store only role + text content in this phase (no images).
    """

    role: str  # "system" | "user" | "assistant"
    content: str
    id: str = field(default_factory=lambda: f"msg_{int(time.time() * 1000)}")
    created_at_ms: int = field(default_factory=lambda: int(time.time() * 1000))


@dataclass
class UsageSnapshot:
    """Captured usage metrics for a run, for future adaptation policies."""

    requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


class ConversationStore:
    """In-memory store for curated conversation history.

    Phase 1: text-only; no tool noise, no raw base64. Multimodal hooks come later.
    """

    def __init__(self, max_kept_messages: int = 32) -> None:
        self._items: List[ConversationItem] = []
        self._thread_summary: Optional[str] = None
        self._state_facts: Optional[str] = None
        self._usage_history: List[UsageSnapshot] = []
        self._max_kept_messages = max_kept_messages

    # Public API
    def add_user(self, text: str) -> None:
        self._append(ConversationItem(role="user", content=text))

    def add_assistant(self, text: str) -> None:
        self._append(ConversationItem(role="assistant", content=text))

    def set_thread_summary(self, summary: Optional[str]) -> None:
        self._thread_summary = summary

    def set_state_facts(self, facts: Optional[str]) -> None:
        self._state_facts = facts

    def record_usage(self, usage: UsageSnapshot) -> None:
        self._usage_history.append(usage)

    def recent_items(self, k: int) -> List[ConversationItem]:
        """Return the last k items (only user/assistant) in chronological order."""
        filtered = [i for i in self._items if i.role in ("user", "assistant")]
        return filtered[-k:]

    def clear(self) -> None:
        self._items.clear()
        self._thread_summary = None
        self._state_facts = None
        self._usage_history.clear()

    # Internal
    def _append(self, item: ConversationItem) -> None:
        self._items.append(item)
        # Keep memory bounded
        if len(self._items) > self._max_kept_messages:
            self._items = self._items[-self._max_kept_messages :]

    # Read-only accessors
    @property
    def thread_summary(self) -> Optional[str]:
        return self._thread_summary

    @property
    def state_facts(self) -> Optional[str]:
        return self._state_facts


class TokenBudgeter:
    """Lightweight token budgeting with heuristic estimation.

    We avoid heavy deps; estimation uses ~4 chars/token heuristic.
    """

    def __init__(self, max_input_tokens: int = 8192, output_headroom_ratio: float = 0.3) -> None:
        self.max_input_tokens = max_input_tokens
        self.output_headroom_ratio = output_headroom_ratio

    def estimate_tokens_for_text(self, text: str) -> int:
        if not text:
            return 0
        # Heuristic: ~4 characters per token
        return max(1, int(len(text) / 4))

    def plan_budget(self, candidate_items: List[Dict[str, Any]]) -> Tuple[int, int, int]:
        total_est = 0
        for item in candidate_items:
            content = item.get("content") or ""
            if isinstance(content, str):
                total_est += self.estimate_tokens_for_text(content)
            elif isinstance(content, list):
                # If content is a list of segments, sum text-like parts
                for seg in content:
                    if isinstance(seg, dict) and seg.get("type") == "input_text":
                        total_est += self.estimate_tokens_for_text(seg.get("text", ""))
                    elif isinstance(seg, dict) and seg.get("text"):
                        total_est += self.estimate_tokens_for_text(seg.get("text", ""))

        reserved_for_output = int(self.max_input_tokens * self.output_headroom_ratio)
        allowed_for_input = max(0, self.max_input_tokens - reserved_for_output)
        return total_est, allowed_for_input, reserved_for_output


class Packer:
    """Builds input items deterministically for each run.

    Phase 2: text + optional images (input_image). Images are attached only
    to the current user turn and are never persisted in the store.
    """

    def __init__(self, last_k: int = 8, budgeter: Optional[TokenBudgeter] = None) -> None:
        self.last_k = last_k
        self.budgeter = budgeter or TokenBudgeter()

    def build_input(
        self,
        instructions: Optional[str],
        store: ConversationStore,
        user_text: Optional[str],
        user_images_data_urls: Optional[List[str]] = None,
        include_summary: bool = True,
        include_state_facts: bool = True,
    ) -> List[Dict[str, Any]]:
        """Return a list of input items for Runner.run_streamed(..., input=...).

        Notes:
        - We DO NOT include the system instructions as an input item when the Agent already
          has `instructions` set; that would duplicate the prompt. We include optional
          summary/facts as system items because those are dynamic and not part of the agent.
        - We include last K curated items (user/assistant only) and the current user text.
        - If over budget, we trim K downward.
        """

        # 1) Optional dynamic system items (thread summary, state facts)
        items: List[Dict[str, Any]] = []
        if include_summary and store.thread_summary:
            items.append({"role": "system", "content": f"Thread summary: {store.thread_summary}"})
        if include_state_facts and store.state_facts:
            items.append({"role": "system", "content": f"Key facts: {store.state_facts}"})

        # Helper: build the current user message with optional images
        def _build_current_user_item(text: Optional[str], image_urls: Optional[List[str]]) -> Dict[str, Any]:
            images = [u for u in (image_urls or []) if isinstance(u, str) and u]
            if images:
                segments: List[Dict[str, Any]] = []
                if text:
                    segments.append({"type": "input_text", "text": text})
                for url in images:
                    segments.append({"type": "input_image", "image_url": url})
                return {"role": "user", "content": segments}
            # No images → plain text content
            return {"role": "user", "content": text or ""}

        # 2) Recent curated items (drop tool noise entirely by design)
        k = self.last_k
        while k >= 0:
            recent = store.recent_items(k)
            candidate_items = items + [
                {"role": it.role, "content": it.content} for it in recent
            ]
            # Always include the current user item (text and optional images)
            candidate_items.append(_build_current_user_item(user_text, user_images_data_urls))

            # Budgeting pass
            est, allowed, reserved = self.budgeter.plan_budget(candidate_items)
            logger.info(
                f"🧮 Budget: est_in_tokens={est}, allowed_for_input={allowed}, reserved_output={reserved}, last_k={k}"
            )
            if est <= allowed:
                items = candidate_items
                break
            # Reduce K and try again
            k -= 2  # step down by 2 to drop a full turn on each side faster

        # 3) Fallback to minimal prompt if something went wrong
        if not items:
            logger.warning("⚠️ Packing produced empty items. Falling back to minimal prompt")
            minimal = []
            minimal.append(_build_current_user_item(user_text, user_images_data_urls))
            return minimal

        return items


