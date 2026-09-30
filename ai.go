package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const deepSeekURL = "https://api.deepseek.com/chat/completions"
const excalidrawMCPURL = "https://mcp.excalidraw.com/mcp"

type AISettings struct {
	HasAPIKey bool `json:"hasAPIKey"`
}
type ChatMessage struct {
	Role             string `json:"role"`
	Content          string `json:"content"`
	ReasoningContent string `json:"reasoning_content"`
}
type AIResult struct {
	Reply            string          `json:"reply"`
	ReasoningContent string          `json:"reasoningContent"`
	CheckpointID     string          `json:"checkpointId"`
	Elements         json.RawMessage `json:"elements"`
}

func authFile() (string, error) {
	home, err := os.UserHomeDir()
	return filepath.Join(home, ".exbase", "auth.json"), err
}

func loadAPIKey() (string, error) {
	path, err := authFile()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	var auth struct {
		DeepSeek struct {
			APIKey string `json:"apiKey"`
		} `json:"deepseek"`
	}
	if err := json.Unmarshal(data, &auth); err != nil {
		return "", errors.New("cannot read AI settings")
	}
	return auth.DeepSeek.APIKey, nil
}

func (a *App) LoadAISettings() (AISettings, error) {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	key, err := loadAPIKey()
	return AISettings{HasAPIKey: key != ""}, err
}

func (a *App) SaveAISettings(key string) (AISettings, error) {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	key = strings.TrimSpace(key)
	if key == "" {
		old, err := loadAPIKey()
		return AISettings{HasAPIKey: old != ""}, err
	}
	if len(key) > 1024 || strings.ContainsAny(key, "\r\n\t ") {
		return AISettings{}, errors.New("enter a valid API key")
	}
	path, err := authFile()
	if err != nil {
		return AISettings{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return AISettings{}, err
	}
	data, _ := json.Marshal(map[string]any{"deepseek": map[string]string{"type": "api_key", "apiKey": key}})
	// Replace only after a complete write, so an interrupted save keeps the old key.
	file, err := os.CreateTemp(filepath.Dir(path), "auth-*.tmp")
	if err != nil {
		return AISettings{}, err
	}
	defer os.Remove(file.Name())
	if err := file.Chmod(0600); err != nil {
		file.Close()
		return AISettings{}, err
	}
	if _, err := file.Write(data); err != nil {
		file.Close()
		return AISettings{}, err
	}
	if err := file.Close(); err != nil {
		return AISettings{}, err
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return AISettings{}, err
	}
	return AISettings{HasAPIKey: true}, nil
}

func (a *App) CancelAI() {
	a.aiMu.Lock()
	defer a.aiMu.Unlock()
	if a.aiCancel != nil {
		a.aiCancel()
	}
}

type mcpClient struct {
	url      string
	session  string
	protocol string
	nextID   int
	client   *http.Client
	trace    *aiTrace
}

// Decode both JSON and Streamable HTTP event-stream replies.
func decodeRPC(reader io.Reader, eventStream bool) (json.RawMessage, error) {
	var packet struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	decode := func(data []byte) (json.RawMessage, error) {
		if err := json.Unmarshal(data, &packet); err != nil {
			return nil, err
		}
		if packet.Error != nil {
			return nil, errors.New(packet.Error.Message)
		}
		return packet.Result, nil
	}
	if !eventStream {
		data, err := io.ReadAll(io.LimitReader(reader, 8<<20))
		if err != nil {
			return nil, err
		}
		return decode(data)
	}
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), 8<<20)
	var data []string
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
		if line == "" && len(data) > 0 {
			result, err := decode([]byte(strings.Join(data, "\n")))
			if err != nil || result != nil {
				return result, err
			}
			data = nil
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(data) > 0 {
		return decode([]byte(strings.Join(data, "\n")))
	}
	return nil, errors.New("MCP returned no result")
}

