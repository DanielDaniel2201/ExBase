package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"
)

type aiChoice struct {
	Message map[string]any `json:"message"`
	Finish  string         `json:"finish_reason"`
}

type aiResponse struct {
	Usage   json.RawMessage `json:"usage"`
	Choices []aiChoice      `json:"choices"`
}

// Decode only complete objects inside the streamed, JSON-encoded elements string.
func completeAIElements(arguments string) []map[string]any {
	decoder := json.NewDecoder(strings.NewReader(arguments))
	if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
		return nil
	}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return nil
		}
		if key != "elements" {
			var ignored any
			if decoder.Decode(&ignored) != nil {
				return nil
			}
			continue
		}
		encoded := strings.TrimSpace(arguments[decoder.InputOffset():])
		if !strings.HasPrefix(encoded, ":") {
			return nil
		}
		encoded = strings.TrimSpace(encoded[1:])
		if !strings.HasPrefix(encoded, `"`) {
			return nil
		}
		end := 1
		for end < len(encoded) && encoded[end] != '"' {
			next := end + 1
			if encoded[end] == '\\' {
				next++
				if end+1 < len(encoded) && encoded[end+1] == 'u' {
					next += 4
				}
			}
			if next > len(encoded) {
				break
			}
			end = next
		}
		var elements string
		if json.Unmarshal([]byte(encoded[:end]+`"`), &elements) != nil {
			return nil
		}
		array := json.NewDecoder(strings.NewReader(elements))
		if token, err := array.Token(); err != nil || token != json.Delim('[') {
			return nil
		}
		var complete []map[string]any
		for array.More() {
			var element map[string]any
			if array.Decode(&element) != nil || element == nil {
				break
			}
			complete = append(complete, element)
		}
		return complete
	}
	return nil
}

func decodeAIResponse(reader io.Reader, streaming bool, preview func([]map[string]any) error) (aiResponse, error) {
	var response aiResponse
	if !streaming {
		err := json.NewDecoder(io.LimitReader(reader, 8<<20)).Decode(&response)
		return response, err
	}
	// SSE repeats metadata per token; bound both wire bytes and assembled output.
	reader = io.LimitReader(reader, 64<<20)
	outputBytes := 0
	message := map[string]any{"role": "assistant", "content": "", "reasoning_content": ""}
	calls := []any{}
	finish := ""
	previewCall, previewCount := -1, 0
	var lastPreview time.Time
	flush := func(force bool) error {
		if preview == nil || previewCall < 0 || (!force && time.Since(lastPreview) < 2*time.Second) {
			return nil
		}
		fn := calls[previewCall].(map[string]any)["function"].(map[string]any)
		elements := completeAIElements(fn["arguments"].(string))
		if len(elements) <= previewCount {
			return nil
		}
		changed := false
		for _, element := range elements {
			if element["type"] != "restoreCheckpoint" && element["type"] != "cameraUpdate" {
				changed = true
				break
			}
		}
		if !changed {
			return nil
		}
		previewCount, lastPreview = len(elements), time.Now()
		return preview(elements)
	}
	consume := func(data string) (bool, error) {
		if data == "[DONE]" {
			if finish == "" {
				return false, errors.New("incomplete AI stream")
			}
			message["tool_calls"] = calls
			response.Choices = []aiChoice{{Message: message, Finish: finish}}
			return true, flush(true)
		}
		var chunk struct {
			Usage   json.RawMessage           `json:"usage"`
			Error   *struct{ Message string } `json:"error"`
			Choices []struct {
				Index  int    `json:"index"`
				Finish string `json:"finish_reason"`
				Delta  struct {
					Content   string `json:"content"`
					Reasoning string `json:"reasoning_content"`
					Calls     []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return false, err
		}
		if chunk.Error != nil {
			return false, errors.New(chunk.Error.Message)
		}
		if len(chunk.Usage) > 0 && string(chunk.Usage) != "null" {
			response.Usage = chunk.Usage
		}
		for _, choice := range chunk.Choices {
			if choice.Index != 0 {
				continue
			}
			outputBytes += len(choice.Delta.Content) + len(choice.Delta.Reasoning)
			message["content"] = message["content"].(string) + choice.Delta.Content
			message["reasoning_content"] = message["reasoning_content"].(string) + choice.Delta.Reasoning
			if choice.Finish != "" {
				finish = choice.Finish
			}
			for _, delta := range choice.Delta.Calls {
				outputBytes += len(delta.ID) + len(delta.Function.Name) + len(delta.Function.Arguments)
				if delta.Index < 0 || delta.Index >= 8 {
					return false, errors.New("too many AI tool calls")
				}
				for len(calls) <= delta.Index {
					calls = append(calls, map[string]any{"id": "", "type": "function", "function": map[string]any{"name": "", "arguments": ""}})
				}
				call := calls[delta.Index].(map[string]any)
				if delta.ID != "" {
					call["id"] = delta.ID
				}
				fn := call["function"].(map[string]any)
				fn["name"] = fn["name"].(string) + delta.Function.Name
				fn["arguments"] = fn["arguments"].(string) + delta.Function.Arguments
				// ponytail: preview the first drawing call per response; later calls preview after execution.
				if previewCall < 0 && fn["name"] == "create_view" {
					previewCall = delta.Index
				}
			}
		}
		if outputBytes > 8<<20 {
			return false, errors.New("AI output is oversized")
		}
		return false, flush(false)
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
			done, err := consume(strings.Join(data, "\n"))
			if err != nil || done {
				return response, err
			}
			data = nil
		}
	}
	if err := scanner.Err(); err != nil {
		return response, err
	}
	if len(data) > 0 {
		done, err := consume(strings.Join(data, "\n"))
		if err != nil || done {
			return response, err
		}
	}
	return response, errors.New("incomplete AI stream")
}

func resolveAIPreview(base, edits []map[string]any) []map[string]any {
	deleted := map[string]bool{}
	for _, edit := range edits {
		if edit["type"] == "delete" {
			ids, _ := edit["ids"].(string)
			if ids == "" {
				ids, _ = edit["id"].(string)
			}
			for _, id := range strings.Split(ids, ",") {
				deleted[strings.TrimSpace(id)] = true
			}
		}
	}
	result := make([]map[string]any, 0, len(base)+len(edits))
	for _, element := range base {
		id, _ := element["id"].(string)
		container, _ := element["containerId"].(string)
		if !deleted[id] && (container == "" || !deleted[container]) {
			result = append(result, element)
		}
	}
	for _, edit := range edits {
		switch edit["type"] {
		case "restoreCheckpoint", "delete", "cameraUpdate":
		default:
			result = append(result, edit)
		}
	}
	return result
}
