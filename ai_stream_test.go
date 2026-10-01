package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeAIChunk(w io.Writer, delta map[string]any, finish string) {
	data, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}})
	fmt.Fprintf(w, "data: %s\n\n", data)
}

func TestAIStreamPreviewsBeforeCompletion(t *testing.T) {
	reader, writer := io.Pipe()
	defer reader.Close()
	defer writer.Close()
	previews := make(chan []map[string]any, 8)
	done := make(chan struct {
		response aiResponse
		err      error
	}, 1)
	go func() {
		response, err := decodeAIResponse(reader, true, func(elements []map[string]any) error { previews <- elements; return nil })
		done <- struct {
			response aiResponse
			err      error
		}{response, err}
	}()
	node := `{"type":"ellipse","id":"node","x":10,"y":20,"label":{"text":"层 } \\\" A"}}`
	partialArguments, _ := json.Marshal(map[string]string{"elements": "[" + node + ","})
	prefix := string(partialArguments[:len(partialArguments)-2])
	writeAIChunk(writer, map[string]any{"reasoning_content": "Plan", "tool_calls": []any{map[string]any{"index": 0, "id": "draw", "function": map[string]string{"name": "create_view", "arguments": prefix}}}}, "")
	select {
	case preview := <-previews:
		if len(preview) != 1 || preview[0]["id"] != "node" {
			t.Fatal("complete node was not previewed", preview)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("preview waited for the final tool result")
	}
	select {
	case <-done:
		t.Fatal("stream finished before its final chunk")
	default:
	}
	edge := `{"type":"arrow","id":"edge","x":10,"y":20,"points":[[0,0],[10,10]]}`
	tail, _ := json.Marshal(edge + "]")
	writeAIChunk(writer, map[string]any{"reasoning_content": " done", "tool_calls": []any{map[string]any{"index": 0, "function": map[string]string{"arguments": string(tail[1:len(tail)-1]) + `"}`}}}}, "tool_calls")
	io.WriteString(writer, "data: {\"choices\":[],\"usage\":{\"total_tokens\":42}}\n\ndata: [DONE]\n\n")
	result := <-done
	if result.err != nil {
		t.Fatal(result.err)
	}
	final := <-previews
	if len(final) != 2 || final[1]["id"] != "edge" {
		t.Fatal("final elements were not flushed", final)
	}
	message := result.response.Choices[0].Message
	if message["reasoning_content"] != "Plan done" || string(result.response.Usage) != `{"total_tokens":42}` {
		t.Fatal("stream lost reasoning or usage", message)
	}
	fn := message["tool_calls"].([]any)[0].(map[string]any)["function"].(map[string]any)
	if fn["name"] != "create_view" || len(completeAIElements(fn["arguments"].(string))) != 2 {
		t.Fatal("tool arguments were not reassembled")
	}
	for _, truncated := range []string{"data: {}\n\n", "data: [DONE]\n\n"} {
		if _, err := decodeAIResponse(strings.NewReader(truncated), true, nil); err == nil {
			t.Fatal("incomplete stream accepted")
		}
	}
}

func TestCompleteAIElementsAndCheckpointPreview(t *testing.T) {
	first := `{"type":"text","id":"a","x":0,"y":0,"text":"引号 \\\" and } and \\u4e2d"}`
	partial := "[" + first + `,{"type":"text","text":"unfinished`
	encoded, _ := json.Marshal(map[string]string{"elements": partial})
	for _, args := range []string{string(encoded), string(encoded[:len(encoded)-2]), string(encoded[:len(encoded)-3]) + `\u12`} {
		if got := completeAIElements(args); len(got) != 1 || got[0]["id"] != "a" {
			t.Fatal("partial string or nested object lost complete elements", args, got)
		}
	}
	if got := completeAIElements(`{"elements":"[{\"id\":`); len(got) != 0 {
		t.Fatal("incomplete element accepted", got)
	}
	base := []map[string]any{{"id": "old"}, {"id": "bound", "containerId": "old"}, {"id": "keep"}}
	edits := []map[string]any{{"type": "restoreCheckpoint", "id": "wrong"}, {"type": "delete", "ids": " old "}, {"type": "cameraUpdate"}, {"type": "ellipse", "id": "new"}}
	resolved := resolveAIPreview(base, edits)
	if len(resolved) != 2 || resolved[0]["id"] != "keep" || resolved[1]["id"] != "new" || len(base) != 3 {
		t.Fatal("preview must preserve unrelated elements and remove deleted bindings", resolved)
	}
}

// Opt-in integration check against the configured provider; never saves a user canvas.
func TestLiveAIProgress(t *testing.T) {
	if os.Getenv("EXBASE_LIVE_AI_CHECK") != "1" {
		t.Skip("set EXBASE_LIVE_AI_CHECK=1 to use the configured API")
	}
	app := &App{root: t.TempDir()}
	path := filepath.Join(app.root, "preview.excalidraw")
	session, err := app.CreateAISession(path)
	if err != nil {
		t.Fatal(err)
	}
	result, err := app.AskAI(path, `{"elements":[]}`, "", "Draw a compact four-node pipeline: Input, Hidden 1, Hidden 2, Output. Use rounded rectangles, three arrows connecting them from left to right, and separate labels. Output nodes first, then connections, then labels. Keep it simple.", "", nil, session, "live-preview-check")
	if err != nil {
		t.Fatal(err)
	}
	if result.CheckpointID == "" || len(result.Elements) == 0 || string(result.Elements) == "null" {
		t.Fatal("live request produced no canvas")
	}
	tracePath, _ := sessionFile(session)
	file, err := os.Open(tracePath)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	previews := 0
	for {
		var entry struct {
			Event string `json:"event"`
			Data  struct {
				Elapsed int64 `json:"elapsed_ms"`
				Count   int   `json:"element_count"`
			} `json:"data"`
		}
		if err := decoder.Decode(&entry); err == io.EOF {
			break
		} else if err != nil {
			t.Fatal(err)
		}
		if entry.Event == "canvas_preview" {
			previews++
			t.Logf("preview at %.1fs: %d elements", float64(entry.Data.Elapsed)/1000, entry.Data.Count)
		}
		if entry.Event == "turn_complete" {
			t.Logf("complete at %.1fs; session %s", float64(entry.Data.Elapsed)/1000, session)
		}
	}
	if previews < 2 {
		t.Fatal("live response did not produce progressive previews")
	}
}
