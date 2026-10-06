package app

import (
	"context"
	"encoding/json"
	"errors"
	"exbase/internal/workspace"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAISettings(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	app := NewApp()
	settings, err := app.LoadAISettings()
	if err != nil || settings.HasAPIKey || settings.APIKey != "" || settings.ReasoningEffort != "high" {
		t.Fatal(settings, err)
	}
	if _, err := app.SaveAISettings("test-key", "high"); err != nil {
		t.Fatal(err)
	}
	if settings, err = app.SaveAISettings("", "none"); err != nil || settings.APIKey != "test-key" || settings.ReasoningEffort != "none" {
		t.Fatal(err)
	}
	key, err := loadAPIKey()
	if err != nil || key != "test-key" {
		t.Fatal("blank save must retain key", err)
	}
	if _, err := app.SaveAISettings("replacement", "none"); err != nil {
		t.Fatal(err)
	}
	key, _ = loadAPIKey()
	if key != "replacement" {
		t.Fatal("replacement key was not saved")
	}
	if _, err := app.SaveAISettings("bad\nkey", "high"); err == nil {
		t.Fatal("header injection must be rejected")
	}
	if _, err := app.SaveAISettings("", "low"); err == nil {
		t.Fatal("unsupported reasoning effort must be rejected")
	}
	path, _ := authFile()
	if path != filepath.Join(home, ".exbase", "auth.json") {
		t.Fatal(path)
	}
	data, _ := os.ReadFile(path)
	if !json.Valid(data) {
		t.Fatal("invalid settings JSON")
	}
}

func TestReasoningRequest(t *testing.T) {
	for _, effort := range []string{"none", "high"} {
		body := map[string]any{}
		applyReasoning(body, effort)
		thinking := body["thinking"].(map[string]string)["type"]
		if effort == "none" {
			if thinking != "disabled" || body["reasoning_effort"] != nil {
				t.Fatal("none must disable thinking", body)
			}
		} else if thinking != "enabled" || body["reasoning_effort"] != effort {
			t.Fatal("reasoning effort was not applied", body)
		}
	}
	if validReasoningEffort("low") || validReasoningEffort("max") {
		t.Fatal("chat must expose only none and high reasoning")
	}
}

func TestRPCDecoding(t *testing.T) {
	for _, input := range []struct {
		text   string
		stream bool
	}{
		{`{"jsonrpc":"2.0","id":1,"result":{"ok":true}}`, false},
		{"event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\nevent: message\ndata: {\"id\":1,\"result\":{\"ok\":true}}\n\n", true},
	} {
		result, err := decodeRPC(strings.NewReader(input.text), input.stream)
		if err != nil || string(result) != `{"ok":true}` {
			t.Fatal(string(result), err)
		}
	}
	if _, err := decodeRPC(strings.NewReader(`{"error":{"message":"expired"}}`), false); err == nil {
		t.Fatal("RPC errors must fail")
	}
}

type routedTransport struct {
	base      http.RoundTripper
	serverURL string
}

func (r routedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	endpoint := r.serverURL + "/mcp"
	if req.URL.Host == "api.deepseek.com" {
		endpoint = r.serverURL + "/chat"
	}
	local, _ := http.NewRequestWithContext(req.Context(), req.Method, endpoint, req.Body)
	clone.URL = local.URL
	return r.base.RoundTrip(clone)
}

func TestAgentSynchronizesAndRestoresCanvas(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	app := &App{Workspace: workspace.New(t.TempDir())}
	if _, err := app.SaveAISettings("test-key", "none"); err != nil {
		t.Fatal(err)
	}
	var synced bool
	var guideProvided bool
	rounds := 0
	creates := 0
	waiting := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if r.URL.Path == "/chat" {
			if r.Header.Get("Authorization") != "Bearer test-key" {
				t.Error("missing API authentication")
			}
			if !synced {
				t.Error("model must run after checkpoint sync")
			}
			if !guideProvided || !strings.Contains(body["messages"].([]any)[0].(map[string]any)["content"].(string), "Test drawing format") {
				t.Error("drawing instructions must be supplied before the first model request")
			}
			if body["stream"] != true {
				t.Error("model output must stream")
			}
			messages := body["messages"].([]any)
			if rounds == 0 && !strings.Contains(messages[len(messages)-2].(map[string]any)["content"].(string), `"strokeWidth":1`) {
				t.Error("the model must receive existing connector styles")
			}
			if tools := body["tools"].([]any); len(tools) != 5 || tools[0].(map[string]any)["function"].(map[string]any)["name"] != "create_view" || tools[1].(map[string]any)["function"].(map[string]any)["name"] != "draw_mermaid" || tools[2].(map[string]any)["function"].(map[string]any)["name"] != "read_canvas" {
				t.Error("model should not need a read_me round")
			}
			if body["model"] != "deepseek-flash" {
				t.Error("wrong model")
			}
			if body["thinking"].(map[string]any)["type"] != "enabled" || body["reasoning_effort"] != "high" {
				t.Error("stable mode must use high thinking")
			}
			if _, limited := body["max_tokens"]; limited {
				t.Error("thinking must use the provider's default output budget")
			}
			if messages[1].(map[string]any)["reasoning_content"] != "previous-reasoning" {
				t.Error("previous-turn reasoning was lost")
			}
			if messages[len(messages)-1].(map[string]any)["content"] == "Fail" {
				w.WriteHeader(http.StatusUnauthorized)
				io.WriteString(w, `{"error":{"message":"invalid test-key"}}`)
				return
			}
			if messages[len(messages)-1].(map[string]any)["content"] == "Wait" {
				close(waiting)
				<-r.Context().Done()
				return
			}
			if messages[len(messages)-1].(map[string]any)["content"] == "Truncate" {
				io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":null,"reasoning_content":"budget exhausted","tool_calls":[{"id":"partial","type":"function","function":{"name":"create_view","arguments":"{\"elements\":\"[\"}"}}]},"finish_reason":"length"}]}`)
				return
			}
			if rounds == 1 && messages[len(messages)-2].(map[string]any)["reasoning_content"] != "tool-reasoning" {
				t.Error("tool-call reasoning was lost")
			}
			rounds++
			if rounds == 1 {
				w.Header().Set("Content-Type", "text/event-stream")
				arguments, _ := json.Marshal(map[string]any{"changeConnectorStyle": false, "elements": `[{"type":"arrow","id":"new","x":10,"y":20,"endArrowhead":"arrow"}]`})
				writeAIChunk(w, map[string]any{"reasoning_content": "tool-reasoning", "tool_calls": []any{map[string]any{"index": 0, "id": "call1", "function": map[string]string{"name": "create_view", "arguments": string(arguments[:len(arguments)-2])}}}}, "")
				writeAIChunk(w, map[string]any{"tool_calls": []any{map[string]any{"index": 0, "function": map[string]string{"arguments": string(arguments[len(arguments)-2:])}}}}, "tool_calls")
				io.WriteString(w, "data: [DONE]\n\n")
			} else {
				io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"Done","reasoning_content":"final-reasoning"},"finish_reason":"stop"}],"usage":{"prompt_tokens":123,"completion_tokens":45,"total_tokens":168}}`)
			}
			return
		}
		method, _ := body["method"].(string)
		if method == "notifications/initialized" {
			w.WriteHeader(202)
			return
		}
		var result any
		switch method {
		case "initialize":
			result = map[string]any{"protocolVersion": "2025-03-26"}
		case "tools/list":
			result = map[string]any{"tools": []any{map[string]any{"name": "read_me", "inputSchema": map[string]any{"type": "object"}}, map[string]any{"name": "create_view", "inputSchema": map[string]any{"type": "object"}}}}
		case "tools/call":
			params := body["params"].(map[string]any)
			args := params["arguments"].(map[string]any)
			switch params["name"] {
			case "read_me":
				guideProvided = true
				result = map[string]any{"content": []any{map[string]string{"type": "text", "text": "Test drawing format"}}}
			case "save_checkpoint":
				if !strings.Contains(args["data"].(string), `"original"`) {
					t.Error("current local elements must be synced")
				}
				synced = true
				result = map[string]any{"content": []any{map[string]string{"type": "text", "text": "ok"}}}
			case "create_view":
				creates++
				if synced && !strings.Contains(args["elements"].(string), `"restoreCheckpoint"`) {
					t.Error("edits must restore current checkpoint")
				}
				if _, leaked := args["changeConnectorStyle"]; leaked {
					t.Error("host-only option leaked to MCP")
				}
				if synced && (!strings.Contains(args["elements"].(string), `"strokeWidth":1`) || !strings.Contains(args["elements"].(string), `"endArrowhead":null`)) {
					t.Error("the host must preserve thin connectors without arrowheads")
				}
				result = map[string]any{"content": []any{}, "structuredContent": map[string]string{"checkpointId": "checkpoint"}}
			case "read_checkpoint":
				result = map[string]any{"content": []any{map[string]string{"type": "text", "text": `{"elements":[{"id":"original","type":"arrow","x":0,"y":0,"version":1,"strokeWidth":1,"endArrowhead":null},{"id":"new","type":"arrow","x":10,"y":20,"strokeWidth":1,"endArrowhead":null}]}`}}}
			default:
				t.Error("unexpected tool")
			}
		default:
			t.Error("unexpected method", method)
		}
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": body["id"], "result": result})
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = routedTransport{previous, server.URL}
	defer func() { http.DefaultTransport = previous }()
	path := filepath.Join(app.Workspaces().Current, "diagram.excalidraw")
	sessionID, err := app.CreateAISession(path)
	if err != nil {
		t.Fatal(err)
	}
	history := []ChatMessage{{Role: "assistant", Content: "Previous reply", ReasoningContent: "previous-reasoning"}}
	scene := `{"elements":[{"id":"original","type":"arrow","x":0,"y":0,"version":1,"strokeWidth":1,"endArrowhead":null}]}`
	result, err := app.AskAI(path, scene, "", "Add a box", "", history, sessionID, "request-1", "high")
	if err != nil {
		t.Fatal(err)
	}
	if result.Reply != "Done" || result.ReasoningContent != "final-reasoning" || !strings.Contains(string(result.Elements), "original") || rounds != 2 {
		t.Fatal("agent lost canvas state or did not complete")
	}
	if _, err := app.AskAI(path, scene, result.CheckpointID, "Fail", "", history, sessionID, "request-2", "high"); err == nil {
		t.Fatal("model error must be returned")
	}
	before := creates
	if _, err := app.AskAI(path, scene, result.CheckpointID, "Truncate", "", history, sessionID, "request-3", "high"); err == nil || !strings.Contains(err.Error(), "truncated") {
		t.Fatal("truncated output must be rejected", err)
	}
	if creates != before {
		t.Fatal("truncated tool calls must not edit the canvas")
	}
	done := make(chan error, 1)
	go func() {
		_, err := app.AskAI(path, scene, result.CheckpointID, "Wait", "", history, sessionID, "request-4", "high")
		done <- err
	}()
	select {
	case <-waiting:
	case <-time.After(5 * time.Second):
		app.CancelAI()
		t.Fatal("model request did not start")
	}
	app.CancelAI()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal("request was not cancelled", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancellation did not finish")
	}
	tracePath, _ := sessionFile(sessionID)
	data, err := os.ReadFile(tracePath)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"session_start", "turn_start", "llm_request", "tool_arguments_started", "first_complete_element", "llm_response", "mcp_request", "mcp_response", "canvas_preview", "request-1", "tool-reasoning", "final-reasoning", "total_tokens", "turn_complete", "llm_error", "turn_error", `"cancelled":true`} {
		if !strings.Contains(string(data), expected) {
			t.Errorf("trace missing %s", expected)
		}
	}
	if strings.Contains(string(data), "test-key") {
		t.Fatal("trace leaked API key")
	}
	if _, err := app.AskAI(filepath.Join(app.Workspaces().Current, "..", "outside.excalidraw"), `{"elements":[]}`, "", "edit", "", nil, sessionID, "request-5", "high"); err == nil {
		t.Fatal("outside workspace request accepted")
	}
}

func TestMCPCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	m := &mcpClient{url: "http://127.0.0.1:1", client: http.DefaultClient}
	if err := m.connect(ctx); err == nil {
		t.Fatal("cancelled request must stop")
	}
}