func (m *mcpClient) rpc(ctx context.Context, method string, params any) (json.RawMessage, error) {
	m.nextID++
	packet := map[string]any{"jsonrpc": "2.0", "method": method, "params": params}
	if !strings.HasPrefix(method, "notifications/") {
		packet["id"] = m.nextID
	}
	data, err := json.Marshal(packet)
	if err != nil {
		return nil, err
	}
	if err := m.trace.write("mcp_request", packet); err != nil {
		return nil, err
	}
	started := time.Now()
	req, err := http.NewRequestWithContext(ctx, "POST", m.url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if m.session != "" {
		req.Header.Set("Mcp-Session-Id", m.session)
	}
	if m.protocol != "" {
		req.Header.Set("MCP-Protocol-Version", m.protocol)
	}
	resp, err := m.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("MCP request failed (HTTP %d)", resp.StatusCode)
	}
	if session := resp.Header.Get("Mcp-Session-Id"); session != "" {
		m.session = session
	}
	if strings.HasPrefix(method, "notifications/") {
		if err := m.trace.write("mcp_response", map[string]any{"id": m.nextID, "method": method, "status": resp.StatusCode, "elapsed_ms": time.Since(started).Milliseconds()}); err != nil {
			return nil, err
		}
		return nil, nil
	}
	result, err := decodeRPC(resp.Body, strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream"))
	if err != nil {
		return nil, err
	}
	if err := m.trace.write("mcp_response", map[string]any{"id": m.nextID, "method": method, "elapsed_ms": time.Since(started).Milliseconds(), "result": result}); err != nil {
		return nil, err
	}
	return result, nil
}

func (m *mcpClient) connect(ctx context.Context) error {
	result, err := m.rpc(ctx, "initialize", map[string]any{"protocolVersion": "2025-03-26", "capabilities": map[string]any{}, "clientInfo": map[string]string{"name": "ExBase", "version": "0.1.0"}})
	if err != nil {
		return err
	}
	var init struct {
		Protocol string `json:"protocolVersion"`
	}
	if err := json.Unmarshal(result, &init); err != nil {
		return err
	}
	m.protocol = init.Protocol
	_, err = m.rpc(ctx, "notifications/initialized", map[string]any{})
	return err
}

type mcpResult struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Structured struct {
		CheckpointID string `json:"checkpointId"`
	} `json:"structuredContent"`
	IsError bool `json:"isError"`
}

func (m *mcpClient) call(ctx context.Context, name string, args any) (mcpResult, error) {
	raw, err := m.rpc(ctx, "tools/call", map[string]any{"name": name, "arguments": args})
	if err != nil {
		return mcpResult{}, err
	}
	var result mcpResult
	err = json.Unmarshal(raw, &result)
	return result, err
}

func toolText(result mcpResult) string {
	var parts []string
	for _, content := range result.Content {
		if content.Type == "text" {
			parts = append(parts, content.Text)
		}
	}
	return strings.Join(parts, "\n")
}

