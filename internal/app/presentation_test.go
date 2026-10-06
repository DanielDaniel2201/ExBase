package app

import (
	"encoding/json"
	"exbase/internal/workspace"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestSRTAgentToolsSaveTimelineAndRestrictFileReads(t *testing.T) {
	root := t.TempDir()
	t.Setenv("USERPROFILE", root)
	t.Setenv("HOME", root)
	srt := filepath.Join(root, "talk.srt")
	if err := os.WriteFile(srt, []byte("1\n00:00:00,500 --> 00:00:02,000\nDraw a node\n"), 0600); err != nil {
		t.Fatal(err)
	}
	a := NewApp()
	a.Workspace = workspace.New(root)
	if _, err := a.SaveAISettings("fixture-key", "none"); err != nil {
		t.Fatal(err)
	}
	a.canvasEmit = func(job AICanvasRequest) {
		for _, element := range job.Elements {
			element["version"] = float64(1)
		}
		data, _ := json.Marshal(job.Elements)
		a.ResolveAICanvas(job.ID, string(data), "")
	}
	round := 0
	elements := []map[string]any{{"id": "old", "type": "rectangle", "x": float64(0), "y": float64(0), "version": float64(1), "customData": map[string]any{"keep": true}}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if r.URL.Path == "/chat" {
			messages := body["messages"].([]any)
			last := messages[len(messages)-1].(map[string]any)["content"].(string)
			if round == 1 && !strings.Contains(last, "only the SRT path explicitly") {
				t.Error("model could read a path not authorized by the prompt", last)
			}
			if round == 2 && !strings.Contains(last, "Draw a node") {
				t.Error("SRT content missing", last)
			}
			if round == 4 && !strings.Contains(last, "unknown canvas element") {
				t.Error("invalid mapping was accepted", last)
			}
			var name string
			var args any
			switch round {
			case 0:
				name = "read_srt"
				args = map[string]any{"path": filepath.Join(root, "other.srt")}
			case 1:
				name = "read_srt"
				args = map[string]any{"path": srt}
			case 2:
				name = "create_view"
				args = map[string]any{"elements": `[{"id":"new","type":"rectangle","x":100,"y":100,"width":100,"height":80}]`}
			case 3:
				name = "set_presentation_timeline"
				args = map[string]any{"steps": []any{map[string]any{"cueId": 1, "elementIds": []string{"missing"}}}}
			case 4:
				name = "set_presentation_timeline"
				args = map[string]any{"steps": []any{map[string]any{"cueId": 1, "elementIds": []string{"new"}}}}
			default:
				json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": "Ready"}, "finish_reason": "stop"}}})
				return
			}
			round++
			encoded, _ := json.Marshal(args)
			json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"id": "call", "type": "function", "function": map[string]any{"name": name, "arguments": string(encoded)}}}}, "finish_reason": "tool_calls"}}})
			return
		}
		var result any
		switch body["method"] {
		case "initialize":
			result = map[string]any{"protocolVersion": "2025-03-26"}
		case "notifications/initialized":
			w.WriteHeader(202)
			return
		case "tools/list":
			result = map[string]any{"tools": []any{map[string]any{"name": "create_view", "inputSchema": map[string]any{"type": "object"}}}}
		case "tools/call":
			params := body["params"].(map[string]any)
			args := params["arguments"].(map[string]any)
			switch params["name"] {
			case "read_me":
				result = map[string]any{"content": []any{map[string]any{"type": "text", "text": "Test native shapes"}}}
			case "save_checkpoint":
				var saved struct {
					Elements []map[string]any `json:"elements"`
				}
				if err := json.Unmarshal([]byte(args["data"].(string)), &saved); err != nil {
					t.Error(err)
				}
				elements = saved.Elements
				result = map[string]any{"content": []any{}}
			case "create_view":
				var edits []map[string]any
				json.Unmarshal([]byte(args["elements"].(string)), &edits)
				for _, e := range edits {
					if e["type"] != "restoreCheckpoint" {
						elements = append(elements, e)
					}
				}
				result = map[string]any{"structuredContent": map[string]any{"checkpointId": "check"}}
			case "read_checkpoint":
				encoded, _ := json.Marshal(map[string]any{"elements": elements})
				result = map[string]any{"content": []any{map[string]any{"type": "text", "text": string(encoded)}}}
			default:
				t.Error("unexpected MCP tool", params["name"])
			}
		default:
			t.Error("unexpected RPC", body["method"])
		}
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": body["id"], "result": result})
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = routedTransport{previous, server.URL}
	defer func() { http.DefaultTransport = previous }()
	document := filepath.Join(root, "demo.excalidraw")
	session, err := a.CreateAISession(document)
	if err != nil {
		t.Fatal(err)
	}
	scene, _ := json.Marshal(map[string]any{"elements": elements})
	result, err := a.AskAI(document, string(scene), "", "SRT 文件："+srt, "", nil, session, "request", "none")
	if err != nil || round != 5 {
		t.Fatal(result, err, round)
	}
	var final []map[string]any
	if err := json.Unmarshal(result.Elements, &final); err != nil {
		t.Fatal(err)
	}
	custom := final[0]["customData"].(map[string]any)
	metadata := custom["exbasePresentation"].(map[string]any)
	if custom["keep"] != true || metadata["srtPath"] != srt || metadata["steps"].([]any)[0].(map[string]any)["atMs"] != float64(500) {
		t.Fatal("association or existing metadata lost", custom)
	}
}

