// useChat: state management hook for the chat interface (FR-6).
// Single responsibility: own the message thread and drive
// api/client.askQuestion's stream into it. No rendering logic.

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { ApiError, askQuestion } from "@/api/client";
import type { CitationOut, QueryRequest, RetrievalMode, RetrievedChunkOut } from "@/types";

/**
 * Lifecycle of an assistant turn. `pending` is "asked, nothing back yet"
 * (the typing indicator); `streaming` means at least one token has
 * landed. User messages are always `complete`.
 */
export type ChatMessageStatus = "pending" | "streaming" | "complete" | "error";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: ChatMessageStatus;
  /** Assistant only, from the terminal `done` frame. Empty when
   *  retrieval found nothing -- a completed answer, not a failure. */
  sources?: CitationOut[];
  chunks?: RetrievedChunkOut[];
  /** Assistant only. Null on the FR-10 refusal. */
  retrievalMode?: RetrievalMode | null;
  /** Assistant only, set when the stream raised an error frame. */
  error?: string;
  /** Assistant only: the request that produced this turn, replayed
   *  verbatim by regenerate/retry. */
  request?: QueryRequest;
}

/** Which source the reader is pointing at, so the Sources panel can
 *  highlight it. `sourceIndex` is 0-based into that message's `sources`. */
export interface ActiveCitation {
  messageId: string;
  sourceIndex: number;
}

export interface AskOptions {
  /** Scope the search to these documents; omit to search all of them. */
  documentIds?: string[];
  mode?: RetrievalMode;
}

interface ChatState {
  messages: ChatMessage[];
  /** What the Sources panel should highlight right now. */
  activeCitation: ActiveCitation | null;
  /** What it falls back to when the pointer leaves a chip -- a clicked
   *  chip stays highlighted, a merely hovered one does not. */
  pinnedCitation: ActiveCitation | null;
}

type ChatAction =
  | {
      type: "ask";
      userMessageId: string;
      assistantMessageId: string;
      question: string;
      request: QueryRequest;
    }
  | { type: "restart"; id: string }
  | { type: "token"; id: string; text: string }
  | {
      type: "done";
      id: string;
      sources: CitationOut[];
      chunks: RetrievedChunkOut[];
      retrievalMode: RetrievalMode | null;
    }
  | { type: "error"; id: string; error: string }
  | { type: "hover-citation"; citation: ActiveCitation | null }
  | { type: "select-citation"; citation: ActiveCitation };

const INITIAL_STATE: ChatState = {
  messages: [],
  activeCitation: null,
  pinnedCitation: null,
};

function isSameCitation(a: ActiveCitation | null, b: ActiveCitation | null): boolean {
  return a !== null && b !== null && a.messageId === b.messageId && a.sourceIndex === b.sourceIndex;
}

/** Apply `update` to one message, leaving every other message identical. */
function patchMessage(
  state: ChatState,
  id: string,
  update: (message: ChatMessage) => ChatMessage,
): ChatState {
  return {
    ...state,
    messages: state.messages.map((message) => (message.id === id ? update(message) : message)),
  };
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "ask":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: action.userMessageId,
            role: "user",
            content: action.question,
            status: "complete",
          },
          {
            id: action.assistantMessageId,
            role: "assistant",
            content: "",
            status: "pending",
            request: action.request,
          },
        ],
      };

    // Regenerate/retry: wipe the previous outcome so the bubble shows the
    // typing indicator again instead of holding a stale answer while new
    // tokens arrive underneath it.
    case "restart":
      return patchMessage(state, action.id, (message) => ({
        ...message,
        content: "",
        status: "pending",
        sources: undefined,
        chunks: undefined,
        retrievalMode: undefined,
        error: undefined,
      }));

    case "token":
      return patchMessage(state, action.id, (message) => ({
        ...message,
        content: message.content + action.text,
        status: "streaming",
      }));

    // The answer text arrived as tokens, so `done` only attaches what
    // could not be known until generation finished.
    case "done":
      return patchMessage(state, action.id, (message) => ({
        ...message,
        status: "complete",
        sources: action.sources,
        chunks: action.chunks,
        retrievalMode: action.retrievalMode,
      }));

    case "error":
      return patchMessage(state, action.id, (message) => ({
        ...message,
        status: "error",
        error: action.error,
      }));

    case "hover-citation":
      return { ...state, activeCitation: action.citation ?? state.pinnedCitation };

    // Clicking toggles the pin. The pointer is still on the chip either
    // way, so it stays the active highlight regardless.
    case "select-citation": {
      const unpinning = isSameCitation(state.pinnedCitation, action.citation);
      return {
        ...state,
        activeCitation: action.citation,
        pinnedCitation: unpinning ? null : action.citation,
      };
    }

    default:
      return state;
  }
}

