package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestCanvasBridge(t *testing.T) {
	app := NewApp()
	app.canvasEmit = func(request AICanvasRequest) {
		app.ResolveAICanvas("stale", `[]`, "")
		app.ResolveAICanvas(request.ID, `[{"id":"node","x":0,"y":0,"version":1}]`, "")
	}
	if elements, err := app.compileCanvas(context.Background(), AICanvasRequest{}); err != nil || len(elements) != 1 {
		t.Fatal(elements, err)
	}
	app.canvasEmit = func(request AICanvasRequest) {
		app.ResolveAICanvas(request.ID, `[{"id":"duplicate","x":0,"y":0,"version":1},{"id":"duplicate","x":0,"y":0,"version":1}]`, "")
	}
	if _, err := app.compileCanvas(context.Background(), AICanvasRequest{}); err == nil {
		t.Fatal("duplicate IDs accepted")
	}
	app.canvasEmit = func(request AICanvasRequest) { app.ResolveAICanvas(request.ID, "", "invalid Mermaid syntax") }
	if _, err := app.compileCanvas(context.Background(), AICanvasRequest{}); err == nil || !strings.Contains(err.Error(), "syntax") {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	app.canvasEmit = func(AICanvasRequest) { cancel() }
	if _, err := app.compileCanvas(ctx, AICanvasRequest{}); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if app.aiCanvas != nil {
		t.Fatal("cancelled compiler still holds a pending reply")
	}
}

func TestCanvasInspectionPages(t *testing.T) {
	elements := make([]map[string]any, 300)
	for i := range elements {
		elements[i] = map[string]any{"id": i, "type": "rectangle", "x": i, "y": 0}
	}
	var page map[string]any
	if err := json.Unmarshal([]byte(readCanvas(elements, nil)), &page); err != nil {
		t.Fatal(err)
	}
	if len(page["elements"].([]any)) != 250 || page["nextOffset"] != float64(250) {
		t.Fatal("overview did not expose remaining elements")
	}
	if err := json.Unmarshal([]byte(readCanvas(elements, map[string]any{"offset": float64(250)})), &page); err != nil {
		t.Fatal(err)
	}
	if len(page["elements"].([]any)) != 50 {
		t.Fatal("second page lost elements")
	}
	if !strings.HasPrefix(readCanvas(elements, map[string]any{"offset": float64(-1)}), "Error:") {
		t.Fatal("negative offset accepted")
	}
}

func TestAgentMixesManagedAndNativeTools(t *testing.T) {
	t.Setenv("USERPROFILE", t.TempDir())
	app := &App{root: t.TempDir()}
	if _, err := app.SaveAISettings("test-key", "high"); err != nil {
		t.Fatal(err)
	}
	compiled := []map[string]any{{"id": "flow-A", "type": "rectangle", "x": float64(0), "y": float64(0), "version": float64(1), "customData": map[string]any{"exbaseMermaid": map[string]any{"id": "flow", "active": true, "source": "flowchart LR\nA-->B", "members": []any{"flow-A"}}}}}
	bridgeCalls, rounds := 0, 0
	var systemPrompt string
	state := []map[string]any{}
	app.canvasEmit = func(request AICanvasRequest) {
		bridgeCalls++
		var elements []map[string]any
		if request.Kind == "mermaid" {
			if request.Source != "flowchart LR\nA-->B" || len(request.Elements) != 0 {
				t.Error("wrong compilation input")
			}
			elements = compiled
		} else {
			if len(request.Previous) != 1 || len(request.Elements) != 2 {
				t.Error("native tool did not receive the newly compiled diagram")
			}
			elements = request.Elements
		}
		data, _ := json.Marshal(elements)
		app.ResolveAICanvas(request.ID, string(data), "")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if r.URL.Path == "/chat" {
			messages := body["messages"].([]any)
			system := messages[0].(map[string]any)["content"].(string)
			if systemPrompt == "" {
				systemPrompt = system
			} else if system != systemPrompt {
				t.Error("system prompt changed and broke the cache prefix")
			}
			if rounds > 0 && !strings.Contains(messages[len(messages)-1].(map[string]any)["content"].(string), "flow-A") {
				t.Error("tool result canvas context is stale")
			}
			rounds++
			var name string
			var args any
			switch rounds {
			case 1:
				name, args = "draw_mermaid", map[string]string{"source": "flowchart LR\nA-->B"}
			case 2:
				name, args = "create_view", map[string]string{"elements": `[{"id":"circuit","type":"line","x":200,"y":0,"version":1}]`}
			case 3:
				name, args = "read_canvas", map[string]string{"diagramId": "flow"}
			default:
				last := messages[len(messages)-1].(map[string]any)["content"].(string)
				if !strings.Contains(last, `"source":"flowchart LR`) || !strings.Contains(last, `"active":true`) {
					t.Error("source was not available for subsequent modification")
				}
				json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"role": "assistant", "content": "Done"}, "finish_reason": "stop"}}})
				return
			}
			encoded, _ := json.Marshal(args)
			json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"id": name, "type": "function", "function": map[string]string{"name": name, "arguments": string(encoded)}}}}, "finish_reason": "tool_calls"}}})
			return
		}
		if body["method"] == "notifications/initialized" {
			w.WriteHeader(202)
			return
		}
		var result any
		switch body["method"] {
		case "initialize":
			result = map[string]string{"protocolVersion": "2025-03-26"}
		case "tools/list":
			result = map[string]any{"tools": []any{map[string]any{"name": "read_me", "inputSchema": map[string]string{"type": "object"}}, map[string]any{"name": "create_view", "inputSchema": map[string]string{"type": "object"}}}}
		case "tools/call":
			params := body["params"].(map[string]any)
			args := params["arguments"].(map[string]any)
			switch params["name"] {
			case "read_me":
				result = map[string]any{"content": []any{map[string]string{"type": "text", "text": "Test drawing format"}}}
			case "save_checkpoint":
				var saved struct {
					Elements []map[string]any `json:"elements"`
				}
				json.Unmarshal([]byte(args["data"].(string)), &saved)
				state = saved.Elements
				result = map[string]any{"content": []any{}}
			case "create_view":
				if len(state) > 0 {
					if !strings.Contains(args["elements"].(string), "restoreCheckpoint") {
						t.Error("mixed drawing did not restore compiled checkpoint")
					}
					state = append(state, map[string]any{"id": "circuit", "type": "line", "x": float64(200), "y": float64(0), "version": float64(1)})
				}
				result = map[string]any{"structuredContent": map[string]string{"checkpointId": "checkpoint"}}
			case "read_checkpoint":
				data, _ := json.Marshal(map[string]any{"elements": state})
				result = map[string]any{"content": []any{map[string]string{"type": "text", "text": string(data)}}}
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"id": body["id"], "result": result})
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = routedTransport{previous, server.URL}
	defer func() { http.DefaultTransport = previous }()
	path := filepath.Join(app.root, "mixed.excalidraw")
	session, err := app.CreateAISession(path)
	if err != nil {
		t.Fatal(err)
	}
	result, err := app.AskAI(path, `{"elements":[]}`, "", "Create a flowchart and a circuit", "", nil, session, "mixed-tools", "high")
	if err != nil || bridgeCalls != 2 || rounds != 4 || !strings.Contains(string(result.Elements), "circuit") || !strings.Contains(string(result.Elements), "flow-A") {
		t.Fatal("mixed tool state was lost", result, err)
	}
	compiled[0]["customData"].(map[string]any)["exbaseMermaid"].(map[string]any)["active"] = false
	if strings.Contains(readCanvas(compiled, map[string]any{"diagramId": "flow"}), "source") {
		t.Fatal("detached source must not be presented as editable Mermaid")
	}
}