func TestSRTAndRevealPlan(t *testing.T) {
	cues, err := parseSRT("\ufeff1\r\n00:00:00,000 --> 00:00:01,000\r\nNode\r\nlabel\r\n\r\n2\r\n00:00:01,000 --> 00:00:01,100\r\nConnection\r\n")
	if err != nil || len(cues) != 2 || cues[0].Text != "Node\nlabel" {
		t.Fatal(cues, err)
	}
	for _, bad := range []string{"", "1\n00:00:02,000 --> 00:00:01,000\ntext", "1\n00:61:00,000 --> 00:62:00,000\ntext", "1\n00:00:00,000 --> 00:00:01,000\n"} {
		if _, err := parseSRT(bad); err == nil {
			t.Fatalf("accepted malformed SRT: %q", bad)
		}
	}
	elements := []map[string]any{{"id": "old", "type": "rectangle"}, {"id": "a", "type": "rectangle"}, {"id": "label", "type": "text", "containerId": "a"}, {"id": "b", "type": "rectangle"}, {"id": "edge", "type": "arrow", "startBinding": map[string]any{"elementId": "a"}, "endBinding": map[string]any{"elementId": "b"}}}
	steps := []RevealStep{{CueID: 1, ElementIDs: []string{"a"}}, {CueID: 2, ElementIDs: []string{"b"}}, {CueID: 2, ElementIDs: []string{"edge"}}}
	plan, err := resolveRevealPlan(PresentationTimeline{Version: 1, SRTPath: "talk.srt", Cues: cues}, steps, elements, map[string]bool{"old": true})
	if err != nil || len(plan.Steps[0].ElementIDs) != 2 || plan.Steps[1].AtMS != 1000 || plan.Steps[2].AtMS != 1050 || !reflect.DeepEqual(plan.BaseIDs, []string{"old"}) {
		t.Fatal(plan, err)
	}
	bad := []RevealStep{{CueID: 1, ElementIDs: []string{"a", "edge"}}, {CueID: 2, ElementIDs: []string{"b"}}}
	if _, err := resolveRevealPlan(plan, bad, elements, map[string]bool{"old": true}); err == nil {
		t.Fatal("connection shown before endpoint")
	}
	bad = []RevealStep{{CueID: 1, ElementIDs: []string{"missing"}}}
	if _, err := resolveRevealPlan(plan, bad, elements, nil); err == nil {
		t.Fatal("unknown ID accepted")
	}
	elements[0]["customData"] = map[string]any{"keep": true}
	attachPresentation(elements, plan)
	if elements[0]["customData"].(map[string]any)["keep"] != true {
		t.Fatal("lost unrelated metadata")
	}
	if requestedSRTPath("SRT 文件：\"talk.srt\"", filepath.Join("folder", "demo.excalidraw")) != filepath.Join("folder", "talk.srt") {
		t.Fatal("template path not resolved")
	}
	if requestedSRTPath("SRT 文件：{{path}}", "demo.excalidraw") != "" {
		t.Fatal("unfilled placeholder accepted")
	}
}

func TestPresentationMediaRangeAndRevocation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "video.mp4")
	if err := os.WriteFile(path, []byte("0123456789"), 0600); err != nil {
		t.Fatal(err)
	}
	a := NewApp()
	a.presentationMedia = map[string]string{"selected": path}
	handler := PresentationMediaHandler(a)
	r := httptest.NewRequest(http.MethodGet, "/presentation-media/selected", nil)
	r.Header.Set("Range", "bytes=2-4")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusPartialContent || w.Body.String() != "234" {
		t.Fatal(w.Code, w.Body.String())
	}
	a.ReleasePresentationVideo("selected")
	for _, url := range []string{"/presentation-media/selected", "/presentation-media/../../video.mp4"} {
		w = httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, url, nil))
		if w.Code != 404 {
			t.Fatal("unselected file exposed", w.Code)
		}
	}
	if _, err := a.BeginPresentationExport("outside.excalidraw", "selected"); err == nil || !strings.Contains(err.Error(), "document") {
		t.Fatal("invalid document accepted", err)
	}
}