function newId(): string {
  return crypto.randomUUID();
}

/** Anything thrown by the stream, reduced to a sentence for the UI. The
 *  backend's `detail` is already user-facing, so it passes through. */
function describeError(error: unknown): string {
  const fallback = "Something went wrong generating the answer.";
  if (error instanceof ApiError) {
    return error.message || fallback;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}

export interface UseChatResult {
  messages: ChatMessage[];
  /** True while any turn is awaiting or receiving tokens. */
  isStreaming: boolean;
  /** The source the Sources panel should highlight. */
  activeCitation: ActiveCitation | null;
  ask: (question: string, options?: AskOptions) => void;
  /** Re-run the request behind an assistant message -- the Regenerate
   *  action, and the Retry action on a failed one. */
  regenerate: (messageId: string) => void;
  /** Transient highlight; pass null when the pointer leaves. */
  hoverCitation: (citation: ActiveCitation | null) => void;
  /** Sticky highlight; clicking the pinned chip again clears it. */
  selectCitation: (citation: ActiveCitation) => void;
}

export function useChat(): UseChatResult {
  const [state, dispatch] = useReducer(chatReducer, INITIAL_STATE);

  const abortRef = useRef<AbortController | null>(null);
  // Bumped per run so a superseded stream's frames are dropped rather
  // than interleaved into a bubble that has already moved on.
  const runIdRef = useRef(0);

  useEffect(() => {
    const abort = abortRef;
    const runId = runIdRef;
    return () => {
      runId.current += 1;
      abort.current?.abort();
    };
  }, []);

  const run = useCallback(async (assistantMessageId: string, request: QueryRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    runIdRef.current += 1;
    const runId = runIdRef.current;

    try {
      for await (const event of askQuestion(request, controller.signal)) {
        if (runIdRef.current !== runId) return;

        if (event.type === "token") {
          dispatch({ type: "token", id: assistantMessageId, text: event.text });
        } else {
          dispatch({
            type: "done",
            id: assistantMessageId,
            sources: event.sources,
            chunks: event.retrieved_chunks,
            retrievalMode: event.retrieval_mode,
          });
        }
      }
    } catch (error) {
      // A superseded or unmounted run has no bubble left to fail into.
      if (runIdRef.current !== runId || controller.signal.aborted) return;
      dispatch({ type: "error", id: assistantMessageId, error: describeError(error) });
    }
  }, []);

  const ask = useCallback(
    (question: string, options?: AskOptions) => {
      const trimmed = question.trim();
      if (!trimmed) return;

      const documentIds = options?.documentIds ?? [];
      const request: QueryRequest = {
        question: trimmed,
        // An empty selection means "no filter", which the backend spells
        // as null rather than as an empty array.
        document_ids: documentIds.length > 0 ? documentIds : null,
        ...(options?.mode ? { mode: options.mode } : {}),
      };

      const assistantMessageId = newId();
      dispatch({
        type: "ask",
        userMessageId: newId(),
        assistantMessageId,
        question: trimmed,
        request,
      });
      void run(assistantMessageId, request);
    },
    [run],
  );

  const regenerate = useCallback(
    (messageId: string) => {
      const message = state.messages.find((candidate) => candidate.id === messageId);
      if (!message?.request) return;

      dispatch({ type: "restart", id: messageId });
      void run(messageId, message.request);
    },
    [run, state.messages],
  );

  const hoverCitation = useCallback((citation: ActiveCitation | null) => {
    dispatch({ type: "hover-citation", citation });
  }, []);

  const selectCitation = useCallback((citation: ActiveCitation) => {
    dispatch({ type: "select-citation", citation });
  }, []);

  const isStreaming = useMemo(
    () =>
      state.messages.some(
        (message) => message.status === "pending" || message.status === "streaming",
      ),
    [state.messages],
  );

  return {
    messages: state.messages,
    isStreaming,
    activeCitation: state.activeCitation,
    ask,
    regenerate,
    hoverCitation,
    selectCitation,
  };
}
