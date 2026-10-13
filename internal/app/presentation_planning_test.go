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

func TestPlanPresentationCannotDrawAndPreservesOriginalScene(t *testing.T) {
	root := t.TempDir()
	t.Setenv("USERPROFILE", root)
	t.Setenv("HOME", root)
	srt := filepath.Join(root, "talk.srt")
	if err := os.WriteFile(srt, []byte("1\n00:00:00,000 --> 00:00:01,000\nA\n\n2\n00:00:01,000 --> 00:00:02,000\nB\n\n3\n00:00:02,000 --> 00:00:03,000\nBack to A\n\n4\n00:00:03,000 --> 00:00:04,000\nOverview\n"), 0600); err != nil {
		t.Fatal(err)
	}
	a := NewApp()
	a.Workspace = workspace.New(root)
	if _, err := a.SaveAISettings("fixture-key", "none"); err != nil {
		t.Fatal(err)
	}
	a.canvasEmit = func(AICanvasRequest) { t.Error("planning attempted to normalize or edit the drawing") }
	var original []map[string]any
	scene := `{"elements":[{"id":"a","type":"rectangle","x":123,"y":-200,"width":300,"height":180,"version":7,"customData":{"keep":true,"exbasePresentation":{"version":1,"steps":[{"elementIds":["a","b"]}],"videoPath":"face.mp4","bubble":{"shape":"circle"},"needsGeneration":true}}},{"id":"label","type":"text","containerId":"a","x":140,"version":2},{"id":"b","type":"rectangle","x":1900,"version":3},{"id":"deleted","type":"rectangle","isDeleted":true,"version":4}]}`
	var parsed struct {
		Elements []map[string]any `json:"elements"`
	}
	json.Unmarshal([]byte(scene), &parsed)
	original = parsed.Elements
	round := 0
	retried := false
	interrupted := false
	inspections := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat" {
			t.Error("planning contacted drawing MCP", r.URL.Path)
			http.Error(w, "unexpected", 500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		budget, _ := body["max_tokens"].(float64)
		if budget < presentationOutputBudget || body["thinking"].(map[string]any)["type"] != "enabled" || body["reasoning_effort"] != "high" {
			t.Error("planning budget or selected thinking mode lost", budget)
		}
		if retried && round == 5 && budget != presentationOutputBudget*2 {
			t.Error("larger output budget was not retained", budget)
		}
		toolNames := []string{}
		for _, tool := range body["tools"].([]any) {
			toolNames = append(toolNames, tool.(map[string]any)["function"].(map[string]any)["name"].(string))
		}
		if !reflect.DeepEqual(toolNames, []string{"read_srt", "set_presentation_timeline", "read_canvas"}) {
			t.Error("unsafe tool set", toolNames)
		}
		messages := body["messages"].([]any)
		last := messages[len(messages)-1].(map[string]any)["content"]
		if round == 1 && !strings.Contains(last.(string), "drawing tools are unavailable") {
			t.Error("drawing call not blocked", last)
		}
		if round == 2 && !strings.Contains(last.(string), "only the SRT path explicitly") {
			t.Error("unauthorized subtitle read", last)
		}
		if round == 5 && !strings.Contains(last.(string), "unknown canvas element") {
			t.Error("missing camera target accepted", last)
		}
		var name string
		var args any
		switch round {
		case 0:
			name = "create_view"
			args = map[string]any{"elements": `[{"type":"delete","ids":["a"]}]`}
		case 1:
			name = "read_srt"
			args = map[string]any{"path": filepath.Join(root, "other.srt")}
		case 2:
			name = "read_srt"
			args = map[string]any{"path": srt}
		case 3:
			name = "read_canvas"
			args = map[string]any{}
			// Inspection and correction must be able to continue past ten rounds.
			if inspections < 8 {
				inspections++
				round--
			}
		case 4:
			name = "set_presentation_timeline"
			args = map[string]any{"camera": []CameraStep{{CueID: 1, ElementIDs: []string{"missing"}}}}
		case 5:
			if !interrupted {
				interrupted = true
				w.Header().Set("Content-Length", "4096")
				w.Write([]byte(`{"choices":[`))
				return
			}
			if !retried {
				retried = true
				json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"id": "partial", "type": "function", "function": map[string]any{"name": "set_presentation_timeline", "arguments": `{"camera":[`}}}}, "finish_reason": "length"}}})
				return
			}
			name = "set_presentation_timeline"
			args = map[string]any{"camera": []CameraStep{{CueID: 1, ElementIDs: []string{"a"}}, {CueID: 2, ElementIDs: []string{"b"}}, {CueID: 3, ElementIDs: []string{"a"}}, {CueID: 4, ElementIDs: []string{}}}}
		default:
			json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": "Ready"}, "finish_reason": "stop"}}})
			return
		}
		round++
		encoded, _ := json.Marshal(args)
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"id": "call", "type": "function", "function": map[string]any{"name": name, "arguments": string(encoded)}}}}, "finish_reason": "tool_calls"}}})
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = routedTransport{previous, server.URL}
	t.Cleanup(func() { http.DefaultTransport = previous })
	document := filepath.Join(root, "diagram.excalidraw")
	session, err := a.CreateAISession(document)
	if err != nil {
		t.Fatal(err)
	}
	result, err := a.PlanPresentation(document, scene, "SRT file: "+srt, "", session, "plan-request")
	if err != nil || round != 6 || !retried || !interrupted {
		t.Fatal(result, err, round)
	}
	var final []map[string]any
	json.Unmarshal(result.Elements, &final)
	metadata := final[0]["customData"].(map[string]any)["exbasePresentation"].(map[string]any)
	if metadata["reasoningEffort"] != "high" || metadata["videoPath"] != "face.mp4" || metadata["needsGeneration"] != false || len(metadata["camera"].([]any)) != 4 || metadata["steps"] != nil || metadata["baseIds"] != nil || metadata["version"] != float64(2) {
		t.Fatal("lost options or retained progressive metadata", metadata)
	}
	delete(final[0], "customData")
	delete(original[0], "customData")
	delete(final[0], "version")
	delete(original[0], "version")
	if !reflect.DeepEqual(original, final) {
		t.Fatal("planning changed drawing content", original, final)
	}
	// A reply without a fresh validated timeline cannot reuse the previous one.
	if _, err := a.PlanPresentation(document, scene, "SRT file: "+srt, "", session, "failed-request"); err == nil || !strings.Contains(err.Error(), "could not be matched") {
		t.Fatal("accepted unplanned reply", err)
	}
	if _, err := a.PlanPresentation(document, `{"elements":[]}`, "SRT file: "+srt, "", session, "empty-request"); err == nil || !strings.Contains(err.Error(), "prepare a drawing") {
		t.Fatal("empty drawing accepted", err)
	}
}

