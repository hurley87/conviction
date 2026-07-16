import { describe, expect, it } from "vitest";
import {
  appendTranscript,
  INITIAL_SPEECH_RECOGNITION_STATE,
  speechRecognitionErrorMessage,
  speechRecognitionReducer,
  transcriptFromResults,
} from "@/hooks/use-speech-recognition";

describe("speech recognition draft helpers", () => {
  it("appends speech to an existing typed draft", () => {
    expect(appendTranscript("Move $25", "to cash")).toBe("Move $25 to cash");
    expect(appendTranscript("", "Summarize the feed")).toBe(
      "Summarize the feed",
    );
  });

  it("combines interim and final mocked recognition results", () => {
    const results = {
      0: { 0: { transcript: "Move twenty five" }, isFinal: true, length: 1 },
      1: { 0: { transcript: "to cash" }, isFinal: false, length: 1 },
      length: 2,
    };

    expect(transcriptFromResults(results)).toBe("Move twenty five to cash");
  });
});

describe("speech recognition state", () => {
  it("moves through listening, error, and retry states", () => {
    const listening = speechRecognitionReducer(
      INITIAL_SPEECH_RECOGNITION_STATE,
      { type: "start" },
    );
    expect(listening).toEqual({ listening: true, error: null });

    const failed = speechRecognitionReducer(listening, {
      type: "error",
      message: "Microphone access was denied.",
    });
    expect(failed).toEqual({
      listening: false,
      error: "Microphone access was denied.",
    });

    expect(
      speechRecognitionReducer(failed, { type: "clear-error" }),
    ).toEqual({ listening: false, error: null });
  });

  it("maps common browser errors to useful, non-destructive messages", () => {
    expect(speechRecognitionErrorMessage("aborted")).toBeNull();
    expect(speechRecognitionErrorMessage("not-allowed")).toContain("denied");
    expect(speechRecognitionErrorMessage("no-speech")).toContain(
      "didn’t hear anything",
    );
    expect(speechRecognitionErrorMessage("audio-capture")).toContain(
      "No microphone",
    );
  });
});