func (a *App) AskAI(path, scene, checkpoint, prompt, screenshot string, history []ChatMessage, sessionID string) (result AIResult, err error) {
	if !a.contains(path) || !strings.EqualFold(filepath.Ext(path), ".excalidraw") {
		return AIResult{}, errors.New("open an Excalidraw document first")
	}
	if len(scene) > 5<<20 || len(screenshot) > 4<<20 || len(prompt) > 16000 || strings.TrimSpace(prompt) == "" {
		return AIResult{}, errors.New("invalid or oversized AI request")
	}
	var current struct {
		Elements []map[string]any `json:"elements"`
	}
	if err := json.Unmarshal([]byte(scene), &current); err != nil || current.Elements == nil {
		return AIResult{}, errors.New("invalid canvas")
	}
	a.aiMu.Lock()
	if a.aiCancel != nil {
		a.aiMu.Unlock()
		return AIResult{}, errors.New("an AI request is already running")
	}
	key, err := loadAPIKey()
	if err != nil || key == "" {
		a.aiMu.Unlock()
		return AIResult{}, errors.New("configure your DeepSeek API key in Settings first")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	a.aiCancel = cancel
	a.aiMu.Unlock()
	defer func() { cancel(); a.aiMu.Lock(); a.aiCancel = nil; a.aiMu.Unlock() }()
	trace, err := openAITrace(sessionID, key)
	if err != nil {
		return AIResult{}, err
	}
	defer trace.file.Close()
	started := time.Now()
	defer func() {
		data := map[string]any{"checkpoint_id": checkpoint, "elapsed_ms": time.Since(started).Milliseconds()}
		event := "turn_complete"
		if err != nil {
			event = "turn_error"
			data["error"] = err.Error()
			data["cancelled"] = errors.Is(err, context.Canceled)
		} else {
			data["reply"] = result.Reply
		}
		if logErr := trace.write(event, data); err == nil && logErr != nil {
			result = AIResult{}
			err = logErr
		}
	}()
	if err := trace.write("turn_start", map[string]any{"document_path": path, "prompt": prompt, "checkpoint_id": checkpoint, "element_count": len(current.Elements), "screenshot_bytes": len(screenshot)}); err != nil {
		return AIResult{}, err
	}
	client := &http.Client{}
	m := &mcpClient{url: excalidrawMCPURL, client: client, trace: trace}
	if err := m.connect(ctx); err != nil {
		return AIResult{}, err
	}
	if checkpoint == "" {
		view, err := m.call(ctx, "create_view", map[string]string{"elements": "[]"})
		if err != nil {
			return AIResult{}, err
		}
		if view.IsError {
			return AIResult{}, errors.New(toolText(view))
		}
		checkpoint = view.Structured.CheckpointID
	}
	if checkpoint == "" {
		return AIResult{}, errors.New("MCP did not return a checkpoint")
	}
	data, _ := json.Marshal(current)
	saved, err := m.call(ctx, "save_checkpoint", map[string]string{"id": checkpoint, "data": string(data)})
	if err != nil {
		return AIResult{}, err
	}
	if saved.IsError {
		return AIResult{}, errors.New(toolText(saved))
	}
	listed, err := m.rpc(ctx, "tools/list", map[string]any{})
	if err != nil {
		return AIResult{}, err
	}
	var list struct {
		Tools []struct {
			Name        string          `json:"name"`
			Description string          `json:"description"`
			Schema      json.RawMessage `json:"inputSchema"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(listed, &list); err != nil {
		return AIResult{}, err
	}
	var tools []any
	for _, tool := range list.Tools {
		if tool.Name == "read_me" || tool.Name == "create_view" {
			tools = append(tools, map[string]any{"type": "function", "function": map[string]any{"name": tool.Name, "description": tool.Description, "parameters": tool.Schema}})
		}
	}
	if len(tools) != 2 {
		return AIResult{}, errors.New("MCP drawing tools are unavailable")
	}
	tools = append(tools,
		map[string]any{"type": "function", "function": map[string]any{"name": "draw_mermaid", "description": "Create or replace an editable flowchart using Mermaid. For replacement, first read_canvas and supply the active diagramId; omit it only to create a new diagram. Returns current canvas state for further native drawing in the same turn.", "parameters": json.RawMessage(`{"type":"object","properties":{"source":{"type":"string","maxLength":16000},"diagramId":{"type":"string"},"x":{"type":"number"},"y":{"type":"number"}},"required":["source"],"additionalProperties":false}`)}},
		map[string]any{"type": "function", "function": map[string]any{"name": "read_canvas", "description": "Inspect current elements and managed diagram IDs. Supply diagramId to read its current Mermaid source and elements. Detached source is never returned.", "parameters": json.RawMessage(`{"type":"object","properties":{"diagramId":{"type":"string"}},"additionalProperties":false}`)}},
	)
	messages := []map[string]any{{"role": "system", "content": canvasPrompt(checkpoint, current.Elements)}}
	if len(history) > 12 {
		history = history[len(history)-12:]
	}
	for _, msg := range history {
		if (msg.Role == "user" || msg.Role == "assistant") && len(msg.Content) <= 16000 {
			message := map[string]any{"role": msg.Role, "content": msg.Content}
			if msg.Role == "assistant" {
				message["reasoning_content"] = msg.ReasoningContent
			}
			messages = append(messages, message)
		}
	}
	var content any = prompt
	if screenshot != "" {
		if !strings.HasPrefix(screenshot, "data:image/png;base64,") {
			return AIResult{}, errors.New("invalid screenshot")
		}
		content = []any{map[string]any{"type": "text", "text": prompt}, map[string]any{"type": "image_url", "image_url": map[string]string{"url": screenshot}}}
	}
	messages = append(messages, map[string]any{"role": "user", "content": content})
	changed := false
	for round := 0; round < 10; round++ {
		body, _ := json.Marshal(map[string]any{"model": "deepseek-flash", "thinking": map[string]string{"type": "enabled"}, "reasoning_effort": "high", "messages": messages, "tools": tools})
		if err := trace.write("llm_request", map[string]any{"round": round + 1, "request": json.RawMessage(body)}); err != nil {
			return AIResult{}, err
		}
		llmStarted := time.Now()
		req, err := http.NewRequestWithContext(ctx, "POST", deepSeekURL, bytes.NewReader(body))
		if err != nil {
			return AIResult{}, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+key)
		resp, err := client.Do(req)
		if err != nil {
			return AIResult{}, err
		}
		var response struct {
			Usage   json.RawMessage `json:"usage"`
			Choices []struct {
				Message map[string]any `json:"message"`
				Finish  string         `json:"finish_reason"`
			} `json:"choices"`
		}
		if resp.StatusCode != 200 {
			errorBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
			resp.Body.Close()
			if err := trace.write("llm_error", map[string]any{"round": round + 1, "status": resp.StatusCode, "body": string(errorBody), "elapsed_ms": time.Since(llmStarted).Milliseconds()}); err != nil {
				return AIResult{}, err
			}
			return AIResult{}, fmt.Errorf("DeepSeek request failed (HTTP %d)", resp.StatusCode)
		}
		err = json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&response)
		resp.Body.Close()
		if err != nil {
			return AIResult{}, err
		}
		if err := trace.write("llm_response", map[string]any{"round": round + 1, "elapsed_ms": time.Since(llmStarted).Milliseconds(), "response": response}); err != nil {
			return AIResult{}, err
		}
		if len(response.Choices) == 0 {
			return AIResult{}, errors.New("DeepSeek returned no response")
		}
		choice := response.Choices[0]
		if choice.Finish == "length" {
			return AIResult{}, errors.New("AI output was truncated; try a smaller edit")
		}
		message := choice.Message
		messages = append(messages, message)
		calls, _ := message["tool_calls"].([]any)
		if len(calls) == 0 {
			reply, _ := message["content"].(string)
			reasoning, _ := message["reasoning_content"].(string)
			result := AIResult{Reply: reply, ReasoningContent: reasoning, CheckpointID: checkpoint, Elements: json.RawMessage("null")}
			if changed {
				result.Elements, _ = json.Marshal(current.Elements)
			}
			return result, nil
		}
		if len(calls) > 8 {
			return AIResult{}, errors.New("too many AI tool calls")
		}
		for _, raw := range calls {
			call, ok := raw.(map[string]any)
			if !ok {
				return AIResult{}, errors.New("invalid tool call")
			}
			fn, ok := call["function"].(map[string]any)
			if !ok {
				return AIResult{}, errors.New("invalid tool function")
			}
			name, _ := fn["name"].(string)
			argsText, _ := fn["arguments"].(string)
			var args map[string]any
			var output string
			if name != "read_me" && name != "create_view" && name != "draw_mermaid" && name != "read_canvas" {
				output = "Error: tool unavailable"
			} else if json.Unmarshal([]byte(argsText), &args) != nil {
				output = "Error: invalid JSON arguments"
			} else if name == "read_canvas" {
				output = readCanvas(current.Elements, args)
			} else if name == "draw_mermaid" {
				var request AICanvasRequest
				if json.Unmarshal([]byte(argsText), &request) != nil || len(request.Source) == 0 || len(request.Source) > 16000 {
					output = "Error: invalid flowchart arguments"
				} else {
					request.Kind, request.Elements = "mermaid", current.Elements
					compiled, compileErr := a.compileCanvas(ctx, request)
					if ctx.Err() != nil {
						return AIResult{}, ctx.Err()
					}
					if compileErr != nil {
						output = "Error: " + compileErr.Error()
					} else {
						if err := m.saveCanvas(ctx, checkpoint, compiled); err != nil {
							return AIResult{}, err
						}
						current.Elements, changed = compiled, true
						output = "Canvas updated. " + readCanvas(current.Elements, nil)
						messages[0]["content"] = canvasPrompt(checkpoint, current.Elements)
					}
				}
			} else {
				// Enforce restoration even if the model omits it, so existing work survives.
				if name == "create_view" {
					elements, _ := args["elements"].(string)
					var edits []map[string]any
					if err := json.Unmarshal([]byte(elements), &edits); err != nil {
						return AIResult{}, errors.New("invalid AI elements")
					}
					filtered := []map[string]any{{"type": "restoreCheckpoint", "id": checkpoint}}
					for _, edit := range edits {
						if edit["type"] != "restoreCheckpoint" {
							filtered = append(filtered, edit)
						}
					}
					encoded, _ := json.Marshal(filtered)
					args["elements"] = string(encoded)
				}
				toolResult, err := m.call(ctx, name, args)
				if err != nil {
					return AIResult{}, err
				}
				output = toolText(toolResult)
				if name == "create_view" && !toolResult.IsError {
					if toolResult.Structured.CheckpointID == "" {
						return AIResult{}, errors.New("missing checkpoint")
					}
					checkpoint = toolResult.Structured.CheckpointID
					updated, err := m.readCanvas(ctx, checkpoint)
					if err != nil {
						return AIResult{}, err
					}
					if len(diagramIndex(current.Elements)) > 0 {
						updated, err = a.compileCanvas(ctx, AICanvasRequest{Kind: "normalize", Elements: updated, Previous: current.Elements})
						if err != nil {
							return AIResult{}, err
						}
						if err := m.saveCanvas(ctx, checkpoint, updated); err != nil {
							return AIResult{}, err
						}
					}
					current.Elements, changed = updated, true
					messages[0]["content"] = canvasPrompt(checkpoint, current.Elements)
					output = "Canvas updated. Current checkpoint: " + checkpoint + ". " + readCanvas(current.Elements, nil)
				}
			}
			if len(output) > 96000 {
				output = output[:96000]
			}
			messages = append(messages, map[string]any{"role": "tool", "tool_call_id": call["id"], "content": output})
		}
	}
	return AIResult{}, errors.New("AI tool limit reached; try a smaller edit")
}
