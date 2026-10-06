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
			if round == 0 && messages[1].(map[string]any)["content"] != narrationInstructions {
				t.Error("narration workflow missing from host instructions")
			}
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
	if custom["keep"] != true || metadata["srtPath"] != "talk.srt" || metadata["steps"].([]any)[0].(map[string]any)["atMs"] != float64(500) {
		t.Fatal("association or existing metadata lost", custom)
	}
	// A plain model reply must never count as successful regeneration of an old plan.
	scene, _ = json.Marshal(map[string]any{"elements": final})
	if _, err := a.AskAI(document, string(scene), "", "SRT file: "+srt, "", nil, session, "second-request", "none"); err == nil || !strings.Contains(err.Error(), "no valid narration timeline") {
		t.Fatal("generation without a new validated timeline was accepted", err)
	}
}

func TestPresentationAssetPathsRestoreAndMove(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"original", "moved"} {
		folder := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Join(folder, "media"), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(folder, "media", "talk.srt"), []byte("1\n00:00:00,500 --> 00:00:02,000\nA node\n"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(folder, "media", "talk.mp4"), []byte("0123456789"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	a := NewApp()
	a.Workspace = workspace.New(root)
	document := filepath.Join(root, "original", "diagram.excalidraw")
	assets, err := a.OpenPresentationAssets(document, []string{filepath.Join(root, "original", "media", "talk.mp4"), "media/talk.srt"})
	if err != nil || assets.SRTPath != "media/talk.srt" || assets.Video == nil || assets.Video.Path != "media/talk.mp4" {
		t.Fatal(assets, err)
	}
	a.ReleasePresentationVideo(assets.Video.Token)
	restored, err := a.OpenPresentationAssets(filepath.Join(root, "moved", "diagram.excalidraw"), []string{assets.Video.Path})
	if err != nil || restored.Video == nil {
		t.Fatal(restored, err)
	}
	w := httptest.NewRecorder()
	PresentationMediaHandler(a).ServeHTTP(w, httptest.NewRequest(http.MethodGet, restored.Video.URL, nil))
	if w.Code != 200 || w.Body.String() != "0123456789" {
		t.Fatal("moved video could not be served", w.Code, w.Body.String())
	}
	a.ReleasePresentationVideo(restored.Video.Token)
	external := filepath.Join(root, "moved", "media", "talk.mp4")
	if storedPresentationPath(document, external) != external {
		t.Fatal("external media path must stay absolute")
	}
	for _, paths := range [][]string{nil, {"media/missing.mp4"}, {"media/talk.mp4", "media/talk.mp4"}, {"media/talk.srt", "media/talk.srt"}, {"media/talk.mp4", "secret.txt"}, {"media/talk.mp4", "media/talk.srt", "third.srt"}} {
		if _, err := a.OpenPresentationAssets(document, paths); err == nil {
			t.Fatal("invalid assets accepted", paths)
		}
	}
	if len(a.presentationMedia) != 0 {
		t.Fatal("failed selection leaked a media token")
	}
	if _, err := a.OpenPresentationAssets(filepath.Join(root, "..", "outside.excalidraw"), []string{external}); err == nil {
		t.Fatal("document outside workspace accepted")
	}
}

func TestNarrationRegenerationKeepsUnrelatedElements(t *testing.T) {
	plan := PresentationTimeline{Version: 1, Steps: []RevealStep{{CueID: 1, ElementIDs: []string{"node", "label"}}}}
	elements := []map[string]any{
		{"id": "baseline", "customData": map[string]any{"exbasePresentation": plan, "keep": true}},
		{"id": "node"}, {"id": "label", "containerId": "node"}, {"id": "unrelated"},
	}
	base := narrationBaseElements(elements)
	if len(base) != 2 || base[0]["id"] != "baseline" || base[1]["id"] != "unrelated" || len(elements) != 4 {
		t.Fatal("regeneration changed unrelated elements or mutated original scene", base, elements)
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
