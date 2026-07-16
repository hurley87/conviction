"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useSyncExternalStore,
} from "react";

type RecognitionResultLike = {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
};

export type SpeechRecognitionState = {
  listening: boolean;
  error: string | null;
};

export type SpeechRecognitionAction =
  | { type: "start" }
  | { type: "end" }
  | { type: "error"; message: string }
  | { type: "clear-error" };

export const INITIAL_SPEECH_RECOGNITION_STATE: SpeechRecognitionState = {
  listening: false,
  error: null,
};

export function speechRecognitionReducer(
  state: SpeechRecognitionState,
  action: SpeechRecognitionAction,
): SpeechRecognitionState {
  switch (action.type) {
    case "start":
      return { listening: true, error: null };
    case "end":
      return { ...state, listening: false };
    case "error":
      return { listening: false, error: action.message };
    case "clear-error":
      return { ...state, error: null };
  }
}

export function appendTranscript(draft: string, transcript: string): string {
  const base = draft.trimEnd();
  const spoken = transcript.trim();
  if (!spoken) return draft;
  return base ? `${base} ${spoken}` : spoken;
}

export function transcriptFromResults(
  results: ArrayLike<RecognitionResultLike>,
): string {
  const parts: string[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const transcript = results[index]?.[0]?.transcript?.trim();
    if (transcript) parts.push(transcript);
  }
  return parts.join(" ");
}

export function speechRecognitionErrorMessage(error: string): string | null {
  switch (error) {
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was denied. You can keep typing instead.";
    case "audio-capture":
      return "No microphone was found. You can keep typing instead.";
    case "no-speech":
      return "I didn’t hear anything. Try speaking again.";
    case "network":
      return "Speech recognition is unavailable right now. Try again.";
    default:
      return "I couldn’t transcribe that. Try again or keep typing.";
  }
}

type UseSpeechRecognitionOptions = {
  draft: string;
  enabled: boolean;
  onDraftChange: (draft: string) => void;
};

const NOOP_SUBSCRIBE = () => () => {};

export function useSpeechRecognition({
  draft,
  enabled,
  onDraftChange,
}: UseSpeechRecognitionOptions) {
  const supported = useSyncExternalStore(
    NOOP_SUBSCRIBE,
    () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    () => false,
  );
  const [state, dispatch] = useReducer(
    speechRecognitionReducer,
    INITIAL_SPEECH_RECOGNITION_STATE,
  );
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const sessionRef = useRef(0);
  const draftRef = useRef(draft);
  const onDraftChangeRef = useRef(onDraftChange);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    onDraftChangeRef.current = onDraftChange;
  }, [onDraftChange]);

  const cancel = useCallback(() => {
    sessionRef.current += 1;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.abort();
    }
    dispatch({ type: "end" });
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (!enabled || recognitionRef.current) return;

    const Recognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      return;
    }

    const recognition = new Recognition();
    const session = sessionRef.current + 1;
    const baseDraft = draftRef.current;
    sessionRef.current = session;
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onstart = () => {
      if (sessionRef.current === session) {
        dispatch({ type: "start" });
      }
    };
    recognition.onresult = (event) => {
      if (sessionRef.current !== session) return;
      const transcript = transcriptFromResults(event.results);
      onDraftChangeRef.current(appendTranscript(baseDraft, transcript));
    };
    recognition.onerror = (event) => {
      if (sessionRef.current !== session) return;
      const message = speechRecognitionErrorMessage(event.error);
      recognitionRef.current = null;
      if (message) {
        dispatch({ type: "error", message });
      } else {
        dispatch({ type: "end" });
      }
    };
    recognition.onend = () => {
      if (sessionRef.current !== session) return;
      recognitionRef.current = null;
      dispatch({ type: "end" });
    };

    try {
      dispatch({ type: "start" });
      recognition.start();
    } catch {
      recognitionRef.current = null;
      dispatch({
        type: "error",
        message: "I couldn’t start the microphone. Try again or keep typing.",
      });
    }
  }, [enabled]);

  const toggle = useCallback(() => {
    if (recognitionRef.current) {
      stop();
    } else {
      start();
    }
  }, [start, stop]);

  const clearError = useCallback(() => {
    dispatch({ type: "clear-error" });
  }, []);

  useEffect(() => {
    if (!enabled) cancel();
  }, [cancel, enabled]);

  useEffect(
    () => () => {
      sessionRef.current += 1;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [],
  );

  return {
    supported,
    listening: state.listening,
    error: state.error,
    start,
    stop,
    cancel,
    toggle,
    clearError,
  };
}