func TestCameraPlanCombinesConsecutiveTargetsButPreservesReturns(t *testing.T) {
	plan := PresentationTimeline{Cues: []SubtitleCue{{ID: 1, StartMS: 0}, {ID: 2, StartMS: 1000}, {ID: 3, StartMS: 2000}, {ID: 4, StartMS: 3000}, {ID: 5, StartMS: 4000}}}
	elements := []map[string]any{{"id": "a", "type": "rectangle"}, {"id": "label", "type": "text"}, {"id": "b", "type": "rectangle"}}
	camera := []CameraStep{{CueID: 1, ElementIDs: []string{"a", "label"}}, {CueID: 2, ElementIDs: []string{"label", "a"}}, {CueID: 3, ElementIDs: []string{"b"}}, {CueID: 4, ElementIDs: []string{"b"}}, {CueID: 5, ElementIDs: []string{"a", "label"}}}
	resolved, err := resolveCameraPlan(plan, camera, elements)
	if err != nil || len(resolved.Camera) != 3 || resolved.Camera[1].AtMS != 2000 || resolved.Camera[2].AtMS != 4000 || camera[1].ElementIDs[0] != "label" {
		t.Fatal("consecutive targets were not combined or return was lost", resolved, err)
	}
}

// Opt in to a small real-provider check; credentials and traces stay in a temp home.
func TestLivePresentationPlanning(t *testing.T) {
	if os.Getenv("EXBASE_LIVE_PRESENTATION_CHECK") != "1" {
		t.Skip("set EXBASE_LIVE_PRESENTATION_CHECK=1 for the isolated provider check")
	}
	config, err := loadAIConfig()
	if err != nil || config.APIKey == "" {
		t.Skip("no configured provider key")
	}
	root := t.TempDir()
	t.Setenv("USERPROFILE", root)
	t.Setenv("HOME", root)
	a := NewApp()
	a.Workspace = workspace.New(root)
	providers := []AIProvider{officialAIProvider()}
	if config.ID == "deepseek" {
		providers[0] = config.AIProvider
	} else {
		providers = append(providers, config.AIProvider)
	}
	if _, err := a.SaveAIProviders(providers, config.ID); err != nil {
		t.Fatal("could not configure isolated check")
	}
	srt := filepath.Join(root, "narration.srt")
	narration := "1\n00:00:00,000 --> 00:00:04,000\nThe CPU handles sequential control and general purpose logic.\n\n2\n00:00:04,000 --> 00:00:08,000\nStill on the CPU, this same sequential control handles general purpose logic.\n\n3\n00:00:08,000 --> 00:00:12,000\nThe GPU runs many parallel arithmetic operations.\n\n4\n00:00:12,000 --> 00:00:16,000\nContinuing with the GPU, those same parallel operations process many values at once.\n\n5\n00:00:16,000 --> 00:00:20,000\nReturning to the CPU, it coordinates execution.\n\n6\n00:00:20,000 --> 00:00:24,000\nIn summary, the CPU and GPU work together, linked by data transfer.\n"
	if err := os.WriteFile(srt, []byte(narration), 0600); err != nil {
		t.Fatal(err)
	}
	scene := `{"elements":[{"id":"cpu","type":"rectangle","x":0,"y":0,"width":300,"height":180,"version":1,"boundElements":[{"id":"cpu-label","type":"text"}]},{"id":"cpu-label","type":"text","containerId":"cpu","text":"CPU: sequential control","x":30,"y":70,"width":230,"height":30,"version":1},{"id":"gpu","type":"rectangle","x":1000,"y":0,"width":300,"height":180,"version":1,"boundElements":[{"id":"gpu-label","type":"text"}]},{"id":"gpu-label","type":"text","containerId":"gpu","text":"GPU: parallel arithmetic","x":1030,"y":70,"width":230,"height":30,"version":1},{"id":"transfer","type":"arrow","x":300,"y":90,"points":[[0,0],[700,0]],"startBinding":{"elementId":"cpu"},"endBinding":{"elementId":"gpu"},"version":1}]}`
	document := filepath.Join(root, "diagram.excalidraw")
	session, err := a.CreateAISession(document)
	if err != nil {
		t.Fatal(err)
	}
	result, err := a.PlanPresentation(document, scene, "Plan the narration on the existing diagram.\nSRT file: "+srt, "", session, "live-check")
	if err != nil {
		t.Fatal(err)
	}
	var elements []map[string]any
	json.Unmarshal(result.Elements, &elements)
	data, _ := json.Marshal(elements[0]["customData"].(map[string]any)["exbasePresentation"])
	var plan PresentationTimeline
	json.Unmarshal(data, &plan)
	if len(elements) != 5 || len(plan.Camera) < 3 || len(plan.Camera) > 4 {
		t.Fatal("incomplete or overly granular narration plan", plan.Camera)
	}
	contains := func(ids []string, want string) bool {
		for _, id := range ids {
			if id == want {
				return true
			}
		}
		return false
	}
	focusedCPU, focusedGPU, returned, overview := false, false, false, false
	for _, shot := range plan.Camera {
		if shot.CueID == 1 && (contains(shot.ElementIDs, "cpu") || contains(shot.ElementIDs, "cpu-label")) {
			focusedCPU = true
		}
		if shot.CueID == 3 && (contains(shot.ElementIDs, "gpu") || contains(shot.ElementIDs, "gpu-label")) {
			focusedGPU = true
		}
		if shot.CueID == 5 && (contains(shot.ElementIDs, "cpu") || contains(shot.ElementIDs, "cpu-label")) {
			returned = true
		}
		if shot.CueID == 6 && (len(shot.ElementIDs) == 0 || contains(shot.ElementIDs, "cpu") && contains(shot.ElementIDs, "gpu")) {
			overview = true
		}
	}
	if !focusedCPU || !focusedGPU || !returned || !overview {
		t.Fatal("incorrect concept matching", plan.Camera)
	}
	t.Logf("isolated real-provider check: %d elements, camera=%+v", len(elements), plan.Camera)
}
